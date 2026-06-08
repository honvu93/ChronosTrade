"""
Pusher: transform MT5 data into TV-GIT batch payloads and POST /api/ohlcv/batch.
Handles UTC normalization, retry/backoff, and a local retry buffer.
"""

import logging
import os
import time
from collections import deque
from datetime import timezone

import pytz
import requests
import yaml
from dotenv import load_dotenv
from symbol_config import canonical_backend_symbol

logger = logging.getLogger(__name__)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

with open(os.path.join(os.path.dirname(__file__), "config.yaml")) as f:
    _cfg = yaml.safe_load(f)

TVGIT_URL = os.environ["TVGIT_URL"].rstrip("/")
INGESTION_TOKEN = os.environ["INGESTION_TOKEN"]
BROKER_TZ = pytz.timezone(_cfg["broker_timezone"])
RETRY_MAX = _cfg.get("retry_max_attempts", 3)
BUFFER_SIZE = _cfg.get("retry_buffer_size", 1000)
TVGIT_MAX_BATCHES_PER_REQUEST = _cfg.get("tvgit_max_batches_per_request", 25)
TVGIT_MAX_CANDLES_PER_BATCH = _cfg.get("tvgit_max_candles_per_batch", 5000)

MT5_TF_MAP = {
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

_failed_buffer: deque = deque(maxlen=BUFFER_SIZE)


def _to_utc_iso(dt) -> str:
    """
    Convert broker-local naive datetime to a UTC ISO-8601 string with Z suffix.
    """
    if dt.tzinfo is None:
        dt = BROKER_TZ.localize(dt)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def build_batch_item(symbol_cfg: dict, timeframe_mt5: str, df) -> dict:
    """
    Transform an MT5 dataframe into the TV-GIT batch item format.
    symbol_cfg example: {"mt5": "XAUUSDc", "tv": "XAUUSD"}
    """
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
        "symbol": canonical_backend_symbol(symbol_cfg),
        "exchange": "MT5",
        "timeframe": MT5_TF_MAP.get(timeframe_mt5, timeframe_mt5.lower()),
        "candles": candles,
    }


def _split_oversized_batch_item(
    item: dict,
    max_candles: int = TVGIT_MAX_CANDLES_PER_BATCH,
) -> list[dict]:
    """
    Split one logical batch item into backend-safe slices when it exceeds the
    backend per-batch candle limit.
    """
    candles = item.get("candles") or []
    if len(candles) <= max_candles:
        return [item]

    split_items: list[dict] = []
    for index in range(0, len(candles), max_candles):
        split_item = dict(item)
        split_item["candles"] = candles[index:index + max_candles]
        split_items.append(split_item)
    return split_items


def _normalize_items_for_push(items: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for item in items:
        normalized.extend(_split_oversized_batch_item(item))
    return normalized


def _chunk_items_by_request_limits(
    items: list[dict],
    max_batches: int = TVGIT_MAX_BATCHES_PER_REQUEST,
) -> list[list[dict]]:
    if not items:
        return []
    return [
        items[index:index + max_batches]
        for index in range(0, len(items), max_batches)
    ]


def _do_request(payload: dict) -> bool:
    """Send one POST request. Returns True on success."""
    try:
        response = requests.post(
            f"{TVGIT_URL}/api/ohlcv/batch",
            json=payload,
            headers={"Authorization": f"Bearer {INGESTION_TOKEN}"},
            timeout=120,
        )
        response.raise_for_status()
        data = response.json()
        total = sum(result.get("inserted", 0) for result in data.get("results", []))
        logger.info("Pushed %s batches, %s candles accepted by backend", len(payload["batches"]), total)
        return True
    except requests.HTTPError as error:
        response = error.response
        detail = ""
        if response is not None:
            body = response.text.strip()
            if body:
                if len(body) > 300:
                    body = body[:300] + "..."
                detail = f" | response={body}"
        logger.warning("Push failed: %s%s", error, detail)
        return False
    except Exception as error:
        logger.warning("Push failed: %s", error)
        return False


def push_batch(items: list[dict]) -> None:
    """
    Push batch items with retry and exponential backoff.
    When all retries fail, buffer the failed payload for a later flush.
    """
    if not items:
        return

    normalized_items = _normalize_items_for_push(items)
    payloads = [
        {"batches": chunk}
        for chunk in _chunk_items_by_request_limits(normalized_items)
    ]

    if len(normalized_items) != len(items):
        logger.info(
            "Split %s input batches into %s backend-safe batches",
            len(items),
            len(normalized_items),
        )

    for payload in payloads:
        for attempt in range(RETRY_MAX):
            if _do_request(payload):
                break
            wait = 2 ** attempt
            logger.warning("Retry %s/%s in %ss...", attempt + 1, RETRY_MAX, wait)
            time.sleep(wait)
        else:
            logger.error(
                "All %s retries failed, buffering %s items",
                RETRY_MAX,
                len(payload["batches"]),
            )
            _failed_buffer.append(payload)


def flush_failed_buffer() -> None:
    """
    Periodically retry previously failed payloads.
    Stop immediately if TV-GIT is still unavailable.
    """
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
