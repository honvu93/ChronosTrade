"""
Standalone gap scanner/backfill for the remote-ingestion Windows bundle.

Run this on the MT5 Windows machine after copying the `remote-ingestion` folder.
It reuses the same .env, API connection logic, MT5 connection, and push logic as
`mt5_remote_ingest.py`, but does not start the live scheduler.

Examples:
  python sync_gap_backfill.py
  python sync_gap_backfill.py --apply
  python sync_gap_backfill.py --symbols BTCUSD --timeframes M5 M1 --lookback-days 3 --apply
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

import requests

import mt5_remote_ingest as ingest

logger = logging.getLogger("remote-gap-backfill")

REPAIRABLE_GAP_TYPES = {"gap", "stale_tail", "empty_range"}
DEFAULT_LOOKBACK_DAYS = 14
DEFAULT_TIMEFRAMES = ["D1", "H4", "H1", "M15", "M5", "M1"]
DEFAULT_ALERT_WATCHLIST = [
    ("XAUUSD", "M5"),
    ("XAGUSD", "M5"),
    ("BTCUSD", "M5"),
]
ALERT_STALE_MINUTES = 15


@dataclass(frozen=True)
class GapRange:
    symbol_backend: str
    timeframe_mt5: str
    missing_from: datetime
    missing_to: datetime
    missing_bars: int
    gap_type: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan and backfill missing MT5 candle gaps safely")
    parser.add_argument("--symbols", nargs="+", default=None, help="Backend symbols to inspect. Default: all configured symbols")
    parser.add_argument(
        "--timeframes",
        nargs="+",
        default=DEFAULT_TIMEFRAMES,
        choices=sorted(ingest.TF_DELTA.keys()),
        help="Timeframes to inspect. Default: D1 H4 H1 M15 M5 M1",
    )
    parser.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS, help="Used when --from is omitted. Default: 14")
    parser.add_argument("--from", dest="date_from", default=None, help="UTC start date YYYY-MM-DD")
    parser.add_argument("--to", dest="date_to", default=None, help="UTC end date YYYY-MM-DD (default: now)")
    parser.add_argument("--min-gap-bars", type=int, default=1, help="Ignore contiguous gaps smaller than this many bars. Default: 1")
    parser.add_argument("--api-window-days", type=int, default=30, help="Days per TV-GIT API fetch window. Default: 30")
    parser.add_argument("--push-max-candles", type=int, default=1000, help="Max candles per POST chunk when applying repairs. Default: 1000")
    parser.add_argument("--apply", action="store_true", help="Actually fetch from MT5 and push repaired candles")
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


def resolve_symbols(requested: list[str] | None) -> list[dict]:
    if requested is None:
        return [dict(symbol) for symbol in ingest.SYMBOLS]

    requested_upper = {name.upper() for name in requested}
    resolved: list[dict] = []
    for symbol in ingest.SYMBOLS:
        aliases = {
            symbol["backend"].upper(),
            symbol["mt5"].upper(),
            str(symbol.get("mt5_fallback", "")).upper(),
        }
        if aliases & requested_upper:
            resolved.append(dict(symbol))
    return resolved


def api_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {ingest.INGESTION_TOKEN}"}


def fetch_existing_times(
    sym_cfg: dict,
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
) -> set[datetime]:
    timeframe_backend = ingest.TF_BACKEND_MAP[timeframe_mt5]
    times: set[datetime] = set()
    window = timedelta(days=window_days)

    api_symbols = [sym_cfg["backend"]]
    fallback = sym_cfg.get("mt5_fallback")
    if fallback:
        api_symbols.append(fallback)

    for api_symbol in dict.fromkeys(api_symbols):
        cursor = date_from
        while cursor < date_to:
            chunk_end = min(cursor + window, date_to + ingest.TF_DELTA[timeframe_mt5])
            response = requests.get(
                f"{ingest.API_URL}/api/ohlcv/{api_symbol}",
                params={
                    "timeframe": timeframe_backend,
                    "startTime": int(cursor.timestamp() * 1000),
                    "endTime": int(chunk_end.timestamp() * 1000),
                    "limit": 100000,
                },
                headers=api_headers(),
                timeout=60,
            )
            response.raise_for_status()
            for candle in response.json():
                candle_time = datetime.fromisoformat(candle["time"].replace("Z", "+00:00"))
                times.add(candle_time.astimezone(timezone.utc))
            cursor += window

    return times


def classify_gap_range(
    missing_times: list[datetime],
    sym_cfg: dict,
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
    if sym_cfg["market"] != "crypto" and all(ingest.is_metal_market_closed(timestamp) for timestamp in missing_times):
        return "closed_market"
    if missing_times[-1] >= date_to:
        return "stale_tail"
    return "gap"


def group_missing_ranges(
    missing_times: list[datetime],
    sym_cfg: dict,
    timeframe_mt5: str,
    date_to: datetime,
    min_gap_bars: int,
    has_existing_data: bool,
) -> list[GapRange]:
    if not missing_times:
        return []

    step = ingest.TF_DELTA[timeframe_mt5]
    ranges: list[GapRange] = []
    buffer: list[datetime] = [missing_times[0]]
    previous = missing_times[0]

    def finalize(current_buffer: list[datetime]) -> None:
        ranges.append(
            GapRange(
                symbol_backend=sym_cfg["backend"],
                timeframe_mt5=timeframe_mt5,
                missing_from=current_buffer[0],
                missing_to=current_buffer[-1],
                missing_bars=len(current_buffer),
                gap_type=classify_gap_range(
                    missing_times=current_buffer,
                    sym_cfg=sym_cfg,
                    date_to=date_to,
                    min_gap_bars=min_gap_bars,
                    has_existing_data=has_existing_data,
                ),
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
    sym_cfg: dict,
    timeframe_mt5: str,
    date_from: datetime,
    date_to: datetime,
    window_days: int,
    min_gap_bars: int,
) -> tuple[dict, list[GapRange]]:
    existing_times = fetch_existing_times(sym_cfg, timeframe_mt5, date_from, date_to, window_days)
    expected_timeline = [
        timestamp
        for timestamp in iter_range(date_from, date_to, ingest.TF_DELTA[timeframe_mt5])
        if sym_cfg["market"] == "crypto" or not ingest.is_metal_market_closed(timestamp)
    ]
    expected_set = set(expected_timeline)
    missing_times = sorted(timestamp for timestamp in expected_set if timestamp not in existing_times)
    gaps = group_missing_ranges(
        missing_times=missing_times,
        sym_cfg=sym_cfg,
        timeframe_mt5=timeframe_mt5,
        date_to=date_to,
        min_gap_bars=min_gap_bars,
        has_existing_data=bool(existing_times),
    )
    summary = {
        "symbol": sym_cfg["backend"],
        "timeframe": timeframe_mt5,
        "bars": len(existing_times),
        "expected": len(expected_set),
        "missing": len(missing_times),
        "existing_from": min(existing_times) if existing_times else None,
        "existing_to": max(existing_times) if existing_times else None,
        "status": "ok" if existing_times else "empty_in_window",
    }
    return summary, gaps


def filter_df_to_missing_candles(df, sym_cfg: dict, timeframe_mt5: str, missing_times: set[datetime]) -> list[dict]:
    if df is None or df.empty:
        return []
    item = ingest.build_batch_item(sym_cfg, timeframe_mt5, df)
    missing_iso = {timestamp.strftime("%Y-%m-%dT%H:%M:%S.000Z") for timestamp in missing_times}
    return [candle for candle in item["candles"] if candle["time"] in missing_iso]


def repair_gap(gap: GapRange, sym_cfg: dict, push_max_candles: int, apply: bool) -> dict:
    step = ingest.TF_DELTA[gap.timeframe_mt5]
    missing_times = set(iter_range(gap.missing_from, gap.missing_to, step))
    mt5_symbol = ingest._get_mt5_symbol(sym_cfg)
    with ingest._mt5_lock:
        df = ingest.fetch_ohlcv_range(
            mt5_symbol,
            gap.timeframe_mt5,
            align_down(gap.missing_from, step).replace(tzinfo=None),
            (gap.missing_to + step).replace(tzinfo=None),
        )
    candles = filter_df_to_missing_candles(df, sym_cfg, gap.timeframe_mt5, missing_times)

    result = {
        "symbol": gap.symbol_backend,
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
        for chunk in chunked_list(candles, push_max_candles):
            ingest.push_batch([
                {
                    "symbol": gap.symbol_backend,
                    "exchange": "MT5",
                    "timeframe": ingest.TF_BACKEND_MAP[gap.timeframe_mt5],
                    "candles": chunk,
                }
            ])
        result["status"] = "pushed"
    return result


def fetch_watchlist_freshness() -> list[dict]:
    now = datetime.now(timezone.utc)
    rows: list[dict] = []
    for symbol_backend, timeframe_mt5 in DEFAULT_ALERT_WATCHLIST:
        response = requests.get(
            f"{ingest.API_URL}/api/sync-status/{symbol_backend}",
            params={"timeframe": ingest.TF_BACKEND_MAP[timeframe_mt5]},
            headers=api_headers(),
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

        sym_cfg = next((symbol for symbol in ingest.SYMBOLS if symbol["backend"] == symbol_backend), None) or {"market": "crypto"}
        market_closed = sym_cfg["market"] != "crypto" and ingest.is_metal_market_closed(now)
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
                "symbol": symbol_backend,
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
            f"{gap.symbol_backend:<10} {gap.timeframe_mt5:<6} {gap.gap_type:<14} {gap.missing_bars:>8} "
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


def main() -> None:
    args = parse_args()
    ingest.API_URL = ingest.resolve_api_url()

    symbols = resolve_symbols(args.symbols)
    if not symbols:
        raise SystemExit("No symbols selected")

    if args.date_from:
        base_from = parse_utc_date(args.date_from)
    else:
        base_from = datetime.now(timezone.utc) - timedelta(days=args.lookback_days)
    base_to = parse_utc_date(args.date_to, end_of_day=True) if args.date_to else datetime.now(timezone.utc)

    if not ingest.mt5_connect():
        raise SystemExit(1)
    ingest.resolve_mt5_symbols()

    summary_rows: list[dict] = []
    all_gaps: list[GapRange] = []
    try:
        for sym_cfg in symbols:
            for timeframe_mt5 in args.timeframes:
                aligned_from = align_down(base_from, ingest.TF_DELTA[timeframe_mt5])
                aligned_to = align_down(base_to, ingest.TF_DELTA[timeframe_mt5])
                summary, gaps = analyze_symbol_timeframe(
                    sym_cfg=sym_cfg,
                    timeframe_mt5=timeframe_mt5,
                    date_from=aligned_from,
                    date_to=aligned_to,
                    window_days=args.api_window_days,
                    min_gap_bars=args.min_gap_bars,
                )
                summary_rows.append(summary)
                all_gaps.extend(gaps)

        all_gaps.sort(key=lambda gap: (gap.symbol_backend, gap.timeframe_mt5, gap.missing_from))
        repairable = [gap for gap in all_gaps if gap.gap_type in REPAIRABLE_GAP_TYPES]

        print_summary(summary_rows)
        print_gaps(all_gaps, "Detected gaps")
        print_gaps(repairable, "Repairable gaps")

        if repairable and args.apply:
            results = []
            for gap in repairable:
                sym_cfg = next(symbol for symbol in symbols if symbol["backend"] == gap.symbol_backend)
                results.append(repair_gap(gap, sym_cfg, args.push_max_candles, apply=True))
            print_repair_results(results)
        elif not args.apply:
            print("\nDry-run mode. Re-run with --apply to fetch from MT5 and push only missing candles.")

        print_watchlist_freshness(fetch_watchlist_freshness())
    finally:
        ingest.mt5.shutdown()


if __name__ == "__main__":
    main()
