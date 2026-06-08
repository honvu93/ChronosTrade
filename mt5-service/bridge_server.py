"""
Minimal local HTTP bridge that exposes MT5 account reads and command writes.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
import threading
from typing import Any, Callable
from urllib.parse import urlparse

from mt5_connector import MT5Connector, MT5ConnectorError

logger = logging.getLogger(__name__)


class TradingBridgeServer(ThreadingHTTPServer):
    def __init__(self, server_address, handler_cls, mt5_lock: threading.Lock):
        super().__init__(server_address, handler_cls)
        self.mt5_lock = mt5_lock


class TradingBridgeRequestHandler(BaseHTTPRequestHandler):
    server: TradingBridgeServer

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/bridge/health":
            self._send_json(404, {
                "ok": False,
                "error": {
                    "code": "NOT_FOUND",
                    "message": f"Unknown endpoint: {parsed.path}",
                },
            })
            return

        self._send_json(200, {
            "ok": True,
            "data": {
                "status": "ok",
            },
        })

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            body = self._read_json()
            payload = self._dispatch(parsed.path, body)
            self._send_json(200, {"ok": True, "data": payload})
        except ValueError as exc:
            self._send_json(400, {
                "ok": False,
                "error": {
                    "code": "INVALID_REQUEST",
                    "message": str(exc),
                },
            })
        except MT5ConnectorError as exc:
            self._send_json(502, {
                "ok": False,
                "error": {
                    "code": "MT5_BRIDGE_FAILED",
                    "message": str(exc),
                },
            })
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Unhandled bridge error")
            self._send_json(500, {
                "ok": False,
                "error": {
                    "code": "BRIDGE_INTERNAL_ERROR",
                    "message": str(exc),
                },
            })

    def log_message(self, format: str, *args):  # noqa: A003
        logger.info("bridge %s", format % args)

    def _dispatch(self, path: str, body: dict[str, Any]):
        connector = self._build_connector(body)
        handlers: dict[str, Callable[[MT5Connector, dict[str, Any]], Any]] = {
            "/bridge/account/summary": lambda current, _: current.get_account_summary(),
            "/bridge/account/readiness": lambda current, _: current.get_execution_readiness(),
            "/bridge/account/positions": lambda current, _: current.get_positions(),
            "/bridge/account/orders": lambda current, _: current.get_orders(),
            "/bridge/account/deals": lambda current, payload: current.get_deals(limit=int(payload.get("limit") or 50)),
            "/bridge/market/quote": lambda current, payload: current.get_quote(symbol=self._required_string(payload, "symbol")),
            "/bridge/command/open-market": self._open_market,
            "/bridge/command/place-pending": self._place_pending,
            "/bridge/command/close-position": self._close_position,
            "/bridge/command/partial-close": self._partial_close,
            "/bridge/command/modify-position": self._modify_position,
            "/bridge/command/cancel-order": self._cancel_order,
        }
        if path not in handlers:
            raise ValueError(f"Unknown bridge endpoint: {path}")

        with self.server.mt5_lock:
            return handlers[path](connector, body)

    def _build_connector(self, body: dict[str, Any]) -> MT5Connector:
        login = body.get("mt5Login")
        password = body.get("mt5Password")
        server = body.get("mt5Server")
        if not login or not password or not server:
            raise ValueError("mt5Login, mt5Password, and mt5Server are required.")
        return MT5Connector(login=login, password=password, server=server)

    def _open_market(self, connector: MT5Connector, body: dict[str, Any]):
        return connector.open_market(
            symbol=self._required_string(body, "symbol"),
            side=self._required_side(body, "side"),
            volume=self._required_float(body, "volume"),
            stop_loss=self._optional_float(body, "stopLoss"),
            take_profit=self._optional_float(body, "takeProfit"),
            comment=self._optional_string(body, "comment"),
        )

    def _place_pending(self, connector: MT5Connector, body: dict[str, Any]):
        return connector.place_pending_order(
            symbol=self._required_string(body, "symbol"),
            volume=self._required_float(body, "volume"),
            price=self._required_float(body, "price"),
            order_type=self._required_string(body, "orderType"),
            stop_loss=self._optional_float(body, "stopLoss"),
            take_profit=self._optional_float(body, "takeProfit"),
            comment=self._optional_string(body, "comment"),
        )

    def _close_position(self, connector: MT5Connector, body: dict[str, Any]):
        return connector.close_position(
            broker_position_id=self._required_string(body, "brokerPositionId"),
            comment=self._optional_string(body, "comment"),
        )

    def _partial_close(self, connector: MT5Connector, body: dict[str, Any]):
        return connector.partial_close(
            broker_position_id=self._required_string(body, "brokerPositionId"),
            volume=self._required_float(body, "volume"),
            comment=self._optional_string(body, "comment"),
        )

    def _modify_position(self, connector: MT5Connector, body: dict[str, Any]):
        stop_loss = self._optional_float(body, "stopLoss")
        take_profit = self._optional_float(body, "takeProfit")
        if stop_loss is None and take_profit is None:
            raise ValueError("At least one of stopLoss or takeProfit is required.")
        return connector.modify_position(
            broker_position_id=self._required_string(body, "brokerPositionId"),
            stop_loss=stop_loss,
            take_profit=take_profit,
        )

    def _cancel_order(self, connector: MT5Connector, body: dict[str, Any]):
        return connector.cancel_order(
            broker_order_id=self._required_string(body, "brokerOrderId"),
        )

    def _read_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return {}
        body = self.rfile.read(int(raw_length))
        if not body:
            return {}
        parsed = json.loads(body.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("JSON request body must be an object.")
        return parsed

    def _send_json(self, status_code: int, payload: dict[str, Any]):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _required_string(self, body: dict[str, Any], key: str) -> str:
        value = body.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{key} is required.")
        return value.strip()

    def _optional_string(self, body: dict[str, Any], key: str) -> str | None:
        value = body.get(key)
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError(f"{key} must be a string when supplied.")
        stripped = value.strip()
        return stripped or None

    def _required_float(self, body: dict[str, Any], key: str) -> float:
        value = self._optional_float(body, key)
        if value is None:
            raise ValueError(f"{key} is required.")
        return value

    def _optional_float(self, body: dict[str, Any], key: str) -> float | None:
        value = body.get(key)
        if value in (None, ""):
            return None
        parsed = float(value)
        return parsed

    def _required_side(self, body: dict[str, Any], key: str) -> str:
        value = self._required_string(body, key).upper()
        if value not in {"LONG", "SHORT"}:
            raise ValueError(f"{key} must be LONG or SHORT.")
        return value


def start_bridge_server(mt5_lock: threading.Lock) -> TradingBridgeServer:
    port = int(os.environ.get("MT5_BRIDGE_PORT", "8765"))
    server = TradingBridgeServer(("127.0.0.1", port), TradingBridgeRequestHandler, mt5_lock)
    thread = threading.Thread(target=server.serve_forever, name="mt5-bridge", daemon=True)
    thread.start()
    logger.info("MT5 bridge listening on http://127.0.0.1:%s/bridge", port)
    return server
