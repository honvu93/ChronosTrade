"""
MT5 Remote Ingestion — Standalone script chay tren Windows.
Lay du lieu gia XAU, XAG, BTC tu MT5 va day thang vao API tren Mac.

Features:
  - Auto-fallback: thu Cloudflare tunnel truoc, neu loi thi dung LAN IP
  - Startup gap fill: tu dong phat hien va bu data thieu khi khoi dong
  - Live collection: cap nhat gia moi nhat moi N giay

Usage:
  1. Cai dependencies: pip install -r requirements.txt
  2. Chinh .env: MT5 credentials + API_URL + INGESTION_TOKEN
  3. Chay: python mt5_remote_ingest.py
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

import MetaTrader5 as mt5
import pandas as pd
import pytz
import requests
from apscheduler.schedulers.blocking import BlockingScheduler
from dotenv import load_dotenv

# --- Load .env ---
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("mt5-remote")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONFIG — chinh trong .env hoac sua truc tiep o day
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_API_URL_PRIMARY = os.environ.get("API_URL", "").rstrip("/")
_API_URL_FALLBACK = os.environ.get("API_URL_FALLBACK", "").rstrip("/")
INGESTION_TOKEN = os.environ["INGESTION_TOKEN"]

# Resolved at startup — the URL that actually works
API_URL: str = ""

# Broker timezone (Exness summer = GMT+3)
BROKER_TZ = pytz.timezone(os.environ.get("BROKER_TIMEZONE", "Etc/GMT-3"))

# MT5 credentials (doc tu .env)
MT5_LOGIN = os.environ.get("MT5_LOGIN")
MT5_PASSWORD = os.environ.get("MT5_PASSWORD")
MT5_SERVER = os.environ.get("MT5_SERVER")
MT5_TERMINAL_PATH = os.environ.get("MT5_TERMINAL_PATH")

# Fetch settings
LIVE_INTERVAL = int(os.environ.get("LIVE_INTERVAL_SECONDS", "10"))
LIVE_FETCH_BARS = int(os.environ.get("LIVE_FETCH_BARS", "3"))
HISTORICAL_DAYS = int(os.environ.get("HISTORICAL_DAYS", "30"))
FETCH_WORKERS = int(os.environ.get("FETCH_WORKERS", "4"))
RETRY_MAX = int(os.environ.get("RETRY_MAX", "3"))

# Symbols va timeframes
SYMBOLS = [
    {"mt5": "XAUUSDc", "mt5_fallback": "XAUUSD", "backend": "XAUUSD", "market": "metal"},
    {"mt5": "XAGUSDc", "mt5_fallback": "XAGUSD", "backend": "XAGUSD", "market": "metal"},
    {"mt5": "BTCUSDc", "mt5_fallback": "BTCUSD", "backend": "BTCUSD", "market": "crypto"},
]

TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H2", "H3", "H4", "H12", "D1", "W1", "MN1"]

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MT5 timeframe mapping
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TF_MT5_MAP = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H2": mt5.TIMEFRAME_H2,
    "H3": mt5.TIMEFRAME_H3,
    "H4": mt5.TIMEFRAME_H4,
    "H12": mt5.TIMEFRAME_H12,
    "D1": mt5.TIMEFRAME_D1,
    "W1": mt5.TIMEFRAME_W1,
    "MN1": mt5.TIMEFRAME_MN1,
}

TF_BACKEND_MAP = {
    "M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m",
    "H1": "1h", "H2": "2h", "H3": "3h", "H4": "4h",
    "H12": "12h", "D1": "1d", "W1": "1w", "MN1": "1M",
}

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
    "W1": timedelta(weeks=1),
    "MN1": timedelta(days=30),
}

# MT5 API khong thread-safe — serialize bang Lock
_mt5_lock = threading.Lock()
_failed_buffer: deque = deque(maxlen=1000)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# API CONNECTION — auto-fallback
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _test_api_url(url: str) -> bool:
    """Kiem tra 1 URL co ket noi duoc khong."""
    if not url:
        return False
    try:
        resp = requests.get(
            f"{url}/api/sync-status/XAUUSD",
            params={"timeframe": "1h"},
            headers={"Authorization": f"Bearer {INGESTION_TOKEN}"},
            timeout=8,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.warning("  %s -> FAILED: %s", url, e)
        return False


def resolve_api_url() -> str:
    """
    Thu primary URL truoc (Cloudflare tunnel).
    Neu loi thi thu fallback (LAN IP).
    Neu ca 2 loi thi exit.
    """
    logger.info("Testing API connection...")

    candidates = []
    if _API_URL_PRIMARY:
        candidates.append(("primary", _API_URL_PRIMARY))
    if _API_URL_FALLBACK:
        candidates.append(("fallback", _API_URL_FALLBACK))

    if not candidates:
        logger.critical("No API_URL configured in .env")
        raise SystemExit(1)

    for label, url in candidates:
        logger.info("  Trying %s: %s", label, url)
        if _test_api_url(url):
            logger.info("  %s -> OK", url)
            return url

    logger.critical(
        "Cannot connect to API. Tried: %s",
        ", ".join(url for _, url in candidates),
    )
    logger.critical("Check: (1) Backend dang chay tren Mac? (2) Cloudflare tunnel hoac LAN IP?")
    raise SystemExit(1)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MT5 CONNECTION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def mt5_connect() -> bool:
    kwargs: dict[str, Any] = {}
    if MT5_TERMINAL_PATH:
        kwargs["path"] = MT5_TERMINAL_PATH
    if not mt5.initialize(**kwargs):
        logger.critical("MT5 initialize failed: %s", mt5.last_error())
        return False
    if MT5_LOGIN:
        login_kw: dict[str, Any] = {"login": int(MT5_LOGIN)}
        if MT5_PASSWORD:
            login_kw["password"] = MT5_PASSWORD
        if MT5_SERVER:
            login_kw["server"] = MT5_SERVER
        if not mt5.login(**login_kw):
            logger.critical("MT5 login failed: %s", mt5.last_error())
            return False
    logger.info("Connected to MT5. Version: %s", mt5.version())
    return True


def mt5_ensure_session():
    kwargs: dict[str, Any] = {}
    if MT5_TERMINAL_PATH:
        kwargs["path"] = MT5_TERMINAL_PATH
    if not mt5.initialize(**kwargs):
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
    if MT5_LOGIN:
        login_kw: dict[str, Any] = {"login": int(MT5_LOGIN)}
        if MT5_PASSWORD:
            login_kw["password"] = MT5_PASSWORD
        if MT5_SERVER:
            login_kw["server"] = MT5_SERVER
        if not mt5.login(**login_kw):
            raise RuntimeError(f"MT5 login failed: {mt5.last_error()}")


def _ensure_symbol(symbol: str):
    if not mt5.symbol_select(symbol, True):
        logger.warning("Cannot select symbol %s: %s", symbol, mt5.last_error())


def resolve_mt5_symbols():
    """
    Kiem tra symbol nao ton tai tren MT5 terminal.
    Neu mt5 symbol khong ton tai, thu mt5_fallback.
    """
    mt5_ensure_session()
    for sym in SYMBOLS:
        primary = sym["mt5"]
        fallback = sym.get("mt5_fallback")
        info = mt5.symbol_info(primary)
        if info is not None:
            sym["mt5_resolved"] = primary
            logger.info("Symbol %s -> MT5: %s", sym["backend"], primary)
        elif fallback:
            info = mt5.symbol_info(fallback)
            if info is not None:
                sym["mt5_resolved"] = fallback
                logger.info("Symbol %s -> MT5: %s (fallback)", sym["backend"], fallback)
            else:
                sym["mt5_resolved"] = primary
                logger.warning("Symbol %s: neither %s nor %s found on MT5", sym["backend"], primary, fallback)
        else:
            sym["mt5_resolved"] = primary


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DATA FETCHING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def fetch_ohlcv_range(symbol: str, tf: str,
                      date_from: datetime, date_to: datetime) -> pd.DataFrame:
    mt5_ensure_session()
    _ensure_symbol(symbol)
    mt5_tf = TF_MT5_MAP.get(tf)
    if mt5_tf is None:
        return pd.DataFrame()
    rates = mt5.copy_rates_range(symbol, mt5_tf, date_from, date_to)
    if rates is None or len(rates) == 0:
        return pd.DataFrame()
    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s")
    if "tick_volume" in df.columns:
        df = df.rename(columns={"tick_volume": "volume"})
    return (df[["time", "open", "high", "low", "close", "volume"]]
            .sort_values("time").drop_duplicates(subset=["time"]).reset_index(drop=True))


def fetch_ohlcv_latest(symbol: str, tf: str, count: int = 3) -> pd.DataFrame:
    mt5_ensure_session()
    _ensure_symbol(symbol)
    mt5_tf = TF_MT5_MAP.get(tf)
    if mt5_tf is None:
        return pd.DataFrame()
    rates = mt5.copy_rates_from_pos(symbol, mt5_tf, 0, count)
    if rates is None or len(rates) == 0:
        return pd.DataFrame()
    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s")
    if "tick_volume" in df.columns:
        df = df.rename(columns={"tick_volume": "volume"})
    return (df[["time", "open", "high", "low", "close", "volume"]]
            .sort_values("time").drop_duplicates(subset=["time"]).reset_index(drop=True))


def fetch_historical(symbol: str, tf: str, days: int) -> pd.DataFrame:
    """Fetch lich su, tu chia chunk 30 ngay de tranh limit MT5."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    date_from = now - timedelta(days=days)
    chunks = []
    temp_start = date_from

    while temp_start < now:
        temp_end = min(temp_start + timedelta(days=30), now)
        try:
            df = fetch_ohlcv_range(symbol, tf,
                                   pd.Timestamp(temp_start), pd.Timestamp(temp_end))
            if not df.empty:
                mask = (df["time"] >= pd.Timestamp(temp_start)) & (df["time"] < pd.Timestamp(temp_end))
                df = df[mask]
                if not df.empty:
                    chunks.append(df)
        except Exception as e:
            logger.error("Chunk error %s %s [%s -> %s]: %s", symbol, tf, temp_start, temp_end, e)
        temp_start = temp_end

    if not chunks:
        return pd.DataFrame()
    result = pd.concat(chunks, ignore_index=True)
    return result.drop_duplicates(subset=["time"]).sort_values("time").reset_index(drop=True)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DATA TRANSFORM & PUSH
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _to_utc_iso(dt) -> str:
    # MT5 copy_rates returns unix timestamps which are always UTC.
    # pd.to_datetime(unit="s") produces naive UTC datetimes — just format directly.
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def build_batch_item(sym_cfg: dict, tf: str, df: pd.DataFrame) -> dict:
    candles = [
        {
            "time": _to_utc_iso(row.time),
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
        }
        for row in df.itertuples()
    ]
    return {
        "symbol": sym_cfg["backend"],
        "exchange": "MT5",
        "timeframe": TF_BACKEND_MAP.get(tf, tf.lower()),
        "candles": candles,
    }


def _do_request(payload: dict) -> bool:
    try:
        resp = requests.post(
            f"{API_URL}/api/ohlcv/batch",
            json=payload,
            headers={"Authorization": f"Bearer {INGESTION_TOKEN}"},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        total = sum(r.get("inserted", 0) for r in data.get("results", []))
        logger.info("Pushed %s batches, %s candles accepted", len(payload["batches"]), total)
        return True
    except requests.HTTPError as e:
        detail = ""
        if e.response is not None:
            body = e.response.text[:300]
            if body:
                detail = f" | {body}"
        logger.warning("Push failed: %s%s", e, detail)
        return False
    except Exception as e:
        logger.warning("Push failed: %s", e)
        return False


def push_batch(items: list[dict]):
    if not items:
        return
    # Split oversized batches
    normalized = []
    for item in items:
        candles = item.get("candles", [])
        if len(candles) <= 5000:
            normalized.append(item)
        else:
            for i in range(0, len(candles), 5000):
                normalized.append({**item, "candles": candles[i:i+5000]})

    # Chunk into requests of max 25 batches
    for i in range(0, len(normalized), 25):
        payload = {"batches": normalized[i:i+25]}
        for attempt in range(RETRY_MAX):
            if _do_request(payload):
                break
            wait = 2 ** attempt
            logger.warning("Retry %s/%s in %ss...", attempt + 1, RETRY_MAX, wait)
            time.sleep(wait)
        else:
            logger.error("All retries failed, buffering %s items", len(payload["batches"]))
            _failed_buffer.append(payload)


def flush_failed_buffer():
    if not _failed_buffer:
        return
    flushed = 0
    while _failed_buffer:
        payload = _failed_buffer.popleft()
        if _do_request(payload):
            flushed += 1
        else:
            _failed_buffer.appendleft(payload)
            break
    if flushed:
        logger.info("Flushed %s buffered payloads. Remaining: %s", flushed, len(_failed_buffer))


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GAP DETECTION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def get_last_known_time(symbol_backend: str, tf: str) -> datetime | None:
    tf_backend = TF_BACKEND_MAP.get(tf, tf.lower())
    try:
        resp = requests.get(
            f"{API_URL}/api/sync-status/{symbol_backend}",
            params={"timeframe": tf_backend},
            headers={"Authorization": f"Bearer {INGESTION_TOKEN}"},
            timeout=10,
        )
        resp.raise_for_status()
        latest = resp.json().get("latest")
        if latest:
            return datetime.fromisoformat(latest.replace("Z", "+00:00"))
    except Exception as e:
        logger.warning("Cannot get sync-status %s/%s: %s", symbol_backend, tf_backend, e)
    return None


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


def trading_gap_seconds(date_from: datetime, date_to: datetime, sym_cfg: dict) -> float:
    if sym_cfg["market"] == "crypto":
        return max(0.0, (date_to - date_from).total_seconds())

    total = 0.0
    cursor = date_from
    while cursor < date_to:
        if not is_metal_market_closed(cursor):
            total += min(cursor + timedelta(minutes=1), date_to).timestamp() - cursor.timestamp()
        cursor += timedelta(minutes=1)
    return max(total, 0.0)


def is_market_open(sym_cfg: dict) -> bool:
    if sym_cfg["market"] == "crypto":
        return True
    return not is_metal_market_closed(datetime.now(timezone.utc))


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PARALLEL FETCH HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _get_mt5_symbol(sym_cfg: dict) -> str:
    return sym_cfg.get("mt5_resolved", sym_cfg["mt5"])


def _fetch_historical_task(sym_cfg: dict, tf: str,
                           days: int = None,
                           date_from: datetime = None,
                           date_to: datetime = None) -> dict | None:
    try:
        mt5_sym = _get_mt5_symbol(sym_cfg)
        with _mt5_lock:
            if date_from and date_to:
                df = fetch_ohlcv_range(mt5_sym, tf,
                                       pd.Timestamp(date_from), pd.Timestamp(date_to))
            else:
                df = fetch_historical(mt5_sym, tf, days or HISTORICAL_DAYS)
        if df is None or df.empty:
            return None
        return build_batch_item(sym_cfg, tf, df)
    except Exception as e:
        logger.error("Fetch error %s %s: %s", sym_cfg["mt5"], tf, e)
        return None


def _fetch_latest_task(sym_cfg: dict, tf: str, count: int) -> dict | None:
    try:
        mt5_sym = _get_mt5_symbol(sym_cfg)
        with _mt5_lock:
            df = fetch_ohlcv_latest(mt5_sym, tf, count=count)
        if df is None or df.empty:
            return None
        return build_batch_item(sym_cfg, tf, df)
    except Exception as e:
        logger.error("Latest fetch error %s %s: %s", sym_cfg["mt5"], tf, e)
        return None


def _run_parallel(tasks, task_fn) -> list[dict]:
    items = []
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
        futures = {executor.submit(task_fn, *args): args for args in tasks}
        for future in as_completed(futures):
            try:
                item = future.result()
                if item:
                    items.append(item)
            except Exception as e:
                logger.error("Future error: %s", e)
    return items


def _chunk_by_candles(items: list, max_candles: int = 2000) -> list:
    chunks, current, count = [], [], 0
    for item in items:
        n = len(item["candles"])
        if current and count + n > max_candles:
            chunks.append(current)
            current, count = [], 0
        current.append(item)
        count += n
    if current:
        chunks.append(current)
    return chunks


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SCHEDULER JOBS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def job_startup_sync():
    """Chay 1 lan khi startup — kiem tra gap va fetch bu."""
    logger.info("Startup sync: %s symbols x %s TFs", len(SYMBOLS), len(TIMEFRAMES))
    tasks = []

    for sym in SYMBOLS:
        now = datetime.now(timezone.utc)
        if not is_market_open(sym) and sym["market"] != "crypto":
            continue
        for tf in TIMEFRAMES:
            last = get_last_known_time(sym["backend"], tf)

            if last is None:
                # Chua co data — full sync
                tasks.append((sym, tf, HISTORICAL_DAYS, None, None))
            else:
                delta = TF_DELTA.get(tf, timedelta(minutes=1))
                gap_secs = trading_gap_seconds(last, now, sym)
                if gap_secs > delta.total_seconds() * 2:
                    last_naive = last.replace(tzinfo=None)
                    now_naive = now.replace(tzinfo=None)
                    tasks.append((sym, tf, None, last_naive, now_naive))

    if not tasks:
        logger.info("No gaps — DB is up to date")
        return

    logger.info("Fetching %s symbol/TF combinations...", len(tasks))
    items = _run_parallel(tasks, _fetch_historical_task)

    for chunk in _chunk_by_candles(items):
        push_batch(chunk)

    logger.info("Startup sync complete — pushed %s batches", len(items))


def job_live_collection():
    """Chay moi LIVE_INTERVAL giay — fetch vai bar moi nhat."""
    tasks = [
        (sym, tf, LIVE_FETCH_BARS)
        for sym in SYMBOLS
        for tf in TIMEFRAMES
        if is_market_open(sym)
    ]
    if not tasks:
        return
    items = _run_parallel(tasks, _fetch_latest_task)
    if items:
        push_batch(items)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def main():
    global API_URL

    logger.info("=" * 60)
    logger.info("MT5 Remote Ingestion")
    logger.info("Symbols: %s", [s["mt5"] for s in SYMBOLS])
    logger.info("Timeframes: %s", TIMEFRAMES)
    logger.info("Live interval: %ss", LIVE_INTERVAL)
    logger.info("=" * 60)

    # Step 1: Test API connection (auto-fallback)
    API_URL = resolve_api_url()
    logger.info("Using API: %s", API_URL)

    # Step 2: Connect MT5
    if not mt5_connect():
        raise SystemExit(1)

    # Step 3: Resolve symbol names (XAUUSDc vs XAUUSD tren MT5)
    resolve_mt5_symbols()

    # Step 4: Startup gap fill
    job_startup_sync()

    # Step 5: Schedule live collection + retry buffer
    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(job_live_collection, "interval",
                      seconds=LIVE_INTERVAL, id="live",
                      max_instances=1, coalesce=True)
    scheduler.add_job(flush_failed_buffer, "interval",
                      minutes=5, id="flush_buffer",
                      max_instances=1)

    logger.info("Scheduler running: live every %ss, buffer flush every 5m", LIVE_INTERVAL)
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down...")
    finally:
        mt5.shutdown()
        logger.info("MT5 disconnected")


if __name__ == "__main__":
    main()
