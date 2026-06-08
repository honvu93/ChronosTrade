"""
Standalone repair script for MT5 metal gaps.

Goals:
- run independently from the long-running mt5-service scheduler
- detect missing H1 bars for XAUUSDc/XAGUSDc using TV-GIT API data
- classify gaps to skip normal closures and repair only suspicious ones
- push only bars that are still missing, relying on backend upsert for safety

Default behavior is report-only. Use --apply to actually push repaired bars.

Examples:
  python repair_gaps_metals.py
  python repair_gaps_metals.py --apply
  python repair_gaps_metals.py --symbols XAUUSDc --from 2026-01-01 --to 2026-02-10 --apply
"""
from __future__ import annotations

import argparse
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from historical_fetcher import HistoricalFetcher
from mt5_connector import MT5Connector
from pusher import build_batch_item, push_batch
from symbol_config import canonical_backend_symbol, get_enabled_symbols, get_symbol_config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("repair_mt5_gaps")

ALL_SYMBOLS = get_enabled_symbols("metal")
TVGIT_URL = os.environ["TVGIT_URL"].rstrip("/")

TF_DELTA = {
    "H1": timedelta(hours=1),
}

TV_TF_MAP = {
    "H1": "1h",
}

REPAIRABLE_GAP_TYPES = {"symbol_only_gap", "partial_overlap_gap", "shared_extended_gap"}


@dataclass(frozen=True)
class GapRange:
    symbol_tv: str
    timeframe_mt5: str
    missing_from: datetime
    missing_to: datetime
    missing_bars: int
    peer_present_bars: int
    peer_missing_bars: int
    gap_type: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair missing MT5 metal gaps safely")
    parser.add_argument(
        "--symbols",
        nargs="+",
        default=[symbol["tv"] for symbol in ALL_SYMBOLS],
        help="Backend symbols to inspect/repair (default: all enabled metal symbols)",
    )
    parser.add_argument(
        "--timeframe",
        default="H1",
        choices=sorted(TF_DELTA.keys()),
        help="MT5 timeframe to inspect (default: H1)",
    )
    parser.add_argument(
        "--from",
        dest="date_from",
        default="2025-01-01",
        help="UTC start date YYYY-MM-DD (default: 2025-01-01)",
    )
    parser.add_argument(
        "--to",
        dest="date_to",
        default=None,
        help="UTC end date YYYY-MM-DD (default: now)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually push repaired bars. Default is report-only.",
    )
    parser.add_argument(
        "--api-window-days",
        type=int,
        default=45,
        help="How many days per TV-GIT API fetch window (default: 45)",
    )
    parser.add_argument(
        "--push-max-candles",
        type=int,
        default=1000,
        help="Max candles per POST /api/ohlcv/batch call (default: 1000)",
    )
    return parser.parse_args()


def parse_utc_date(value: str, end_of_day: bool = False) -> datetime:
    dt = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if end_of_day:
        dt = dt.replace(hour=23, minute=59, second=59)
    return dt


def align_down(dt: datetime, delta: timedelta) -> datetime:
    seconds = int(delta.total_seconds())
    ts = int(dt.timestamp())
    return datetime.fromtimestamp(ts - (ts % seconds), tz=timezone.utc)


def iter_range(start: datetime, end: datetime, step: timedelta) -> Iterable[datetime]:
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += step


def chunked_list(items: list, size: int) -> Iterable[list]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


def get_symbol_cfg(symbol_tv: str) -> dict:
    symbol_cfg = get_symbol_config(symbol_tv)
    if symbol_cfg is None or str(symbol_cfg.get("market", "")).strip().lower() != "metal":
        raise ValueError(f"Symbol not enabled in mt5-service/config.yaml: {symbol_tv}")
    return symbol_cfg


def fetch_existing_times(
    symbol_tv: str,
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
) -> set[datetime]:
    timeframe_tv = TV_TF_MAP[timeframe_mt5]
    times: set[datetime] = set()
    window = timedelta(days=window_days)
    cursor = date_from

    while cursor < date_to:
        chunk_end = min(cursor + window, date_to + TF_DELTA[timeframe_mt5])
        params = {
            "timeframe": timeframe_tv,
            "startTime": int(cursor.timestamp() * 1000),
            "endTime": int(chunk_end.timestamp() * 1000),
            "limit": 100000,
        }
        response = requests.get(f"{TVGIT_URL}/api/ohlcv/{symbol_tv}", params=params, timeout=60)
        response.raise_for_status()

        for candle in response.json():
            candle_time = datetime.fromisoformat(candle["time"].replace("Z", "+00:00"))
            times.add(candle_time.astimezone(timezone.utc))

        logger.info(
            "Fetched %s/%s existing bars for %s -> %s",
            symbol_tv,
            timeframe_tv,
            cursor.date(),
            min(chunk_end, date_to).date(),
        )
        cursor += window

    return times


def group_missing_ranges(
    symbol_tv: str,
    timeframe_mt5: str,
    missing_times: list[datetime],
    peer_times: set[datetime],
    step: timedelta,
) -> list[GapRange]:
    if not missing_times:
        return []

    ranges: list[GapRange] = []
    start = missing_times[0]
    previous = missing_times[0]

    def finalize(range_start: datetime, range_end: datetime) -> None:
        timestamps = list(iter_range(range_start, range_end, step))
        peer_present = sum(1 for ts in timestamps if ts in peer_times)
        peer_missing = len(timestamps) - peer_present

        if peer_present == 0 and len(timestamps) <= 3:
            gap_type = "scheduled_break_or_rollover"
        elif peer_present == 0 and len(timestamps) <= 100:
            gap_type = "shared_weekend_or_holiday"
        elif peer_present == 0:
            gap_type = "shared_extended_gap"
        elif peer_present == len(timestamps):
            gap_type = "symbol_only_gap"
        else:
            gap_type = "partial_overlap_gap"

        ranges.append(
            GapRange(
                symbol_tv=symbol_tv,
                timeframe_mt5=timeframe_mt5,
                missing_from=range_start,
                missing_to=range_end,
                missing_bars=len(timestamps),
                peer_present_bars=peer_present,
                peer_missing_bars=peer_missing,
                gap_type=gap_type,
            )
        )

    for current in missing_times[1:]:
        if current - previous == step:
            previous = current
            continue
        finalize(start, previous)
        start = current
        previous = current

    finalize(start, previous)
    return ranges


def collect_gap_report(
    symbols: list[str],
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
) -> tuple[dict[str, set[datetime]], list[GapRange]]:
    step = TF_DELTA[timeframe_mt5]
    timeline = list(iter_range(date_from, date_to, step))
    existing_by_symbol: dict[str, set[datetime]] = {}

    for symbol_tv in symbols:
        existing_by_symbol[symbol_tv] = fetch_existing_times(
            symbol_tv=symbol_tv,
            timeframe_mt5=timeframe_mt5,
            date_from=date_from,
            date_to=date_to,
            window_days=window_days,
        )

    gaps: list[GapRange] = []
    for symbol_tv in symbols:
        other_symbols = [item for item in symbols if item != symbol_tv]
        peer_times = set().union(*(existing_by_symbol[item] for item in other_symbols)) if other_symbols else set()
        missing_times = [ts for ts in timeline if ts not in existing_by_symbol[symbol_tv]]
        gaps.extend(group_missing_ranges(symbol_tv, timeframe_mt5, missing_times, peer_times, step))

    gaps.sort(key=lambda item: (item.missing_bars, item.missing_from), reverse=True)
    return existing_by_symbol, gaps


def filter_df_to_missing_candles(symbol_cfg: dict, timeframe_mt5: str, df, missing_times: set[datetime]) -> list[dict]:
    if df is None or df.empty:
        return []

    item = build_batch_item(symbol_cfg, timeframe_mt5, df)
    missing_iso = {ts.strftime("%Y-%m-%dT%H:%M:%S.000Z") for ts in missing_times}
    return [candle for candle in item["candles"] if candle["time"] in missing_iso]


def repair_gap(
    fetcher: HistoricalFetcher,
    gap: GapRange,
    push_max_candles: int,
    apply: bool,
) -> dict:
    symbol_cfg = get_symbol_cfg(gap.symbol_tv)
    step = TF_DELTA[gap.timeframe_mt5]
    missing_times = set(iter_range(gap.missing_from, gap.missing_to, step))

    date_from = gap.missing_from.replace(tzinfo=None)
    date_to = (gap.missing_to + step).replace(tzinfo=None)

    df = fetcher.fetch_range(symbol_cfg["mt5"], gap.timeframe_mt5, date_from, date_to)
    filtered_candles = filter_df_to_missing_candles(symbol_cfg, gap.timeframe_mt5, df, missing_times)

    if not filtered_candles:
        return {
            "symbol": gap.symbol_tv,
            "gap_type": gap.gap_type,
            "missing_bars": gap.missing_bars,
            "repaired_bars": 0,
            "status": "skipped_no_mt5_data",
        }

    if apply:
        for candle_chunk in chunked_list(filtered_candles, push_max_candles):
            push_batch(
                [{
                    "symbol": gap.symbol_tv,
                    "exchange": "MT5",
                    "timeframe": TV_TF_MAP[gap.timeframe_mt5],
                    "candles": candle_chunk,
                }]
            )
        status = "pushed"
    else:
        status = "dry_run"

    return {
        "symbol": gap.symbol_tv,
        "gap_type": gap.gap_type,
        "missing_bars": gap.missing_bars,
        "repaired_bars": len(filtered_candles),
        "status": status,
    }


def print_gap_report(gaps: list[GapRange]) -> None:
    print("=" * 110)
    print(
        f"{'Symbol':<8} {'Type':<28} {'Missing':>8} {'From (UTC)':<22} {'To (UTC)':<22} {'PeerPresent':>11}"
    )
    print("-" * 110)
    for gap in gaps:
        print(
            f"{gap.symbol_tv:<8} {gap.gap_type:<28} {gap.missing_bars:>8} "
            f"{gap.missing_from.strftime('%Y-%m-%d %H:%M'):<22} "
            f"{gap.missing_to.strftime('%Y-%m-%d %H:%M'):<22} "
            f"{gap.peer_present_bars:>11}"
        )
    print("=" * 110)


def main() -> None:
    args = parse_args()
    timeframe_mt5 = args.timeframe.upper()
    symbols = [canonical_backend_symbol(item) for item in args.symbols]

    date_from = align_down(parse_utc_date(args.date_from), TF_DELTA[timeframe_mt5])
    if args.date_to:
        date_to = align_down(parse_utc_date(args.date_to, end_of_day=True), TF_DELTA[timeframe_mt5])
    else:
        date_to = align_down(datetime.now(timezone.utc), TF_DELTA[timeframe_mt5])

    if date_from > date_to:
        raise SystemExit("--from must be earlier than or equal to --to")

    logger.info(
        "Analyzing %s timeframe=%s range=%s -> %s mode=%s",
        ",".join(symbols),
        timeframe_mt5,
        date_from.isoformat(),
        date_to.isoformat(),
        "APPLY" if args.apply else "REPORT_ONLY",
    )

    _, gaps = collect_gap_report(
        symbols=symbols,
        timeframe_mt5=timeframe_mt5,
        date_from=date_from,
        date_to=date_to,
        window_days=args.api_window_days,
    )
    print_gap_report(gaps)

    repairable = [gap for gap in gaps if gap.gap_type in REPAIRABLE_GAP_TYPES]
    if not repairable:
        logger.info("No repairable gaps found")
        return

    print("\nRepair candidates:")
    for gap in repairable:
        print(
            f"  {gap.symbol_tv}/{timeframe_mt5} {gap.gap_type} "
            f"{gap.missing_from.isoformat()} -> {gap.missing_to.isoformat()} "
            f"({gap.missing_bars} missing bars)"
        )

    if not args.apply:
        print("\nReport-only mode. Re-run with --apply to fetch from MT5 and push repaired bars.")
        return

    connector = MT5Connector()
    if not connector.connect():
        raise SystemExit("Cannot connect to MT5")

    fetcher = HistoricalFetcher(connector)
    results: list[dict] = []
    try:
        for gap in repairable:
            logger.info(
                "Repairing %s/%s %s %s -> %s (%s bars)",
                gap.symbol_tv,
                gap.timeframe_mt5,
                gap.gap_type,
                gap.missing_from.isoformat(),
                gap.missing_to.isoformat(),
                gap.missing_bars,
            )
            results.append(
                repair_gap(
                    fetcher=fetcher,
                    gap=gap,
                    push_max_candles=args.push_max_candles,
                    apply=args.apply,
                )
            )
    finally:
        connector.disconnect()

    print("\nRepair summary:")
    for result in results:
        print(
            f"  {result['symbol']:<8} {result['gap_type']:<20} "
            f"missing={result['missing_bars']:<5} repaired={result['repaired_bars']:<5} status={result['status']}"
        )


if __name__ == "__main__":
    main()
