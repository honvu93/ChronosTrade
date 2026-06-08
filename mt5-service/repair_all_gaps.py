"""
Standalone gap repair for ALL symbols (XAUUSD, XAGUSD, BTCUSD).

Workflow:
1. Query TV-GIT API for existing candles
2. Build expected timeline (market-aware: skip weekends for metals)
3. Identify missing bars (gaps)
4. Fetch missing bars from MT5
5. Push back to TV-GIT

Examples:
  # Dry-run all symbols, all timeframes (report only)
  python repair_all_gaps.py

  # Repair only XAUUSD
  python repair_all_gaps.py --symbols XAUUSD --apply

  # Repair specific timeframes
  python repair_all_gaps.py --symbols XAUUSD BTCUSD --timeframes H1 M15 M5 --apply

  # Custom date range
  python repair_all_gaps.py --from 2026-03-01 --to 2026-03-26 --apply

  # Only show gaps > N bars
  python repair_all_gaps.py --min-gap 5
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from historical_fetcher import HistoricalFetcher
from mt5_connector import MT5Connector
from pusher import build_batch_item, push_batch
from symbol_config import (
    canonical_backend_symbol,
    get_enabled_symbols,
    is_crypto_symbol,
    symbol_aliases,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("repair_all_gaps")

TVGIT_URL = os.environ["TVGIT_URL"].rstrip("/")
INGESTION_TOKEN = os.environ.get("INGESTION_TOKEN", "").strip()

TF_ORDER = ["D1", "H4", "H1", "M30", "M15", "M5"]
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
}
TV_TF_MAP = {
    "M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m",
    "H1": "1h", "H2": "2h", "H3": "3h", "H4": "4h", "H12": "12h",
    "D1": "1d",
}

# --- Market hours ---
# Metals/FX: closed Friday ~21:00 UTC -> Sunday ~22:00 UTC
# Crypto: 24/7
METAL_CLOSE_WEEKDAY = 4   # Friday
METAL_CLOSE_HOUR = 21     # UTC
METAL_OPEN_WEEKDAY = 6    # Sunday
METAL_OPEN_HOUR = 22      # UTC


@dataclass(frozen=True)
class GapRange:
    symbol_tv: str
    symbol_mt5: str
    timeframe_mt5: str
    missing_from: datetime
    missing_to: datetime
    missing_bars: int
    gap_type: str  # scheduled_break, abnormal_gap, stale_tail


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detect and repair candle gaps for all symbols via MT5",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python repair_all_gaps.py                              # dry-run all
  python repair_all_gaps.py --symbols XAUUSD --apply     # repair XAU only
  python repair_all_gaps.py --timeframes H1 M5 --apply   # specific TFs
  python repair_all_gaps.py --from 2026-03-01 --apply    # from date
        """,
    )
    parser.add_argument(
        "--symbols", nargs="+", default=None,
        help="Symbols to check (default: all enabled). Use TV names: XAUUSD, XAGUSD, BTCUSD",
    )
    parser.add_argument(
        "--timeframes", nargs="+", default=["D1", "H4", "H1", "M15", "M5"],
        choices=list(TF_DELTA.keys()),
        help="Timeframes to check (default: D1 H4 H1 M15 M5)",
    )
    parser.add_argument(
        "--from", dest="date_from", default="2025-01-01",
        help="UTC start date YYYY-MM-DD (default: 2025-01-01)",
    )
    parser.add_argument(
        "--to", dest="date_to", default=None,
        help="UTC end date YYYY-MM-DD (default: now)",
    )
    parser.add_argument(
        "--min-gap", type=int, default=2,
        help="Minimum missing bars to consider a gap (default: 2)",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually fetch from MT5 and push. Default is report-only.",
    )
    parser.add_argument(
        "--api-window-days", type=int, default=45,
        help="Days per TV-GIT API fetch window (default: 45)",
    )
    parser.add_argument(
        "--push-max-candles", type=int, default=1000,
        help="Max candles per push call (default: 1000)",
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
        yield items[index : index + size]


def is_metal_market_closed(dt: datetime) -> bool:
    """
    Check if a UTC datetime falls within metal/FX market closed hours.
    Metals close Friday ~21:00 UTC, reopen Sunday ~22:00 UTC.
    """
    wd = dt.weekday()  # Mon=0 .. Sun=6
    hour = dt.hour

    # Saturday: always closed
    if wd == 5:
        return True
    # Friday after 21:00 UTC: closed
    if wd == 4 and hour >= METAL_CLOSE_HOUR:
        return True
    # Sunday before 22:00 UTC: closed
    if wd == 6 and hour < METAL_OPEN_HOUR:
        return True
    return False


def filter_expected_timeline(
    timeline: list[datetime], is_crypto: bool
) -> list[datetime]:
    """Remove timestamps that fall in market-closed periods."""
    if is_crypto:
        return timeline  # 24/7
    return [ts for ts in timeline if not is_metal_market_closed(ts)]


def _api_headers() -> dict:
    headers = {}
    if INGESTION_TOKEN:
        headers["Authorization"] = f"Bearer {INGESTION_TOKEN}"
    return headers


def fetch_existing_times(
    api_symbols: list[str],
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
) -> set[datetime]:
    """Query TV-GIT API for all existing candle timestamps."""
    timeframe_tv = TV_TF_MAP[timeframe_mt5]
    times: set[datetime] = set()
    window = timedelta(days=window_days)
    headers = _api_headers()

    for symbol in api_symbols:
        cursor = date_from
        while cursor < date_to:
            chunk_end = min(cursor + window, date_to + TF_DELTA[timeframe_mt5])
            params = {
                "timeframe": timeframe_tv,
                "startTime": int(cursor.timestamp() * 1000),
                "endTime": int(chunk_end.timestamp() * 1000),
                "limit": 100000,
            }
            try:
                resp = requests.get(
                    f"{TVGIT_URL}/api/ohlcv/{symbol}",
                    params=params,
                    headers=headers,
                    timeout=60,
                )
                resp.raise_for_status()
                for candle in resp.json():
                    ct = datetime.fromisoformat(candle["time"].replace("Z", "+00:00"))
                    times.add(ct.astimezone(timezone.utc))
            except Exception as e:
                logger.warning("API fetch failed %s/%s [%s]: %s", symbol, timeframe_tv, cursor.date(), e)
            cursor += window

    return times


def classify_gap(
    missing_times: list[datetime],
    date_to: datetime,
    is_crypto: bool,
    min_gap: int,
) -> str:
    """Classify a contiguous block of missing bars."""
    if len(missing_times) < min_gap:
        return "scheduled_break"

    # For non-crypto: if all missing times are in market-closed hours, skip
    if not is_crypto:
        all_closed = all(is_metal_market_closed(ts) for ts in missing_times)
        if all_closed:
            return "scheduled_break"

    # Stale tail = gap extends to the end of the analysis range
    if missing_times[-1] >= date_to - TF_DELTA.get("M5", timedelta(minutes=5)):
        return "stale_tail"

    return "abnormal_gap"


def group_missing_ranges(
    missing_times: list[datetime],
    symbol_tv: str,
    symbol_mt5: str,
    timeframe_mt5: str,
    date_to: datetime,
    is_crypto: bool,
    min_gap: int,
) -> list[GapRange]:
    if not missing_times:
        return []

    step = TF_DELTA[timeframe_mt5]
    ranges: list[GapRange] = []
    start = missing_times[0]
    previous = missing_times[0]
    buffer: list[datetime] = [missing_times[0]]

    def finalize(buf: list[datetime]) -> None:
        gap_type = classify_gap(buf, date_to, is_crypto, min_gap)
        ranges.append(
            GapRange(
                symbol_tv=symbol_tv,
                symbol_mt5=symbol_mt5,
                timeframe_mt5=timeframe_mt5,
                missing_from=buf[0],
                missing_to=buf[-1],
                missing_bars=len(buf),
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


def analyze_symbol_timeframe(
    symbol_cfg: dict,
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
    min_gap: int,
) -> tuple[dict, list[GapRange]]:
    """Analyze one symbol/timeframe pair for gaps."""
    symbol_tv = symbol_cfg["tv"]
    symbol_mt5 = symbol_cfg["mt5"]
    is_crypto = is_crypto_symbol(symbol_tv)
    api_symbols = symbol_aliases(symbol_tv)

    existing_times = fetch_existing_times(
        api_symbols=api_symbols,
        timeframe_mt5=timeframe_mt5,
        date_from=date_from,
        date_to=date_to,
        window_days=window_days,
    )

    if not existing_times:
        return {
            "symbol": symbol_tv,
            "timeframe": timeframe_mt5,
            "bars": 0,
            "existing_from": None,
            "existing_to": None,
            "status": "empty_in_db",
        }, []

    # Build expected timeline from first existing bar to date_to
    effective_from = max(date_from, min(existing_times))
    full_timeline = list(iter_range(effective_from, date_to, TF_DELTA[timeframe_mt5]))

    # Filter out market-closed periods for non-crypto
    expected_timeline = filter_expected_timeline(full_timeline, is_crypto)
    expected_set = set(expected_timeline)

    missing_times = sorted(ts for ts in expected_set if ts not in existing_times)
    gaps = group_missing_ranges(
        missing_times, symbol_tv, symbol_mt5, timeframe_mt5,
        date_to, is_crypto, min_gap,
    )

    return {
        "symbol": symbol_tv,
        "timeframe": timeframe_mt5,
        "bars": len(existing_times),
        "expected": len(expected_set),
        "missing": len(missing_times),
        "existing_from": min(existing_times),
        "existing_to": max(existing_times),
        "status": "ok",
    }, gaps


def filter_df_to_missing_candles(
    df, symbol_cfg: dict, timeframe_mt5: str, missing_times: set[datetime]
) -> list[dict]:
    """Filter MT5 fetched data to only missing timestamps."""
    if df is None or df.empty:
        return []

    item = build_batch_item(symbol_cfg, timeframe_mt5, df)
    missing_iso = {ts.strftime("%Y-%m-%dT%H:%M:%S.000Z") for ts in missing_times}
    return [c for c in item["candles"] if c["time"] in missing_iso]


def repair_gap(
    fetcher: HistoricalFetcher,
    gap: GapRange,
    push_max_candles: int,
    apply: bool,
) -> dict:
    """Fetch missing bars from MT5 and push to TV-GIT."""
    step = TF_DELTA[gap.timeframe_mt5]
    missing_times = set(iter_range(gap.missing_from, gap.missing_to, step))
    date_from = gap.missing_from.replace(tzinfo=None)
    date_to = (gap.missing_to + step).replace(tzinfo=None)

    df = fetcher.fetch_range(gap.symbol_mt5, gap.timeframe_mt5, date_from, date_to)

    symbol_cfg = {"mt5": gap.symbol_mt5, "tv": gap.symbol_tv}
    candles = filter_df_to_missing_candles(df, symbol_cfg, gap.timeframe_mt5, missing_times)

    result = {
        "symbol": gap.symbol_tv,
        "timeframe": gap.timeframe_mt5,
        "gap_type": gap.gap_type,
        "range": f"{gap.missing_from.strftime('%Y-%m-%d %H:%M')} -> {gap.missing_to.strftime('%Y-%m-%d %H:%M')}",
        "missing_bars": gap.missing_bars,
        "mt5_bars": len(candles),
    }

    if not candles:
        result["status"] = "no_mt5_data"
        return result

    if apply:
        for chunk in chunked_list(candles, push_max_candles):
            push_batch([{
                "symbol": gap.symbol_tv,
                "exchange": "MT5",
                "timeframe": TV_TF_MAP[gap.timeframe_mt5],
                "candles": chunk,
            }])
        result["status"] = "pushed"
    else:
        result["status"] = "dry_run"

    return result


# --- Display ---

REPAIRABLE = {"abnormal_gap", "stale_tail"}


def print_summary(rows: list[dict]) -> None:
    print()
    print("=" * 110)
    print(
        f"{'Symbol':<10} {'TF':<6} {'Bars':>10} {'Expected':>10} {'Missing':>8} "
        f"{'From (UTC)':<20} {'To (UTC)':<20} {'Status':<12}"
    )
    print("-" * 110)
    for r in rows:
        fr = r["existing_from"].strftime("%Y-%m-%d %H:%M") if r.get("existing_from") else "-"
        to = r["existing_to"].strftime("%Y-%m-%d %H:%M") if r.get("existing_to") else "-"
        print(
            f"{r['symbol']:<10} {r['timeframe']:<6} {r.get('bars', 0):>10,} "
            f"{r.get('expected', 0):>10,} {r.get('missing', 0):>8,} "
            f"{fr:<20} {to:<20} {r['status']:<12}"
        )
    print("=" * 110)


def print_gaps(gaps: list[GapRange], label: str = "All gaps") -> None:
    if not gaps:
        print(f"\n{label}: none found.")
        return

    print(f"\n{label} ({len(gaps)} total):")
    print("=" * 120)
    print(
        f"{'Symbol':<10} {'TF':<6} {'Type':<20} {'Missing':>8} "
        f"{'From (UTC)':<22} {'To (UTC)':<22} {'Hours':>8}"
    )
    print("-" * 120)
    for g in gaps:
        hours = (g.missing_to - g.missing_from).total_seconds() / 3600
        print(
            f"{g.symbol_tv:<10} {g.timeframe_mt5:<6} {g.gap_type:<20} {g.missing_bars:>8} "
            f"{g.missing_from.strftime('%Y-%m-%d %H:%M'):<22} "
            f"{g.missing_to.strftime('%Y-%m-%d %H:%M'):<22} "
            f"{hours:>8.1f}"
        )
    print("=" * 120)


def print_repair_results(results: list[dict]) -> None:
    print("\nRepair results:")
    print("=" * 130)
    print(
        f"{'Symbol':<10} {'TF':<6} {'Type':<16} {'Range':<42} "
        f"{'Missing':>8} {'MT5':>8} {'Status':<14}"
    )
    print("-" * 130)
    for r in results:
        print(
            f"{r['symbol']:<10} {r['timeframe']:<6} {r['gap_type']:<16} {r['range']:<42} "
            f"{r['missing_bars']:>8} {r['mt5_bars']:>8} {r['status']:<14}"
        )
    print("=" * 130)


def resolve_symbols(requested: list[str] | None) -> list[dict]:
    """Resolve symbol names to config entries."""
    all_enabled = get_enabled_symbols()

    if requested is None:
        return all_enabled

    result = []
    for name in requested:
        matched = None
        for cfg in all_enabled:
            if name.upper() in (cfg["tv"].upper(), cfg["mt5"].upper()):
                matched = cfg
                break
        if matched:
            if matched not in result:
                result.append(matched)
        else:
            logger.warning("Symbol %s not found in config.yaml — skipping", name)
    return result


def main() -> None:
    args = parse_args()
    symbols = resolve_symbols(args.symbols)
    timeframes = [tf for tf in TF_ORDER if tf in args.timeframes]

    if not symbols:
        print("No symbols to check. Available:", [s["tv"] for s in get_enabled_symbols()])
        return

    if not timeframes:
        print("No valid timeframes selected.")
        return

    date_from = parse_utc_date(args.date_from)
    date_to = parse_utc_date(args.date_to, end_of_day=True) if args.date_to else datetime.now(timezone.utc)

    print(f"Scanning gaps: {[s['tv'] for s in symbols]} x {timeframes}")
    print(f"Range: {date_from.strftime('%Y-%m-%d')} -> {date_to.strftime('%Y-%m-%d')}")
    print(f"Min gap size: {args.min_gap} bars")
    print(f"Mode: {'APPLY (will push to TV-GIT)' if args.apply else 'DRY-RUN (report only)'}")

    summary_rows: list[dict] = []
    all_gaps: list[GapRange] = []

    for symbol_cfg in symbols:
        for tf in timeframes:
            aligned_from = align_down(date_from, TF_DELTA[tf])
            aligned_to = align_down(date_to, TF_DELTA[tf])

            logger.info("Analyzing %s/%s ...", symbol_cfg["tv"], tf)
            summary, gaps = analyze_symbol_timeframe(
                symbol_cfg=symbol_cfg,
                timeframe_mt5=tf,
                date_from=aligned_from,
                date_to=aligned_to,
                window_days=args.api_window_days,
                min_gap=args.min_gap,
            )
            summary_rows.append(summary)
            all_gaps.extend(gaps)

    # Sort: largest gaps first
    all_gaps.sort(key=lambda g: (g.symbol_tv, g.timeframe_mt5, -g.missing_bars))
    repairable = [g for g in all_gaps if g.gap_type in REPAIRABLE]

    print_summary(summary_rows)
    print_gaps(all_gaps, "All detected gaps")
    print_gaps(repairable, "Repairable gaps (abnormal_gap + stale_tail)")

    if not repairable:
        print("\nNo repairable gaps found. Data looks clean!")
        return

    total_missing = sum(g.missing_bars for g in repairable)
    print(f"\nTotal repairable: {len(repairable)} gaps, {total_missing:,} missing bars")

    if not args.apply:
        print("\nDry-run mode. Re-run with --apply to fetch from MT5 and push repairs.")
        return

    # Connect to MT5 and repair
    print("\nConnecting to MT5...")
    connector = MT5Connector()
    if not connector.connect():
        print("ERROR: Cannot connect to MT5. Is the terminal running?")
        sys.exit(1)

    fetcher = HistoricalFetcher(connector)
    results: list[dict] = []

    try:
        for i, gap in enumerate(repairable, 1):
            logger.info(
                "[%d/%d] Repairing %s/%s %s: %s -> %s (%d bars)",
                i, len(repairable),
                gap.symbol_tv, gap.timeframe_mt5, gap.gap_type,
                gap.missing_from.strftime("%Y-%m-%d %H:%M"),
                gap.missing_to.strftime("%Y-%m-%d %H:%M"),
                gap.missing_bars,
            )
            results.append(repair_gap(fetcher, gap, args.push_max_candles, args.apply))
    finally:
        connector.disconnect()

    print_repair_results(results)

    pushed = sum(1 for r in results if r["status"] == "pushed")
    bars_pushed = sum(r["mt5_bars"] for r in results if r["status"] == "pushed")
    no_data = sum(1 for r in results if r["status"] == "no_mt5_data")
    print(f"\nDone: {pushed} gaps repaired ({bars_pushed:,} bars pushed), {no_data} gaps with no MT5 data")


if __name__ == "__main__":
    main()
