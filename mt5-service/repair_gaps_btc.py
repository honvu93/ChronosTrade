"""
Standalone repair script for BTCUSDc gaps from MT5.

Goals:
- inspect BTC MT5 history already stored in TV-GIT
- skip only tiny rollover gaps (<=3 bars)
- repair abnormal internal gaps and stale tails
- push only still-missing bars so existing DB data stays intact
- BTC trades 24/7 on Exness — weekend gaps are NOT skipped

Examples:
  python repair_gaps_btc.py
  python repair_gaps_btc.py --apply
  python repair_gaps_btc.py --timeframes H1 M15 M5 --from 2025-01-01 --apply
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("repair_btc_mt5_gaps")

TVGIT_URL = os.environ["TVGIT_URL"].rstrip("/")
BTC_SYMBOL = {
    "mt5": "BTCUSDc",
    "tv": "BTCUSD",
}

TF_ORDER = ["D1", "H4", "H1", "M15", "M5", "M1"]
TF_DELTA = {
    "M1": timedelta(minutes=1),
    "M5": timedelta(minutes=5),
    "M15": timedelta(minutes=15),
    "H1": timedelta(hours=1),
    "H4": timedelta(hours=4),
    "D1": timedelta(days=1),
}
TV_TF_MAP = {
    "M1": "1m",
    "M5": "5m",
    "M15": "15m",
    "H1": "1h",
    "H4": "4h",
    "D1": "1d",
}
REPAIRABLE_GAP_TYPES = {"abnormal_gap", "stale_tail"}


@dataclass(frozen=True)
class GapRange:
    timeframe_mt5: str
    missing_from: datetime
    missing_to: datetime
    missing_bars: int
    gap_type: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Repair abnormal BTCUSDc MT5 gaps safely")
    parser.add_argument(
        "--timeframes",
        nargs="+",
        default=["D1", "H4", "H1", "M15", "M5"],
        choices=TF_ORDER,
        help="Timeframes to inspect (default: D1 H4 H1 M15 M5)",
    )
    parser.add_argument(
        "--from",
        dest="date_from",
        default="2023-01-01",
        help="UTC start date YYYY-MM-DD (default: 2023-01-01)",
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
        help="Actually fetch from MT5 and push repaired bars. Default is report-only.",
    )
    parser.add_argument(
        "--api-window-days",
        type=int,
        default=45,
        help="Days per TV-GIT API fetch window (default: 45)",
    )
    parser.add_argument(
        "--push-max-candles",
        type=int,
        default=1000,
        help="Max candles per POST /api/ohlcv/batch call (default: 1000)",
    )
    parser.add_argument(
        "--api-symbols",
        nargs="+",
        default=["BTCUSD", "BTCUSDc"],
        help="API symbols to probe for existing data (default: BTCUSD BTCUSDc)",
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


def fetch_existing_times(
    symbol_aliases: list[str],
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
) -> set[datetime]:
    timeframe_tv = TV_TF_MAP[timeframe_mt5]
    times: set[datetime] = set()
    window = timedelta(days=window_days)

    for symbol in symbol_aliases:
        cursor = date_from
        while cursor < date_to:
            chunk_end = min(cursor + window, date_to + TF_DELTA[timeframe_mt5])
            params = {
                "timeframe": timeframe_tv,
                "startTime": int(cursor.timestamp() * 1000),
                "endTime": int(chunk_end.timestamp() * 1000),
                "limit": 100000,
            }
            response = requests.get(f"{TVGIT_URL}/api/ohlcv/{symbol}", params=params, timeout=60)
            response.raise_for_status()

            candles = response.json()
            for candle in candles:
                candle_time = datetime.fromisoformat(candle["time"].replace("Z", "+00:00"))
                times.add(candle_time.astimezone(timezone.utc))

            cursor += window

    return times


def classify_gap(missing_times: list[datetime], date_to: datetime) -> str:
    # BTC giao dịch 24/7 trên Exness — không có "weekend closure".
    # Mọi gap cuối tuần đều là abnormal và cần được repair.
    if len(missing_times) <= 3:
        return "scheduled_break_or_rollover"
    if missing_times[-1] == date_to:
        return "stale_tail"
    return "abnormal_gap"


def group_missing_ranges(
    missing_times: list[datetime],
    timeframe_mt5: str,
    date_to: datetime,
) -> list[GapRange]:
    if not missing_times:
        return []

    step = TF_DELTA[timeframe_mt5]
    ranges: list[GapRange] = []
    start = missing_times[0]
    previous = missing_times[0]

    def finalize(range_start: datetime, range_end: datetime) -> None:
        timestamps = list(iter_range(range_start, range_end, step))
        ranges.append(
            GapRange(
                timeframe_mt5=timeframe_mt5,
                missing_from=range_start,
                missing_to=range_end,
                missing_bars=len(timestamps),
                gap_type=classify_gap(timestamps, date_to),
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


def analyze_timeframe(
    timeframe_mt5: str,
    symbol_aliases: list[str],
    date_from: datetime,
    date_to: datetime,
    window_days: int,
) -> tuple[dict, list[GapRange]]:
    existing_times = fetch_existing_times(
        symbol_aliases=symbol_aliases,
        timeframe_mt5=timeframe_mt5,
        date_from=date_from,
        date_to=date_to,
        window_days=window_days,
    )

    if not existing_times:
        return {
            "timeframe": timeframe_mt5,
            "bars": 0,
            "existing_from": None,
            "existing_to": None,
            "status": "empty_in_db",
        }, []

    effective_from = max(date_from, min(existing_times))
    timeline = list(iter_range(effective_from, date_to, TF_DELTA[timeframe_mt5]))
    missing_times = [ts for ts in timeline if ts not in existing_times]
    gaps = group_missing_ranges(missing_times, timeframe_mt5, date_to)

    return {
        "timeframe": timeframe_mt5,
        "bars": len(existing_times),
        "existing_from": min(existing_times),
        "existing_to": max(existing_times),
        "status": "ok",
    }, gaps


def filter_df_to_missing_candles(df, timeframe_mt5: str, missing_times: set[datetime]) -> list[dict]:
    if df is None or df.empty:
        return []

    item = build_batch_item(BTC_SYMBOL, timeframe_mt5, df)
    missing_iso = {ts.strftime("%Y-%m-%dT%H:%M:%S.000Z") for ts in missing_times}
    return [candle for candle in item["candles"] if candle["time"] in missing_iso]


def repair_gap(fetcher: HistoricalFetcher, gap: GapRange, push_max_candles: int, apply: bool) -> dict:
    step = TF_DELTA[gap.timeframe_mt5]
    missing_times = set(iter_range(gap.missing_from, gap.missing_to, step))
    date_from = gap.missing_from.replace(tzinfo=None)
    date_to = (gap.missing_to + step).replace(tzinfo=None)

    df = fetcher.fetch_range(BTC_SYMBOL["mt5"], gap.timeframe_mt5, date_from, date_to)
    candles = filter_df_to_missing_candles(df, gap.timeframe_mt5, missing_times)

    if not candles:
        return {
            "timeframe": gap.timeframe_mt5,
            "gap_type": gap.gap_type,
            "missing_bars": gap.missing_bars,
            "repaired_bars": 0,
            "status": "skipped_no_mt5_data",
        }

    if apply:
        for candle_chunk in chunked_list(candles, push_max_candles):
            push_batch([{
                "symbol": BTC_SYMBOL["tv"],
                "exchange": "MT5",
                "timeframe": TV_TF_MAP[gap.timeframe_mt5],
                "candles": candle_chunk,
            }])
        status = "pushed"
    else:
        status = "dry_run"

    return {
        "timeframe": gap.timeframe_mt5,
        "gap_type": gap.gap_type,
        "missing_bars": gap.missing_bars,
        "repaired_bars": len(candles),
        "status": status,
    }


def print_summary(summary_rows: list[dict]) -> None:
    print("=" * 96)
    print(f"{'TF':<6} {'Bars':>10} {'Existing From (UTC)':<22} {'Existing To (UTC)':<22} {'Status':<18}")
    print("-" * 96)
    for row in summary_rows:
        existing_from = row["existing_from"].strftime("%Y-%m-%d %H:%M") if row["existing_from"] else "-"
        existing_to = row["existing_to"].strftime("%Y-%m-%d %H:%M") if row["existing_to"] else "-"
        print(
            f"{row['timeframe']:<6} {row['bars']:>10,} "
            f"{existing_from:<22} {existing_to:<22} {row['status']:<18}"
        )
    print("=" * 96)


def print_gaps(gaps: list[GapRange]) -> None:
    print("=" * 108)
    print(f"{'TF':<6} {'Type':<28} {'Missing':>8} {'From (UTC)':<22} {'To (UTC)':<22}")
    print("-" * 108)
    for gap in gaps:
        print(
            f"{gap.timeframe_mt5:<6} {gap.gap_type:<28} {gap.missing_bars:>8} "
            f"{gap.missing_from.strftime('%Y-%m-%d %H:%M'):<22} "
            f"{gap.missing_to.strftime('%Y-%m-%d %H:%M'):<22}"
        )
    print("=" * 108)


def main() -> None:
    args = parse_args()
    timeframes = [tf for tf in TF_ORDER if tf in args.timeframes]
    symbol_aliases = list(dict.fromkeys(args.api_symbols))

    date_from = parse_utc_date(args.date_from)
    raw_date_to = parse_utc_date(args.date_to, end_of_day=True) if args.date_to else datetime.now(timezone.utc)

    summary_rows: list[dict] = []
    all_gaps: list[GapRange] = []

    for timeframe_mt5 in timeframes:
        aligned_from = align_down(date_from, TF_DELTA[timeframe_mt5])
        aligned_to = align_down(raw_date_to, TF_DELTA[timeframe_mt5])
        summary, gaps = analyze_timeframe(
            timeframe_mt5=timeframe_mt5,
            symbol_aliases=symbol_aliases,
            date_from=aligned_from,
            date_to=aligned_to,
            window_days=args.api_window_days,
        )
        summary_rows.append(summary)
        all_gaps.extend(gaps)

    all_gaps.sort(key=lambda item: (item.timeframe_mt5, item.missing_bars, item.missing_from), reverse=True)
    repairable = [gap for gap in all_gaps if gap.gap_type in REPAIRABLE_GAP_TYPES]

    print_summary(summary_rows)
    print()
    print_gaps(all_gaps)

    if not repairable:
        print("\nNo repairable BTC MT5 gaps found.")
        return

    print("\nRepair candidates:")
    for gap in repairable:
        print(
            f"  {gap.timeframe_mt5:<4} {gap.gap_type:<12} "
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
                "Repairing BTCUSDc/%s %s %s -> %s (%s missing bars)",
                gap.timeframe_mt5,
                gap.gap_type,
                gap.missing_from.isoformat(),
                gap.missing_to.isoformat(),
                gap.missing_bars,
            )
            results.append(repair_gap(fetcher, gap, args.push_max_candles, args.apply))
    finally:
        connector.disconnect()

    print("\nRepair summary:")
    for result in results:
        print(
            f"  {result['timeframe']:<4} {result['gap_type']:<12} "
            f"missing={result['missing_bars']:<6} repaired={result['repaired_bars']:<6} status={result['status']}"
        )


if __name__ == "__main__":
    main()
