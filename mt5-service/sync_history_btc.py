"""
sync_history_btc.py - One-time historical sync for BTCUSDc from MT5.

Follows same date/chunk flow as sync_history_metals.py for XAU/XAG:
- process order: D1 -> H4 -> H1 -> M15 -> M5 -> M1
- default start date: 2017-01-01
- chunked MT5 fetch + batch push to TV-GIT
- separate resume state file so it does not interfere with sync_history_metals.py

Important:
- MT5 symbol: BTCUSDc
- DB/API symbol: BTCUSD
- BTC trades 24/7 — no weekend skips

Usage:
  python sync_history_btc.py
  python sync_history_btc.py --timeframes D1 H4 H1
  python sync_history_btc.py --from 2020-01-01
  python sync_history_btc.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta

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
logger = logging.getLogger("sync_mt5_assets")

logging.getLogger("historical_fetcher").setLevel(logging.WARNING)
logging.getLogger("mt5_connector").setLevel(logging.WARNING)
logging.getLogger("pusher").setLevel(logging.WARNING)


BTC_SYMBOL = {
    "mt5": "BTCUSDc",
    "tv": "BTCUSD",
}

TF_ORDER = ["MN1", "W1", "D3", "D1", "H12", "H4", "H3", "H2", "H1", "M30", "M15", "M5", "M1"]

TF_CHUNK_DAYS = {
    "M1": 7,
    "M5": 15,
    "M15": 30,
    "M30": 60,
    "H1": 90,
    "H2": 180,
    "H3": 270,
    "H4": 365,
    "H12": 1095,
    "D1": 365,
    "D3": 1095,
    "W1": 3650,
    "MN1": 14600,
}

DEFAULT_FROM = datetime(2017, 1, 1)
PUSH_MAX_CANDLES = 2000
RESUME_STATE_FILE = os.path.join(os.path.dirname(__file__), ".sync_history_btc_state.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Historical MT5 sync for BTCUSDc")
    parser.add_argument(
        "--timeframes",
        nargs="+",
        default=TF_ORDER,
        choices=TF_ORDER,
        help="TFs to sync (default: all)",
    )
    parser.add_argument(
        "--from",
        dest="date_from",
        default=None,
        help="Start date YYYY-MM-DD (default: 2017-01-01)",
    )
    parser.add_argument(
        "--to",
        dest="date_to",
        default=None,
        help="End date YYYY-MM-DD (default: today)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print estimates without fetching",
    )
    return parser.parse_args()


def is_weekend(dt: datetime, symbol: str = "") -> bool:
    # Crypto trades 24/7
    if "BTC" in symbol.upper():
        return False
    return dt.weekday() >= 5


def trading_days_in_range(date_from: datetime, date_to: datetime, symbol: str = "") -> int:
    total = 0
    cursor = date_from
    is_crypto = "BTC" in symbol.upper()
    while cursor < date_to:
        if is_crypto or cursor.weekday() < 5:
            total += 1
        cursor += timedelta(days=1)
    return total


def estimate_bars(date_from: datetime, date_to: datetime, tf_name: str, symbol: str = "") -> int:
    is_crypto = "BTC" in symbol.upper()
    hours_per_day = 24 if is_crypto else 23
    trading_hours = trading_days_in_range(date_from, date_to, symbol) * hours_per_day
    bars_per_hour = {"M1": 60, "M5": 12, "M15": 4, "M30": 2, "H1": 1, "H2": 0.5, "H3": 0.33, "H4": 0.25, "H12": 1/12, "D1": 1 / hours_per_day, "D3": 1 / (hours_per_day*3), "W1": 1 / (hours_per_day*7), "MN1": 1 / (hours_per_day*30)}
    return int(trading_hours * bars_per_hour.get(tf_name, 1))


def chunk_df(df, max_candles: int):
    for index in range(0, len(df), max_candles):
        yield df.iloc[index:index + max_candles]


def fmt_progress(done: int, total: int, start_ts: float) -> str:
    pct = done / total * 100 if total > 0 else 0
    elapsed = time.time() - start_ts
    if done > 0 and done < total:
        eta_secs = elapsed / done * (total - done)
        eta_str = f"{int(eta_secs // 3600)}h{int((eta_secs % 3600) // 60):02d}m"
    else:
        eta_str = "--"
    bar_len = 20
    filled = int(bar_len * done / total) if total > 0 else 0
    bar = "#" * filled + "-" * (bar_len - filled)
    return f"[{bar}] {pct:5.1f}% | {done:,}/{total:,} chunks | ETA {eta_str}"


def load_resume_state() -> dict:
    try:
        with open(RESUME_STATE_FILE) as file:
            return json.load(file)
    except Exception:
        return {}


def save_resume_cursor(state: dict, symbol_tv: str, tf_name: str, cursor: datetime) -> None:
    key = f"{symbol_tv}/{tf_name}"
    state[key] = cursor.isoformat()
    try:
        with open(RESUME_STATE_FILE, "w") as file:
            json.dump(state, file)
    except Exception:
        pass


def clear_resume_cursor(state: dict, symbol_tv: str, tf_name: str) -> None:
    key = f"{symbol_tv}/{tf_name}"
    if key in state:
        state.pop(key, None)
        try:
            with open(RESUME_STATE_FILE, "w") as file:
                json.dump(state, file)
        except Exception:
            pass


def sync_symbol_tf(
    fetcher: HistoricalFetcher,
    symbol_cfg: dict,
    tf_name: str,
    date_from: datetime,
    date_to: datetime,
    dry_run: bool,
    resume_state: dict,
) -> dict:
    symbol_mt5 = symbol_cfg["mt5"]
    symbol_tv = symbol_cfg["tv"]
    key = f"{symbol_tv}/{tf_name}"

    if key in resume_state:
        saved = datetime.fromisoformat(resume_state[key])
        if saved > date_from:
            logger.info("  Resume: continuing from %s (interrupted run)", saved.date())
            date_from = saved

    if date_from >= date_to:
        logger.info("  %s/%s: already complete", symbol_tv, tf_name)
        clear_resume_cursor(resume_state, symbol_tv, tf_name)
        return {"symbol": symbol_tv, "tf": tf_name, "chunks": 0, "bars": 0, "skipped": True}

    chunk_days = TF_CHUNK_DAYS.get(tf_name, 30)
    est_bars = estimate_bars(date_from, date_to, tf_name, symbol_mt5)
    est_chunks = max(1, int((date_to - date_from).days / chunk_days))

    logger.info(
        "  %s/%s: %s -> %s (~%s bars, ~%s chunks)",
        symbol_tv,
        tf_name,
        date_from.date(),
        date_to.date(),
        f"{est_bars:,}",
        est_chunks,
    )

    if dry_run:
        return {"symbol": symbol_tv, "tf": tf_name, "chunks": est_chunks, "bars": est_bars, "skipped": False}

    total_bars = 0
    total_chunks = 0
    start_ts = time.time()
    cursor = date_from

    while cursor < date_to:
        chunk_end = min(cursor + timedelta(days=chunk_days), date_to)

        if is_weekend(cursor, symbol_mt5) and is_weekend(chunk_end - timedelta(seconds=1), symbol_mt5):
            cursor = chunk_end
            save_resume_cursor(resume_state, symbol_tv, tf_name, cursor)
            continue

        try:
            df = fetcher.fetch_range(symbol_mt5, tf_name, cursor, chunk_end)
        except Exception as error:
            logger.error("    Fetch error [%s -> %s]: %s", cursor.date(), chunk_end.date(), error)
            cursor = chunk_end
            save_resume_cursor(resume_state, symbol_tv, tf_name, cursor)
            continue

        if not df.empty:
            for sub_df in chunk_df(df, PUSH_MAX_CANDLES):
                item = build_batch_item(symbol_cfg, tf_name, sub_df)
                if item:
                    push_batch([item])
                    total_bars += len(sub_df)

            total_chunks += 1
            chunks_done = int((cursor - date_from).days / chunk_days)
            progress = fmt_progress(chunks_done, est_chunks, start_ts)
            print(f"\r  {symbol_tv}/{tf_name} {progress}", end="", flush=True)

        cursor = chunk_end
        save_resume_cursor(resume_state, symbol_tv, tf_name, cursor)

    print()
    clear_resume_cursor(resume_state, symbol_tv, tf_name)
    elapsed = time.time() - start_ts
    logger.info("  Done %s/%s: %s bars in %.0fs", symbol_tv, tf_name, f"{total_bars:,}", elapsed)
    return {"symbol": symbol_tv, "tf": tf_name, "chunks": total_chunks, "bars": total_bars, "skipped": False}


def main() -> None:
    args = parse_args()

    date_from = datetime.strptime(args.date_from, "%Y-%m-%d") if args.date_from else DEFAULT_FROM
    date_to = datetime.strptime(args.date_to, "%Y-%m-%d") if args.date_to else datetime.now()
    timeframes = [tf for tf in TF_ORDER if tf in args.timeframes]

    print("=" * 65)
    print(f"  Historical sync: 1 symbol x {len(timeframes)} TFs")
    print(f"  Symbol: {BTC_SYMBOL['mt5']} -> {BTC_SYMBOL['tv']}")
    print(f"  Range: {date_from.date()} -> {date_to.date()}")
    print(f"  Mode:  {'DRY RUN (no fetch)' if args.dry_run else 'LIVE'}")
    print("=" * 65)

    if args.dry_run:
        total_est = 0
        print("\nEstimates:")
        for tf_name in timeframes:
            est = estimate_bars(date_from, date_to, tf_name, BTC_SYMBOL["mt5"])
            total_est += est
            print(f"  {BTC_SYMBOL['tv']:<10} {tf_name:<6} ~{est:>10,} bars")
        print(f"\n  Total: ~{total_est:,} bars across {len(timeframes)} combinations")
        return

    connector = MT5Connector()
    if not connector.connect():
        print("[ERROR] Cannot connect to MT5")
        sys.exit(1)

    fetcher = HistoricalFetcher(connector)
    resume_state = load_resume_state()
    results = []
    total_start = time.time()

    try:
        for tf_name in timeframes:
            print(f"\n--- Timeframe: {tf_name} ---")
            result = sync_symbol_tf(fetcher, BTC_SYMBOL, tf_name, date_from, date_to, args.dry_run, resume_state)
            results.append(result)
    finally:
        connector.disconnect()

    total_elapsed = time.time() - total_start
    total_bars = sum(result.get("bars", 0) for result in results)
    skipped = sum(1 for result in results if result.get("skipped"))
    synced = len(results) - skipped

    print("\n" + "=" * 65)
    print(f"  Sync complete in {int(total_elapsed // 3600)}h{int((total_elapsed % 3600) // 60):02d}m")
    print(f"  Synced:  {synced} timeframe pairs")
    print(f"  Skipped: {skipped} (already up to date)")
    print(f"  Total bars pushed: {total_bars:,}")
    print("=" * 65)


if __name__ == "__main__":
    main()
