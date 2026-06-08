"""
MT5 Service — Entry point.
Startup: smart sync (full hoặc gap fill tùy trạng thái DB).
Recurring: live collection mỗi N giây + flush retry buffer mỗi 5 phút.
"""
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from apscheduler.schedulers.blocking import BlockingScheduler
from dotenv import load_dotenv

_service_dir = os.path.dirname(__file__)
load_dotenv(os.path.join(_service_dir, ".env"))

from bridge_server import start_bridge_server
from mt5_connector import MT5Connector
from historical_fetcher import HistoricalFetcher
from gap_filler import get_fetch_range, is_market_open
from pusher import build_batch_item, push_batch, flush_failed_buffer
from symbol_config import get_enabled_symbols, load_service_config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

# --- Load config ---
cfg = load_service_config()

ENABLED_SYMBOLS   = get_enabled_symbols()
TIMEFRAMES        = cfg["timeframes"]
FETCH_WORKERS     = cfg.get("fetch_workers", 4)
HISTORICAL_DAYS   = cfg.get("historical_days", 30)
LIVE_INTERVAL     = cfg.get("live_interval_seconds", 60)
LIVE_FETCH_BARS   = cfg.get("live_fetch_bars_per_timeframe", 3)
ENABLE_BRIDGE     = os.environ.get("MT5_ENABLE_BRIDGE", "false").strip().lower() in {"1", "true", "yes", "on"}

# MT5 API không thread-safe — serialize bằng Lock
_mt5_lock  = threading.Lock()
_connector = MT5Connector()
_fetcher: HistoricalFetcher | None = None


# --- Fetch helpers ---

def _fetch_task(symbol_cfg: dict, tf: str, days: int | None,
                date_from=None, date_to=None) -> dict | None:
    """
    Fetch một symbol/timeframe từ MT5 (thread-safe qua lock).
    Trả về batch item hoặc None nếu không có data.
    """
    try:
        with _mt5_lock:
            if date_from and date_to:
                df = _fetcher.fetch_range(symbol_cfg["mt5"], tf, date_from, date_to)
            else:
                df = _fetcher.fetch_days(symbol_cfg["mt5"], tf, days or HISTORICAL_DAYS)

        if df is None or df.empty:
            return None
        return build_batch_item(symbol_cfg, tf, df)

    except Exception as e:
        logger.error(f"Fetch error {symbol_cfg['mt5']} {tf}: {e}")
        return None


def _run_parallel(tasks: list) -> list:
    """
    Chạy list of (symbol_cfg, tf, kwargs) song song với ThreadPoolExecutor.
    Trả về list batch items đã build xong (bỏ None).
    """
    items = []
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
        futures = {
            executor.submit(_fetch_task, sym, tf, **kw): (sym["tv"], tf)
            for sym, tf, kw in tasks
        }
        for future in as_completed(futures):
            symbol_tv, tf = futures[future]
            try:
                item = future.result()
                if item:
                    items.append(item)
            except Exception as e:
                logger.error(f"Future error {symbol_tv}/{tf}: {e}")
    return items


def _fetch_latest_task(symbol_cfg: dict, tf: str, count: int) -> dict | None:
    """
    Fetch vài bar mới nhất cho symbol/timeframe để cập nhật realtime.
    Không replay lại cả ngày dữ liệu ở mỗi chu kỳ.
    """
    try:
        with _mt5_lock:
            df = _connector.get_ohlcv_latest(symbol_cfg["mt5"], tf, count=count)

        if df is None or df.empty:
            return None
        return build_batch_item(symbol_cfg, tf, df)
    except Exception as e:
        logger.error(f"Latest fetch error {symbol_cfg['mt5']} {tf}: {e}")
        return None


def _run_parallel_latest(tasks: list[tuple[dict, str, int]]) -> list:
    items = []
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
        futures = {
            executor.submit(_fetch_latest_task, sym, tf, count): (sym["tv"], tf)
            for sym, tf, count in tasks
        }
        for future in as_completed(futures):
            symbol_tv, tf = futures[future]
            try:
                item = future.result()
                if item:
                    items.append(item)
            except Exception as e:
                logger.error(f"Latest future error {symbol_tv}/{tf}: {e}")
    return items


def _chunk_by_candles(items: list, max_candles: int = 5000) -> list:
    """
    Chia list batch items thành các chunks sao cho tổng candles/chunk ≤ max_candles.
    Item nào vượt quá max_candles thì tự thành 1 chunk riêng.
    """
    chunks, current, current_count = [], [], 0
    for item in items:
        n = len(item["candles"])
        if current and current_count + n > max_candles:
            chunks.append(current)
            current, current_count = [], 0
        current.append(item)
        current_count += n
    if current:
        chunks.append(current)
    return chunks


# --- Scheduler jobs ---

def job_startup_sync():
    """
    Chạy 1 lần khi startup.
    Dùng gap_filler để quyết định fetch full hay chỉ lấp gap:
    - Chưa có data → fetch HISTORICAL_DAYS ngày
    - Có data nhưng gap lớn → fetch từ last_known_time đến now
    - Gap nhỏ → bỏ qua
    """
    logger.info(f"Startup sync: {len(ENABLED_SYMBOLS)} symbols × {len(TIMEFRAMES)} TFs")
    tasks = []

    for sym in ENABLED_SYMBOLS:
        for tf in TIMEFRAMES:
            date_from, date_to, is_full = get_fetch_range(sym["tv"], tf, HISTORICAL_DAYS)
            if date_from is None:
                continue  # no gap
            if is_full:
                tasks.append((sym, tf, {"days": HISTORICAL_DAYS}))
            else:
                tasks.append((sym, tf, {"days": None, "date_from": date_from, "date_to": date_to}))

    if not tasks:
        logger.info("No gaps detected — DB is up to date")
        return

    logger.info(f"Fetching {len(tasks)} symbol/TF combinations...")
    items = _run_parallel(tasks)

    # Chunk theo số CANDLES — tối đa 2000/request (timeout 120s là đủ)
    for chunk in _chunk_by_candles(items, max_candles=2000):
        push_batch(chunk)

    logger.info(f"Startup sync complete — pushed {len(items)} batches")


def job_live_collection():
    """
    Chạy mỗi LIVE_INTERVAL giây.
    Chỉ fetch vài bar mới nhất của mỗi symbol/TF để refresh current price/current bar.
    FX/Metals: bỏ qua cuối tuần. Crypto (BTC): chạy 24/7.
    """
    tasks = [
        (sym, tf, LIVE_FETCH_BARS)
        for sym in ENABLED_SYMBOLS
        for tf in TIMEFRAMES
        if is_market_open(sym["tv"])  # crypto luôn True, metals False vào weekend
    ]
    if not tasks:
        logger.debug("Weekend — skipping live collection (no active markets)")
        return
    items = _run_parallel_latest(tasks)
    if items:
        push_batch(items)


# --- Main ---

def main():
    logger.info("Starting MT5 Service...")

    logger.info("Connecting to MT5...")
    if not _connector.connect():
        logger.critical("Cannot connect to MT5 — exiting")
        raise SystemExit(1)

    global _fetcher
    _fetcher = HistoricalFetcher(_connector)
    bridge_server = None
    if ENABLE_BRIDGE:
        bridge_server = start_bridge_server(_mt5_lock)
    else:
        logger.info("MT5 bridge disabled for market-data service; run trade_exec_main.py for execution bridge")

    # Startup sync trước khi scheduler bắt đầu
    job_startup_sync()

    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(job_live_collection, "interval",
                      seconds=LIVE_INTERVAL, id="live",
                      max_instances=1, coalesce=True)
    scheduler.add_job(flush_failed_buffer, "interval",
                      minutes=5, id="flush_buffer",
                      max_instances=1)

    logger.info(f"Scheduler running: live every {LIVE_INTERVAL}s, buffer flush every 5m")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down...")
    finally:
        if bridge_server:
            bridge_server.shutdown()
            bridge_server.server_close()
        _connector.disconnect()


if __name__ == "__main__":
    main()
