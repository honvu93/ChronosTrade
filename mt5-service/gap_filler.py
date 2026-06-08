"""
GapFiller — Kiểm tra TV-GIT API để biết thời điểm data mới nhất,
trả về range cần fetch để lấp đầy gap.

Không còn query SQLite — dùng GET /api/sync-status/:symbol từ TV-GIT.
MT5 markets đóng cửa Thứ 7 & Chủ nhật — bỏ qua weekends hoàn toàn.
"""
import os
import logging
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv

from symbol_config import (
    canonical_backend_symbol,
    is_crypto_symbol as is_config_crypto_symbol,
    is_market_open as is_config_market_open,
)

logger = logging.getLogger(__name__)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

TF_DELTA = {
    "M1":  timedelta(minutes=1),
    "M5":  timedelta(minutes=5),
    "M15": timedelta(minutes=15),
    "M30": timedelta(minutes=30),
    "H1":  timedelta(hours=1),
    "H2":  timedelta(hours=2),
    "H3":  timedelta(hours=3),
    "H4":  timedelta(hours=4),
    "H12": timedelta(hours=12),
    "D1":  timedelta(days=1),
    "D3":  timedelta(days=3),
    "W1":  timedelta(weeks=1),
    "MN1": timedelta(days=30),
}

TV_TF_MAP = {
    "M1": "1m", "M5": "5m", "M15": "15m", "M30": "30m",
    "H1": "1h", "H2": "2h", "H3": "3h", "H4": "4h", "H12": "12h",
    "D1": "1d", "D3": "3d", "W1": "1w", "MN1": "1M",
}


def is_weekend(dt: datetime) -> bool:
    """True nếu datetime (naive UTC) rơi vào Thứ 7 (5) hoặc Chủ nhật (6)."""
    return dt.weekday() >= 5


def is_crypto_symbol(symbol_tv: str) -> bool:
    """True nếu symbol là crypto (BTC, ...) — giao dịch 24/7, không nghỉ cuối tuần."""
    return is_config_crypto_symbol(canonical_backend_symbol(symbol_tv))


def is_market_open(symbol_tv: str = "") -> bool:
    """
    Kiểm tra xem market có đang mở cửa không.
    - FX/Metals: đóng Thứ 7 & Chủ nhật.
    - Crypto (BTC...): mở 24/7, luôn trả True.
    """
    return is_config_market_open(canonical_backend_symbol(symbol_tv))


def trading_gap_seconds(date_from: datetime, date_to: datetime) -> float:
    """
    Tính thời gian market thực sự mở cửa (bỏ qua weekend) trong khoảng [date_from, date_to].
    Cả hai datetime phải là naive UTC.
    """
    def _day_seconds(cursor: datetime) -> float:
        next_day = cursor.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        segment_end = min(next_day, date_to)
        if cursor.weekday() < 5:
            return (segment_end - cursor).total_seconds()
        return 0.0

    days: list[datetime] = []
    cursor = date_from
    while cursor < date_to:
        days.append(cursor)
        cursor = cursor.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)

    return sum(_day_seconds(d) for d in days)


def get_last_known_time(symbol_tv: str, timeframe_mt5: str) -> datetime | None:
    """
    Query TV-GIT /api/sync-status/:symbol để lấy thời điểm candle cuối cùng.
    Trả về datetime UTC hoặc None nếu chưa có data / lỗi kết nối.
    """
    symbol_backend = canonical_backend_symbol(symbol_tv)
    timeframe_tv = TV_TF_MAP.get(timeframe_mt5, timeframe_mt5.lower())
    try:
        url = f"{os.environ['TVGIT_URL']}/api/sync-status/{symbol_backend}"
        headers = {}
        ingestion_token = os.environ.get("INGESTION_TOKEN", "").strip()
        if ingestion_token:
            headers["Authorization"] = f"Bearer {ingestion_token}"
        resp = requests.get(url, params={"timeframe": timeframe_tv}, headers=headers, timeout=10)
        resp.raise_for_status()
        latest = resp.json().get("latest")
        if latest:
            return datetime.fromisoformat(latest.replace("Z", "+00:00"))
    except Exception as e:
        logger.warning(f"Cannot get sync-status {symbol_backend}/{timeframe_tv}: {e}")
    return None


def get_fetch_range(symbol_tv: str, timeframe_mt5: str, historical_days: int):
    """
    Trả về (date_from, date_to, is_full_sync):
    - is_full_sync=True: chưa có data → fetch `historical_days` ngày
    - is_full_sync=False: có data → fetch từ last_known_time đến now (gap fill)
    - (None, None, False): không có gap thực sự cần fill

    Bỏ qua:
    - Gap nhỏ hơn 2× timeframe (service vừa push gần đây)
    - Gap toàn bộ nằm trong weekend (market đóng cửa, không có data)
    - Không chạy nếu hiện tại là weekend
    """
    symbol_backend = canonical_backend_symbol(symbol_tv)
    now = datetime.now(timezone.utc)
    crypto = is_crypto_symbol(symbol_backend)

    # Không sync vào weekend — chỉ áp dụng cho FX/Metals, không áp dụng cho crypto 24/7
    if not crypto and is_weekend(now):
        logger.info(f"[{symbol_backend}/{timeframe_mt5}] Weekend — skipping sync")
        return None, None, False

    last = get_last_known_time(symbol_backend, timeframe_mt5)

    if last is None:
        date_from = now - timedelta(days=historical_days)
        logger.info(f"[{symbol_backend}/{timeframe_mt5}] No data → full sync {historical_days}d")
        return date_from.replace(tzinfo=None), now.replace(tzinfo=None), True

    # Convert to naive UTC cho MT5 API (MT5 nhận naive datetime)
    last_naive = last.replace(tzinfo=None)
    now_naive  = now.replace(tzinfo=None)

    delta = TF_DELTA.get(timeframe_mt5, timedelta(minutes=1))

    # Crypto: tính raw gap (không loại weekends vì BTC giao dịch 24/7)
    # FX/Metals: loại thời gian weekend (market đóng)
    if crypto:
        gap_secs = (now_naive - last_naive).total_seconds()
    else:
        gap_secs = trading_gap_seconds(last_naive, now_naive)

    min_secs = delta.total_seconds() * 2

    if gap_secs <= min_secs:
        logger.debug(f"[{symbol_backend}/{timeframe_mt5}] No tradeable gap (last={last_naive})")
        return None, None, False

    logger.info(f"[{symbol_backend}/{timeframe_mt5}] Gap {gap_secs/3600:.1f}h → fetch from {last_naive}")
    return last_naive, now_naive, False
