"""
check_history.py - Check available historical data from MT5 broker.

Output:
  - Oldest bar date per symbol/timeframe
  - Total bar count
  - Years of history available

Run: python check_history.py
"""
import os
import sys
import logging
from datetime import datetime, timedelta, timezone

import MetaTrader5 as mt5
import pandas as pd
from dotenv import load_dotenv
import yaml

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")

_cfg_path = os.path.join(os.path.dirname(__file__), "config.yaml")
with open(_cfg_path) as f:
    cfg = yaml.safe_load(f)

TF_MAP = {
    "M1":  mt5.TIMEFRAME_M1,
    "M5":  mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "H1":  mt5.TIMEFRAME_H1,
    "H4":  mt5.TIMEFRAME_H4,
    "D1":  mt5.TIMEFRAME_D1,
}

PROBE_FROM = datetime(2000, 1, 1)
PROBE_TO   = datetime.now(timezone.utc).replace(tzinfo=None)


def connect() -> bool:
    if not mt5.initialize():
        print(f"[ERROR] MT5 initialize failed: {mt5.last_error()}")
        return False
    login    = int(os.environ["MT5_LOGIN"])
    password = os.environ["MT5_PASSWORD"]
    server   = os.environ["MT5_SERVER"]
    if not mt5.login(login, password, server):
        print(f"[ERROR] MT5 login failed: {mt5.last_error()}")
        return False
    print(f"Connected to MT5 - Version: {mt5.version()}\n")
    return True


# Chunk size per TF for binary search (days per probe)
TF_CHUNK_DAYS = {
    "M1": 30, "M5": 30, "M15": 60,
    "H1": 90, "H4": 365, "D1": 365,
}


def _probe_range(symbol_mt5: str, tf: int, date_from: datetime, days: int):
    """Try fetching a short range. Returns rates or None."""
    date_to = date_from + timedelta(days=days)
    rates = mt5.copy_rates_range(symbol_mt5, tf, date_from, date_to)
    if rates is not None and len(rates) > 0:
        return rates
    return None


def find_oldest_date(symbol_mt5: str, tf: int, tf_name: str) -> datetime | None:
    """
    Binary search for the oldest available date by probing short windows.
    Works even when the terminal refuses long-range requests.
    """
    chunk = TF_CHUNK_DAYS.get(tf_name, 30)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # Search back year by year to find the earliest year with data
    oldest_found = None
    for years_back in range(1, 15):
        probe_start = datetime(now.year - years_back, 1, 1)
        rates = _probe_range(symbol_mt5, tf, probe_start, chunk)
        if rates is not None:
            oldest_found = probe_start
        else:
            break  # No data this far back — stop searching

    return oldest_found


def check_symbol_tf(symbol_mt5: str, symbol_tv: str, tf_name: str) -> dict:
    tf = TF_MAP.get(tf_name)
    if tf is None:
        return {"symbol_tv": symbol_tv, "tf": tf_name, "oldest": None,
                "newest": None, "bars": 0, "years": 0, "error": f"Unknown TF: {tf_name}"}

    # First try full range from 2000 (fast path for D1/H4 which have deep local history)
    rates = mt5.copy_rates_range(symbol_mt5, tf, PROBE_FROM, PROBE_TO)

    if rates is None or len(rates) == 0:
        # Fallback: binary search for oldest available date using short probes
        oldest_start = find_oldest_date(symbol_mt5, tf, tf_name)
        if oldest_start is None:
            err = mt5.last_error()
            return {"symbol_tv": symbol_tv, "tf": tf_name, "oldest": None,
                    "newest": None, "bars": 0, "years": 0, "error": str(err)}
        # Get a recent chunk to confirm data exists and find newest bar
        chunk = TF_CHUNK_DAYS.get(tf_name, 30)
        recent = _probe_range(symbol_mt5, tf, datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=chunk), chunk)
        newest_bar = pd.to_datetime(recent[-1]["time"], unit="s") if recent is not None else None
        years = ((newest_bar - pd.Timestamp(oldest_start)).days / 365.25) if newest_bar else 0
        return {
            "symbol_tv": symbol_tv,
            "tf":        tf_name,
            "oldest":    pd.Timestamp(oldest_start),
            "newest":    newest_bar,
            "bars":      -1,  # unknown total (chunked access only)
            "years":     round(years, 1),
            "error":     None,
            "note":      "chunked-access-only",
        }

    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s")

    oldest = df["time"].min()
    newest = df["time"].max()
    bars   = len(df)
    years  = (newest - oldest).days / 365.25

    return {
        "symbol_tv": symbol_tv,
        "tf":        tf_name,
        "oldest":    oldest,
        "newest":    newest,
        "bars":      bars,
        "years":     round(years, 1),
        "error":     None,
    }


def print_results(results: list) -> None:
    print("=" * 75)
    print(f"{'Symbol':<10} {'TF':<6} {'Oldest':<14} {'Newest':<14} {'Bars':>10} {'Years':>6}")
    print("-" * 75)

    prev_symbol = None
    for r in results:
        sym = r["symbol_tv"]
        if sym != prev_symbol and prev_symbol is not None:
            print()
        prev_symbol = sym

        if r.get("error") and not r["oldest"]:
            print(f"{sym:<10} {r['tf']:<6} {'N/A':<14} {'N/A':<14} {'ERROR':>10}  {r['error']}")
            continue

        oldest_str = r["oldest"].strftime("%Y-%m-%d") if r["oldest"] else "N/A"
        newest_str = r["newest"].strftime("%Y-%m-%d") if r["newest"] else "N/A"
        print(f"{sym:<10} {r['tf']:<6} {oldest_str:<14} {newest_str:<14} {r['bars']:>10,} {r['years']:>6.1f}y")

    print("=" * 75)

    # Recommended --from dates for sync_10y.py
    print("\nRecommended --from dates for sync_10y.py:")
    by_tf: dict = {}
    for r in results:
        if r["oldest"] and not r.get("error"):
            by_tf.setdefault(r["tf"], []).append(r["oldest"])

    for tf_name in ["D1", "H4", "H1", "M15", "M5", "M1"]:
        if tf_name not in by_tf:
            continue
        # Use latest oldest across symbols (the real limit)
        limiting_oldest = max(by_tf[tf_name])
        print(f"  --timeframes {tf_name:<4} --from {limiting_oldest.strftime('%Y-%m-%d')}")


def main() -> None:
    if not connect():
        sys.exit(1)

    symbols    = [s for s in cfg["symbols"] if s.get("enabled", True)]
    timeframes = list(TF_MAP.keys())
    total      = len(symbols) * len(timeframes)
    results    = []
    count      = 0

    print(f"Checking {len(symbols)} symbols x {len(timeframes)} timeframes ({total} total)...\n")

    for sym in symbols:
        for tf in timeframes:
            count = count + 1
            print(f"  [{count}/{total}] {sym['tv']}/{tf} ...", end="\r", flush=True)
            results.append(check_symbol_tf(sym["mt5"], sym["tv"], tf))

    print(" " * 60, end="\r")
    mt5.shutdown()
    print_results(results)


if __name__ == "__main__":
    main()
