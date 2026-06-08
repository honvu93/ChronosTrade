"""
HistoricalFetcher — Fetch OHLCV từ MT5 theo date range.
Adapted từ trade.your-domain.com — bỏ hoàn toàn SQLite/db_manager/tqdm.
Output: pandas DataFrame, caller tự push lên TV-GIT.
"""
import logging
import pandas as pd
from datetime import datetime, timedelta, timezone

from symbol_config import is_crypto_symbol

logger = logging.getLogger(__name__)


class HistoricalFetcher:
    def __init__(self, connector):
        self.connector = connector

    def fetch_days(self, symbol: str, timeframe: str, days: int) -> pd.DataFrame:
        """
        Fetch `days` ngày gần nhất của symbol/timeframe từ MT5.
        Trả về DataFrame với columns: time, open, high, low, close, volume.
        Trả về DataFrame rỗng nếu lỗi hoặc không có data.
        """
        date_to   = datetime.now(timezone.utc).replace(tzinfo=None)
        date_from = date_to - timedelta(days=days)
        return self.fetch_range(symbol, timeframe, date_from, date_to)

    def fetch_range(self, symbol: str, timeframe: str,
                    date_from: datetime, date_to: datetime) -> pd.DataFrame:
        """
        Fetch data MT5 trong khoảng [date_from, date_to].
        Với timeframe nhỏ (M1) và range dài, tự động chia thành chunks 30 ngày
        để tránh giới hạn của MT5 API.
        """
        logger.info(f"Fetching {symbol} {timeframe}: {date_from.date()} → {date_to.date()}")
        chunks = []
        chunk_days = 30
        temp_start = date_from

        while temp_start < date_to:
            temp_end = min(temp_start + timedelta(days=chunk_days), date_to)

            # Bỏ qua chunk nằm hoàn toàn trong weekend (MT5 không có data) - Chỉ áp dụng cho non-crypto
            is_crypto = is_crypto_symbol(symbol)
            if not is_crypto:
                chunk_days_range = (temp_end - temp_start).days or 1
                weekday_count = sum(
                    1 for i in range(chunk_days_range)
                    if (temp_start + timedelta(days=i)).weekday() < 5
                )
                if weekday_count == 0:
                    logger.debug(f"  skip weekend chunk {temp_start.date()} → {temp_end.date()}")
                    temp_start = temp_end
                    continue

            try:
                df = self.connector.get_ohlcv_range(
                    symbol, timeframe,
                    pd.Timestamp(temp_start),
                    pd.Timestamp(temp_end),
                )
                if not df.empty:
                    # MT5 đôi khi trả bar nằm ngoài range — lọc lại cho chính xác
                    mask = (df["time"] >= pd.Timestamp(temp_start)) & \
                           (df["time"] <  pd.Timestamp(temp_end))
                    df = df[mask]
                    if not df.empty:
                        chunks.append(df)
                        logger.debug(f"  chunk {temp_start.date()} → {temp_end.date()}: {len(df)} bars")
            except Exception as e:
                logger.error(f"Chunk error {symbol} {timeframe} [{temp_start} → {temp_end}]: {e}")

            temp_start = temp_end

        if not chunks:
            logger.warning(f"No data returned for {symbol} {timeframe}")
            return pd.DataFrame()

        result = pd.concat(chunks, ignore_index=True)
        result = result.drop_duplicates(subset=["time"]).sort_values("time").reset_index(drop=True)

        # Lọc bỏ bất kỳ bar nào MT5 trả về rơi vào weekend (edge case) - Chỉ áp dụng cho non-crypto
        is_crypto = is_crypto_symbol(symbol)
        if not is_crypto:
            result = result[result["time"].dt.dayofweek < 5].reset_index(drop=True)

        logger.info(f"Fetched {symbol} {timeframe}: {len(result)} bars total")
        return result
