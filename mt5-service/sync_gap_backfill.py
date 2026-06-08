"""
Standalone gap scanner/backfill for MT5 market-data candles.

Purpose:
- run independently from the long-running mt5-service scheduler
- detect missing candles in TV-GIT for configured MT5 symbols/timeframes
- repair only the missing timestamps by fetching from MT5
- print watched 5m freshness so the operator can compare with Telegram alerts

Default mode is dry-run. Use --apply to actually push repaired candles.

Examples:
  python sync_gap_backfill.py
  python sync_gap_backfill.py --apply
  python sync_gap_backfill.py --symbols BTCUSD --timeframes M5 M1 --lookback-days 3 --apply
  python sync_gap_backfill.py --from 2026-03-01 --to 2026-03-26 --timeframes H1 M15 M5 --apply
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - optional for pure logic tests
    def load_dotenv(*_args, **_kwargs):
        return False

try:
    from symbol_config import (
        canonical_backend_symbol,
        get_enabled_symbols,
        get_symbol_config,
        is_crypto_symbol,
        symbol_aliases,
    )
except ModuleNotFoundError as import_error:  # pragma: no cover - local test fallback
    if import_error.name != "yaml":
        raise

    def canonical_backend_symbol(symbol_or_cfg):
        if isinstance(symbol_or_cfg, dict):
            return str(symbol_or_cfg.get("tv") or symbol_or_cfg.get("symbol") or "")
        return str(symbol_or_cfg)

    def get_enabled_symbols():
        return []

    def get_symbol_config(symbol_or_cfg):
        if isinstance(symbol_or_cfg, dict):
            return symbol_or_cfg
        return {"tv": str(symbol_or_cfg), "market": "crypto"}

    def is_crypto_symbol(symbol_or_cfg):
        if isinstance(symbol_or_cfg, dict):
            return str(symbol_or_cfg.get("market", "")).lower() == "crypto"
        return "BTC" in str(symbol_or_cfg).upper()

    def symbol_aliases(symbol_or_cfg):
        if isinstance(symbol_or_cfg, dict):
            aliases = [symbol_or_cfg.get("tv"), *symbol_or_cfg.get("aliases", [])]
            return [str(alias) for alias in aliases if alias]
        return [str(symbol_or_cfg)]

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("sync_gap_backfill")

TVGIT_URL = os.environ.get("TVGIT_URL", "").rstrip("/")
INGESTION_TOKEN = os.environ.get("INGESTION_TOKEN", "").strip()

DEFAULT_LOOKBACK_DAYS = 14
DEFAULT_TIMEFRAMES = ["D1", "H4", "H1", "M15", "M5", "M1"]
DEFAULT_ALERT_WATCHLIST = [
    ("XAUUSD", "M5"),
    ("XAGUSD", "M5"),
    ("BTCUSD", "M5"),
]
ALERT_STALE_MINUTES = 15

TF_DELTA = {
    "M1": timedelta(minutes=1),
    "M5": timedelta(minutes=5),
    "M15": timedelta(minutes=15),
    "M30": timedelta(minutes=30),
    "H1": timedelta(hours=1),
    "H2": timedelta(hours=2),
    "H3": timedelta(hours=3),
    "H4": timedelta(hours=4),
    "H12": timedelta(hours=12),
    "D1": timedelta(days=1),
    "D3": timedelta(days=3),
    "W1": timedelta(weeks=1),
    "MN1": timedelta(days=30),
}

TV_TF_MAP = {
    "M1": "1m",
    "M5": "5m",
    "M15": "15m",
    "M30": "30m",
    "H1": "1h",
    "H2": "2h",
    "H3": "3h",
    "H4": "4h",
    "H12": "12h",
    "D1": "1d",
    "D3": "3d",
    "W1": "1w",
    "MN1": "1M",
}

REPAIRABLE_GAP_TYPES = {"gap", "stale_tail", "empty_range"}


@dataclass(frozen=True)
class GapRange:
    symbol_tv: str
    symbol_mt5: str
    timeframe_mt5: str
    missing_from: datetime
    missing_to: datetime
    missing_bars: int
    gap_type: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan and backfill missing MT5 candle gaps safely")
    parser.add_argument(
        "--symbols",
        nargs="+",
        default=None,
        help="Symbols to inspect (TV, MT5, or configured aliases). Default: all enabled symbols",
    )
    parser.add_argument(
        "--timeframes",
        nargs="+",
        default=DEFAULT_TIMEFRAMES,
        choices=sorted(TF_DELTA.keys()),
        help="Timeframes to inspect. Default: D1 H4 H1 M15 M5 M1",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=DEFAULT_LOOKBACK_DAYS,
        help="Used only when --from is omitted. Default: 14",
    )
    parser.add_argument(
        "--from",
        dest="date_from",
        default=None,
        help="UTC start date YYYY-MM-DD. Overrides --lookback-days",
    )
    parser.add_argument(
        "--to",
        dest="date_to",
        default=None,
        help="UTC end date YYYY-MM-DD (default: now)",
    )
    parser.add_argument(
        "--min-gap-bars",
        type=int,
        default=1,
        help="Ignore contiguous gaps smaller than this many bars. Default: 1",
    )
    parser.add_argument(
        "--api-window-days",
        type=int,
        default=30,
        help="Days per TV-GIT API fetch window. Default: 30",
    )
    parser.add_argument(
        "--push-max-candles",
        type=int,
        default=1000,
        help="Max candles per POST chunk when applying repairs. Default: 1000",
    )
    parser.add_argument(
        "--report-file",
        default=None,
        help="Optional JSON report output path",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually fetch from MT5 and push repaired bars. Default: dry-run",
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


def is_metal_market_closed(dt: datetime) -> bool:
    weekday = dt.weekday()
    hour = dt.hour

    if weekday == 5:
        return True
    if weekday == 4 and hour >= 21:
        return True
    if weekday == 6 and hour < 22:
        return True
    return False


def filter_expected_timeline(
    timeline: list[datetime],
    crypto: bool,
) -> list[datetime]:
    if crypto:
        return timeline
    return [timestamp for timestamp in timeline if not is_metal_market_closed(timestamp)]


def classify_gap_range(
    missing_times: list[datetime],
    symbol_cfg: dict,
    date_to: datetime,
    min_gap_bars: int,
    has_existing_data: bool,
) -> str:
    if not missing_times:
        return "none"

    if len(missing_times) < min_gap_bars:
        return "micro_gap"

    if not has_existing_data:
        return "empty_range"

    if not is_crypto_symbol(symbol_cfg) and all(is_metal_market_closed(timestamp) for timestamp in missing_times):
        return "closed_market"

    if missing_times[-1] >= date_to:
        return "stale_tail"

    return "gap"


def group_missing_ranges(
    missing_times: list[datetime],
    symbol_cfg: dict,
    timeframe_mt5: str,
    date_to: datetime,
    min_gap_bars: int,
    has_existing_data: bool,
) -> list[GapRange]:
    if not missing_times:
        return []

    step = TF_DELTA[timeframe_mt5]
    ranges: list[GapRange] = []
    buffer: list[datetime] = [missing_times[0]]
    previous = missing_times[0]

    def finalize(current_buffer: list[datetime]) -> None:
        gap_type = classify_gap_range(
            missing_times=current_buffer,
            symbol_cfg=symbol_cfg,
            date_to=date_to,
            min_gap_bars=min_gap_bars,
            has_existing_data=has_existing_data,
        )
        ranges.append(
            GapRange(
                symbol_tv=symbol_cfg["tv"],
                symbol_mt5=symbol_cfg["mt5"],
                timeframe_mt5=timeframe_mt5,
                missing_from=current_buffer[0],
                missing_to=current_buffer[-1],
                missing_bars=len(current_buffer),
                gap_type=gap_type,
            )
        )

    for current in missing_times[1:]:
        if current - previous == step:
            buffer.append(current)
            previous = current
            continue
        finalize(buffer)
        buffer = [current]
        previous = current

    finalize(buffer)
    return ranges


def _api_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if INGESTION_TOKEN:
        headers["Authorization"] = f"Bearer {INGESTION_TOKEN}"
    return headers


def _requests():
    import requests

    return requests


def _require_api_env() -> None:
    if not TVGIT_URL:
        raise SystemExit("Missing TVGIT_URL in mt5-service/.env")


def resolve_symbols(requested: list[str] | None) -> list[dict]:
    enabled = get_enabled_symbols()
    if requested is None:
        return enabled

    resolved: list[dict] = []
    seen: set[str] = set()
    for name in requested:
        symbol_cfg = get_symbol_config(name)
        if symbol_cfg is None or not symbol_cfg.get("enabled", True):
            logger.warning("Symbol %s is not enabled in mt5-service/config.yaml - skipping", name)
            continue
        symbol_key = canonical_backend_symbol(symbol_cfg)
        if symbol_key in seen:
            continue
        seen.add(symbol_key)
        resolved.append(dict(symbol_cfg))
    return resolved


def fetch_existing_times(
    symbol_cfg: dict,
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
) -> set[datetime]:
    _require_api_env()
    requests = _requests()

    timeframe_tv = TV_TF_MAP[timeframe_mt5]
    times: set[datetime] = set()
    window = timedelta(days=window_days)
    headers = _api_headers()

    for api_symbol in symbol_aliases(symbol_cfg):
        cursor = date_from
        while cursor < date_to:
            chunk_end = min(cursor + window, date_to + TF_DELTA[timeframe_mt5])
            params = {
                "timeframe": timeframe_tv,
                "startTime": int(cursor.timestamp() * 1000),
                "endTime": int(chunk_end.timestamp() * 1000),
                "limit": 100000,
            }
            response = requests.get(
                f"{TVGIT_URL}/api/ohlcv/{api_symbol}",
                params=params,
                headers=headers,
                timeout=60,
            )
            response.raise_for_status()

            for candle in response.json():
                candle_time = datetime.fromisoformat(candle["time"].replace("Z", "+00:00"))
                times.add(candle_time.astimezone(timezone.utc))

            cursor += window

    return times


def analyze_symbol_timeframe(
    symbol_cfg: dict,
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
    min_gap_bars: int,
) -> tuple[dict, list[GapRange]]:
    existing_times = fetch_existing_times(
        symbol_cfg=symbol_cfg,
        timeframe_mt5=timeframe_mt5,
        date_from=date_from,
        date_to=date_to,
        window_days=window_days,
    )

    expected_timeline = filter_expected_timeline(
        list(iter_range(date_from, date_to, TF_DELTA[timeframe_mt5])),
        crypto=is_crypto_symbol(symbol_cfg),
    )
    expected_set = set(expected_timeline)
    missing_times = sorted(timestamp for timestamp in expected_set if timestamp not in existing_times)
    gaps = group_missing_ranges(
        missing_times=missing_times,
        symbol_cfg=symbol_cfg,
        timeframe_mt5=timeframe_mt5,
        date_to=date_to,
        min_gap_bars=min_gap_bars,
        has_existing_data=bool(existing_times),
    )

    summary = {
        "symbol": symbol_cfg["tv"],
        "timeframe": timeframe_mt5,
        "bars": len(existing_times),
        "expected": len(expected_set),
        "missing": len(missing_times),
        "existing_from": min(existing_times) if existing_times else None,
        "existing_to": max(existing_times) if existing_times else None,
        "status": "ok" if existing_times else "empty_in_window",
    }
    return summary, gaps


def filter_df_to_missing_candles(
    df,
    symbol_cfg: dict,
    timeframe_mt5: str,
    missing_times: set[datetime],
) -> list[dict]:
    if df is None or df.empty:
        return []

    from pusher import build_batch_item

    item = build_batch_item(symbol_cfg, timeframe_mt5, df)
    missing_iso = {timestamp.strftime("%Y-%m-%dT%H:%M:%S.000Z") for timestamp in missing_times}
    return [candle for candle in item["candles"] if candle["time"] in missing_iso]


def repair_gap(
    fetcher,
    gap: GapRange,
    push_max_candles: int,
    apply: bool,
) -> dict:
    from pusher import push_batch

    step = TF_DELTA[gap.timeframe_mt5]
    missing_times = set(iter_range(gap.missing_from, gap.missing_to, step))
    date_from = gap.missing_from.replace(tzinfo=None)
    date_to = (gap.missing_to + step).replace(tzinfo=None)

    df = fetcher.fetch_range(gap.symbol_mt5, gap.timeframe_mt5, date_from, date_to)
    symbol_cfg = {
        "mt5": gap.symbol_mt5,
        "tv": gap.symbol_tv,
    }
    candles = filter_df_to_missing_candles(
        df=df,
        symbol_cfg=symbol_cfg,
        timeframe_mt5=gap.timeframe_mt5,
        missing_times=missing_times,
    )

    result = {
        "symbol": gap.symbol_tv,
        "timeframe": gap.timeframe_mt5,
        "gap_type": gap.gap_type,
        "range": f"{gap.missing_from.isoformat()} -> {gap.missing_to.isoformat()}",
        "missing_bars": gap.missing_bars,
        "mt5_bars": len(candles),
        "status": "dry_run",
    }

    if not candles:
        result["status"] = "no_mt5_data"
        return result

    if apply:
        for candle_chunk in chunked_list(candles, push_max_candles):
            push_batch([
                {
                    "symbol": gap.symbol_tv,
                    "exchange": "MT5",
                    "timeframe": TV_TF_MAP[gap.timeframe_mt5],
                    "candles": candle_chunk,
                }
            ])
        result["status"] = "pushed"

    return result


def fetch_watchlist_freshness() -> list[dict]:
    _require_api_env()
    requests = _requests()

    now = datetime.now(timezone.utc)
    headers = _api_headers()
    rows: list[dict] = []

    for symbol_tv, timeframe_mt5 in DEFAULT_ALERT_WATCHLIST:
        response = requests.get(
            f"{TVGIT_URL}/api/sync-status/{symbol_tv}",
            params={"timeframe": TV_TF_MAP[timeframe_mt5]},
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()

        payload = response.json()
        latest_raw = payload.get("latest")
        latest = None
        lag_minutes = None
        if latest_raw:
            latest = datetime.fromisoformat(latest_raw.replace("Z", "+00:00")).astimezone(timezone.utc)
            lag_minutes = int((now - latest).total_seconds() // 60)

        symbol_cfg = get_symbol_config(symbol_tv) or {"tv": symbol_tv}
        market_closed = (
            latest is not None
            and not is_crypto_symbol(symbol_cfg)
            and is_metal_market_closed(now)
        )
        if market_closed:
            status = "market_closed"
        elif lag_minutes is None:
            status = "no_data"
        elif lag_minutes > ALERT_STALE_MINUTES:
            status = "stale"
        else:
            status = "fresh"

        rows.append(
            {
                "symbol": symbol_tv,
                "timeframe": timeframe_mt5,
                "latest": latest,
                "lag_minutes": lag_minutes,
                "status": status,
            }
        )

    return rows


def print_summary(summary_rows: list[dict]) -> None:
    print()
    print("=" * 112)
    print(
        f"{'Symbol':<10} {'TF':<6} {'Bars':>10} {'Expected':>10} {'Missing':>8} "
        f"{'From (UTC)':<20} {'To (UTC)':<20} {'Status':<16}"
    )
    print("-" * 112)
    for row in summary_rows:
        existing_from = row["existing_from"].strftime("%Y-%m-%d %H:%M") if row["existing_from"] else "-"
        existing_to = row["existing_to"].strftime("%Y-%m-%d %H:%M") if row["existing_to"] else "-"
        print(
            f"{row['symbol']:<10} {row['timeframe']:<6} {row['bars']:>10,} {row['expected']:>10,} "
            f"{row['missing']:>8,} {existing_from:<20} {existing_to:<20} {row['status']:<16}"
        )
    print("=" * 112)


def print_gaps(gaps: list[GapRange], label: str) -> None:
    if not gaps:
        print(f"\n{label}: none")
        return

    print(f"\n{label} ({len(gaps)}):")
    print("=" * 120)
    print(
        f"{'Symbol':<10} {'TF':<6} {'Type':<14} {'Missing':>8} "
        f"{'From (UTC)':<22} {'To (UTC)':<22} {'Hours':>8}"
    )
    print("-" * 120)
    for gap in gaps:
        hours = (gap.missing_to - gap.missing_from).total_seconds() / 3600
        print(
            f"{gap.symbol_tv:<10} {gap.timeframe_mt5:<6} {gap.gap_type:<14} {gap.missing_bars:>8} "
            f"{gap.missing_from.strftime('%Y-%m-%d %H:%M'):<22} "
            f"{gap.missing_to.strftime('%Y-%m-%d %H:%M'):<22} {hours:>8.1f}"
        )
    print("=" * 120)


def print_repair_results(results: list[dict]) -> None:
    print("\nRepair results:")
    print("=" * 138)
    print(
        f"{'Symbol':<10} {'TF':<6} {'Type':<14} {'Range':<52} "
        f"{'Missing':>8} {'MT5':>8} {'Status':<14}"
    )
    print("-" * 138)
    for result in results:
        print(
            f"{result['symbol']:<10} {result['timeframe']:<6} {result['gap_type']:<14} {result['range']:<52} "
            f"{result['missing_bars']:>8} {result['mt5_bars']:>8} {result['status']:<14}"
        )
    print("=" * 138)


def print_watchlist_freshness(rows: list[dict]) -> None:
    print("\nAlert watchlist freshness:")
    print("=" * 82)
    print(f"{'Symbol':<10} {'TF':<6} {'Latest (UTC)':<24} {'Lag(min)':>10} {'Status':<16}")
    print("-" * 82)
    for row in rows:
        latest = row["latest"].strftime("%Y-%m-%d %H:%M:%S") if row["latest"] else "-"
        lag = "-" if row["lag_minutes"] is None else str(row["lag_minutes"])
        print(f"{row['symbol']:<10} {row['timeframe']:<6} {latest:<24} {lag:>10} {row['status']:<16}")
    print("=" * 82)


def serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def write_report(
    path: str,
    summary_rows: list[dict],
    all_gaps: list[GapRange],
    repairable_gaps: list[GapRange],
    repair_results: list[dict],
    freshness_rows: list[dict],
) -> None:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": [
            {
                **row,
                "existing_from": serialize_datetime(row["existing_from"]),
                "existing_to": serialize_datetime(row["existing_to"]),
            }
            for row in summary_rows
        ],
        "all_gaps": [
            {
                **asdict(gap),
                "missing_from": gap.missing_from.isoformat(),
                "missing_to": gap.missing_to.isoformat(),
            }
            for gap in all_gaps
        ],
        "repairable_gaps": [
            {
                **asdict(gap),
                "missing_from": gap.missing_from.isoformat(),
                "missing_to": gap.missing_to.isoformat(),
            }
            for gap in repairable_gaps
        ],
        "repair_results": repair_results,
        "watchlist_freshness": [
            {
                **row,
                "latest": serialize_datetime(row["latest"]),
            }
            for row in freshness_rows
        ],
    }
    with open(path, "w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2)
    logger.info("Wrote report to %s", path)


def main() -> None:
    args = parse_args()

    symbols = resolve_symbols(args.symbols)
    if not symbols:
        raise SystemExit("No enabled symbols selected")

    if args.date_from:
        base_from = parse_utc_date(args.date_from)
    else:
        base_from = datetime.now(timezone.utc) - timedelta(days=args.lookback_days)
    base_to = parse_utc_date(args.date_to, end_of_day=True) if args.date_to else datetime.now(timezone.utc)

    timeframes = [timeframe for timeframe in DEFAULT_TIMEFRAMES if timeframe in args.timeframes]
    for timeframe in args.timeframes:
        if timeframe not in timeframes:
            timeframes.append(timeframe)

    summary_rows: list[dict] = []
    all_gaps: list[GapRange] = []

    for symbol_cfg in symbols:
        for timeframe_mt5 in timeframes:
            aligned_from = align_down(base_from, TF_DELTA[timeframe_mt5])
            aligned_to = align_down(base_to, TF_DELTA[timeframe_mt5])
            logger.info(
                "Analyzing %s/%s from %s to %s",
                symbol_cfg["tv"],
                timeframe_mt5,
                aligned_from.isoformat(),
                aligned_to.isoformat(),
            )
            summary, gaps = analyze_symbol_timeframe(
                symbol_cfg=symbol_cfg,
                timeframe_mt5=timeframe_mt5,
                date_from=aligned_from,
                date_to=aligned_to,
                window_days=args.api_window_days,
                min_gap_bars=args.min_gap_bars,
            )
            summary_rows.append(summary)
            all_gaps.extend(gaps)

    all_gaps.sort(key=lambda gap: (gap.symbol_tv, gap.timeframe_mt5, gap.missing_from))
    repairable_gaps = [gap for gap in all_gaps if gap.gap_type in REPAIRABLE_GAP_TYPES]

    print_summary(summary_rows)
    print_gaps(all_gaps, label="Detected gaps")
    print_gaps(repairable_gaps, label="Repairable gaps")

    repair_results: list[dict] = []
    if repairable_gaps and args.apply:
        from historical_fetcher import HistoricalFetcher
        from mt5_connector import MT5Connector

        connector = MT5Connector()
        if not connector.connect():
            raise SystemExit("Cannot connect to MT5")

        fetcher = HistoricalFetcher(connector)
        try:
            for gap in repairable_gaps:
                logger.info(
                    "Repairing %s/%s %s %s -> %s (%s bars)",
                    gap.symbol_tv,
                    gap.timeframe_mt5,
                    gap.gap_type,
                    gap.missing_from.isoformat(),
                    gap.missing_to.isoformat(),
                    gap.missing_bars,
                )
                repair_results.append(
                    repair_gap(
                        fetcher=fetcher,
                        gap=gap,
                        push_max_candles=args.push_max_candles,
                        apply=True,
                    )
                )
        finally:
            connector.disconnect()

        print_repair_results(repair_results)
    elif not args.apply:
        print("\nDry-run mode. Re-run with --apply to fetch from MT5 and push only missing candles.")

    freshness_rows = fetch_watchlist_freshness()
    print_watchlist_freshness(freshness_rows)

    if args.report_file:
        write_report(
            path=args.report_file,
            summary_rows=summary_rows,
            all_gaps=all_gaps,
            repairable_gaps=repairable_gaps,
            repair_results=repair_results,
            freshness_rows=freshness_rows,
        )


if __name__ == "__main__":
    main()
