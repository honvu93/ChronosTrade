"""
sync_history_metals.py - One-time historical sync for XAU/XAG (up to 14 years).

Runs independently alongside main.py (live service keeps running).
Fetches chunked ranges from MT5 and pushes to TV-GIT backend.

Usage:
  python sync_history_metals.py                            # all TFs, from 2017-01-01
  python sync_history_metals.py --timeframes D1 H4 H1      # specific TFs only
  python sync_history_metals.py --from 2020-01-01          # custom start date
  python sync_history_metals.py --symbols XAUUSDc          # specific symbols
  python sync_history_metals.py --dry-run                  # estimate only, no fetch

Process order: D1 -> H4 -> H1 -> M15 -> M5 -> M1 (coarse first)
Resume: saves cursor after every chunk (including weekend skips) for safe restart.
"""
import json
import os
import sys
import logging
import argparse
import time
from datetime import datetime, timedelta, timezone

import yaml
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("sync_10y")

# Suppress noisy sub-loggers during bulk sync
logging.getLogger("historical_fetcher").setLevel(logging.WARNING)
logging.getLogger("mt5_connector").setLevel(logging.WARNING)
logging.getLogger("pusher").setLevel(logging.WARNING)

from mt5_connector import MT5Connector
from historical_fetcher import HistoricalFetcher
from pusher import build_batch_item, push_batch
from symbol_config import canonical_backend_symbol, get_enabled_symbols

# --- Config ---
_cfg_path = os.path.join(os.path.dirname(__file__), "config.yaml")
with open(_cfg_path) as f:
    cfg = yaml.safe_load(f)

ALL_SYMBOLS = get_enabled_symbols("metal")

# Process order: coarse first (fast wins), M1 last (slowest)
TF_ORDER = ["MN1", "W1", "D3", "D1", "H12", "H4", "H3", "H2", "H1", "M30", "M15", "M5", "M1"]

# Chunk sizes per TF (days per MT5 request — tuned for broker limits)
TF_CHUNK_DAYS = {
    "M1":  7,    # ~10K bars/chunk
    "M5":  15,   # ~4.3K bars/chunk
    "M15": 30,   # ~2.9K bars/chunk
    "M30": 60,   # ~2.9K bars/chunk
    "H1":  90,   # ~2.2K bars/chunk
    "H2":  180,  # ~2.2K bars/chunk
    "H3":  270,  # ~2.2K bars/chunk
    "H4":  365,  # ~2.2K bars/chunk
    "H12": 1095, # ~2.2K bars/chunk
    "D1":  365,  # ~260 bars/chunk
    "D3":  1095, # ~260 bars/chunk
    "W1":  3650,
    "MN1": 14600,
}

TV_TF_MAP = {
    "M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m",
    "H1": "1h", "H2": "2h", "H3": "3h", "H4": "4h", "H12": "12h",
    "D1": "1d", "D3": "3d", "W1": "1w", "MN1": "1M",
}

DEFAULT_FROM = datetime(2017, 1, 1)
PUSH_MAX_CANDLES = 2000   # max candles per HTTP push


# --- Helpers ---

def parse_args():
    p = argparse.ArgumentParser(description="Historical sync for XAU/XAG")
    p.add_argument("--timeframes", nargs="+", default=TF_ORDER,
                   choices=TF_ORDER, help="TFs to sync (default: all)")
    p.add_argument("--symbols", nargs="+", default=None,
                   help="Backend symbol names to sync (default: all enabled metals)")
    p.add_argument("--from", dest="date_from", default=None,
                   help="Start date YYYY-MM-DD (default: 2017-01-01)")
    p.add_argument("--to", dest="date_to", default=None,
                   help="End date YYYY-MM-DD (default: today)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print estimates without fetching")
    return p.parse_args()


def get_last_synced(symbol_tv: str, tf_name: str) -> datetime | None:
    """Query TV-GIT API for the most recent bar in DB."""
    tf_tv = TV_TF_MAP.get(tf_name, tf_name.lower())
    try:
        url = f"{os.environ['TVGIT_URL']}/api/sync-status/{symbol_tv}"
        r = requests.get(url, params={"timeframe": tf_tv}, timeout=10)
        r.raise_for_status()
        latest = r.json().get("latest")
        if latest:
            dt = datetime.fromisoformat(latest.replace("Z", "+00:00"))
            return dt.replace(tzinfo=None)
    except Exception as e:
        logger.warning(f"Cannot get sync-status {symbol_tv}/{tf_tv}: {e}")
    return None


def is_weekend(dt: datetime) -> bool:
    return dt.weekday() >= 5


def trading_days_in_range(date_from: datetime, date_to: datetime) -> int:
    total = 0
    cursor = date_from
    while cursor < date_to:
        if cursor.weekday() < 5:
            total += 1
        cursor += timedelta(days=1)
    return total


def estimate_bars(date_from: datetime, date_to: datetime, tf_name: str) -> int:
    trading_hours = trading_days_in_range(date_from, date_to) * 23
    bars_per_hour = {"M1": 60, "M5": 12, "M15": 4, "M30": 2, "H1": 1, "H2": 0.5, "H3": 0.33, "H4": 0.25, "H12": 1/12, "D1": 1/23, "D3": 1/69, "W1": 1/115, "MN1": 1/500}
    return int(trading_hours * bars_per_hour.get(tf_name, 1))


def chunk_df(df, max_candles: int):
    """Split DataFrame into chunks of max_candles rows."""
    for i in range(0, len(df), max_candles):
        yield df.iloc[i:i + max_candles]


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


# --- Core sync ---

RESUME_STATE_FILE = os.path.join(os.path.dirname(__file__), ".sync_history_metals_state.json")


def load_resume_state() -> dict:
    """Load per-symbol/TF cursor from previous interrupted run."""
    try:
        with open(RESUME_STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def clear_resume_cursor(state: dict, symbol_tv: str, tf_name: str) -> None:
    key = f"{symbol_tv}/{tf_name}"
    if key in state:
        state.pop(key, None)
        try:
            with open(RESUME_STATE_FILE, "w") as f:
                json.dump(state, f)
        except Exception:
            pass


def save_resume_cursor(state: dict, symbol_tv: str, tf_name: str, cursor: datetime) -> None:
    """Persist current cursor so interrupted runs can resume mid-stream."""
    key = f"{symbol_tv}/{tf_name}"
    state[key] = cursor.isoformat()
    try:
        with open(RESUME_STATE_FILE, "w") as f:
            json.dump(state, f)
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
    symbol_tv  = symbol_cfg["tv"]
    key        = f"{symbol_tv}/{tf_name}"

    # Resume from interrupted run (file-based cursor, not API-based)
    if key in resume_state:
        saved = datetime.fromisoformat(resume_state[key])
        if saved > date_from:
            logger.info(f"  Resume: continuing from {saved.date()} (interrupted run)")
            date_from = saved

    if date_from >= date_to:
        logger.info(f"  {symbol_tv}/{tf_name}: already complete")
        clear_resume_cursor(resume_state, symbol_tv, tf_name)
        return {"symbol": symbol_tv, "tf": tf_name, "chunks": 0, "bars": 0, "skipped": True}

    chunk_days = TF_CHUNK_DAYS.get(tf_name, 30)
    est_bars   = estimate_bars(date_from, date_to, tf_name)
    est_chunks = max(1, int((date_to - date_from).days / chunk_days))

    logger.info(f"  {symbol_tv}/{tf_name}: {date_from.date()} -> {date_to.date()} "
                f"(~{est_bars:,} bars, ~{est_chunks} chunks)")

    if dry_run:
        return {"symbol": symbol_tv, "tf": tf_name, "chunks": est_chunks,
                "bars": est_bars, "skipped": False, "dry_run": True}

    total_bars   = 0
    total_chunks = 0
    start_ts     = time.time()
    cursor       = date_from

    while cursor < date_to:
        chunk_end = min(cursor + timedelta(days=chunk_days), date_to)

        # Skip weekend-only chunks
        if is_weekend(cursor) and is_weekend(chunk_end - timedelta(seconds=1)):
            cursor = chunk_end
            save_resume_cursor(resume_state, symbol_tv, tf_name, cursor)
            continue

        try:
            df = fetcher.fetch_range(symbol_mt5, tf_name, cursor, chunk_end)
        except Exception as e:
            logger.error(f"    Fetch error [{cursor.date()} -> {chunk_end.date()}]: {e}")
            cursor = chunk_end
            save_resume_cursor(resume_state, symbol_tv, tf_name, cursor)
            continue

        if not df.empty:
            # Push in sub-chunks of PUSH_MAX_CANDLES
            for sub_df in chunk_df(df, PUSH_MAX_CANDLES):
                item = build_batch_item(symbol_cfg, tf_name, sub_df)
                if item:
                    push_batch([item])
                    total_bars += len(sub_df)

            total_chunks += 1
            elapsed = time.time() - start_ts
            chunks_done = int((cursor - date_from).days / chunk_days)
            progress = fmt_progress(chunks_done, est_chunks, start_ts)
            print(f"\r  {symbol_tv}/{tf_name} {progress}", end="", flush=True)

        cursor = chunk_end
        save_resume_cursor(resume_state, symbol_tv, tf_name, cursor)

    print()  # newline after progress bar
    clear_resume_cursor(resume_state, symbol_tv, tf_name)
    elapsed = time.time() - start_ts
    logger.info(f"  Done {symbol_tv}/{tf_name}: {total_bars:,} bars in {elapsed:.0f}s")
    return {"symbol": symbol_tv, "tf": tf_name, "chunks": total_chunks, "bars": total_bars, "skipped": False}


# --- Main ---

def main():
    args = parse_args()

    date_from = datetime.strptime(args.date_from, "%Y-%m-%d") if args.date_from else DEFAULT_FROM
    date_to   = datetime.strptime(args.date_to,   "%Y-%m-%d") if args.date_to   else datetime.now()

    symbols = ALL_SYMBOLS
    if args.symbols:
        requested_symbols = {canonical_backend_symbol(symbol).upper() for symbol in args.symbols}
        symbols = [s for s in ALL_SYMBOLS if s["tv"].upper() in requested_symbols]
        if not symbols:
            print(f"[ERROR] No matching symbols: {args.symbols}")
            sys.exit(1)

    # Process TFs in defined order, filtered by user selection
    timeframes = [tf for tf in TF_ORDER if tf in args.timeframes]

    print("=" * 65)
    print(f"  Historical sync: {len(symbols)} symbols x {len(timeframes)} TFs")
    print(f"  Range: {date_from.date()} -> {date_to.date()}")
    print(f"  Mode:  {'DRY RUN (no fetch)' if args.dry_run else 'LIVE'}")
    print("=" * 65)

    if args.dry_run:
        print("\nEstimates:")
        total_est = 0
        for sym in symbols:
            for tf in timeframes:
                est = estimate_bars(date_from, date_to, tf)
                total_est += est
                print(f"  {sym['tv']:<10} {tf:<6} ~{est:>10,} bars")
        print(f"\n  Total: ~{total_est:,} bars across {len(symbols) * len(timeframes)} combinations")
        return

    # Connect MT5
    connector = MT5Connector()
    if not connector.connect():
        print("[ERROR] Cannot connect to MT5")
        sys.exit(1)

    fetcher      = HistoricalFetcher(connector)
    results      = []
    resume_state = load_resume_state()
    total_start  = time.time()

    try:
        for tf in timeframes:
            print(f"\n--- Timeframe: {tf} ---")
            for sym in symbols:
                result = sync_symbol_tf(fetcher, sym, tf, date_from, date_to, args.dry_run, resume_state)
                results.append(result)
    finally:
        connector.disconnect()

    # Summary
    total_elapsed = time.time() - total_start
    total_bars    = sum(r.get("bars", 0) for r in results)
    skipped       = sum(1 for r in results if r.get("skipped"))
    synced        = len(results) - skipped

    print("\n" + "=" * 65)
    print(f"  Sync complete in {int(total_elapsed // 3600)}h{int((total_elapsed % 3600) // 60):02d}m")
    print(f"  Synced:  {synced} symbol/TF pairs")
    print(f"  Skipped: {skipped} (already up to date)")
    print(f"  Total bars pushed: {total_bars:,}")
    print("=" * 65)


if __name__ == "__main__":
    main()
