"""
Dedicated MT5 execution bridge entry point.

Run this against a separate MT5 terminal/profile from the market-data service so
order execution does not inherit account/session side effects from OHLCV sync.
"""

from __future__ import annotations

import logging
import os
import threading
import time

from dotenv import load_dotenv

from bridge_server import start_bridge_server
from mt5_connector import MT5Connector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

_service_dir = os.path.dirname(__file__)
load_dotenv(os.path.join(_service_dir, ".trade-exec.env"))
load_dotenv(os.path.join(_service_dir, ".env"), override=False)

_mt5_lock = threading.Lock()
_connector = MT5Connector()


def main():
    logger.info("Starting MT5 trade execution bridge...")
    logger.info("Connecting to MT5 execution terminal...")
    if not _connector.connect():
        logger.critical("Cannot connect to MT5 execution terminal - exiting")
        raise SystemExit(1)

    bridge_server = start_bridge_server(_mt5_lock)
    logger.info("Trade execution bridge is ready")

    try:
        while True:
            time.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down MT5 trade execution bridge...")
    finally:
        bridge_server.shutdown()
        bridge_server.server_close()
        _connector.disconnect()


if __name__ == "__main__":
    main()
