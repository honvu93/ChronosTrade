from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
import os
import re
from typing import Any

import MetaTrader5 as mt5
import pandas as pd

logger = logging.getLogger(__name__)

_COMMENT_MAX_LENGTH = 31
_COMMENT_ALLOWED_PATTERN = re.compile(r"[^A-Za-z0-9 _.:/#-]")
_PRECHECK_SUCCESS_RETCODES = {0}
_ACCEPTED_ORDER_SEND_RETCODES = {
    getattr(mt5, "TRADE_RETCODE_DONE", -1),
    getattr(mt5, "TRADE_RETCODE_PLACED", -1),
    getattr(mt5, "TRADE_RETCODE_DONE_PARTIAL", -1),
    getattr(mt5, "TRADE_RETCODE_NO_CHANGES", -1),
}
_TERMINAL_AUTOTRADING_DISABLED_RETCODE = int(getattr(mt5, "TRADE_RETCODE_CLIENT_DISABLES_AT", 10027))

TF_MAP = {
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


class MT5ConnectorError(RuntimeError):
    pass


def _coerce_login(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class MT5Connector:
    def __init__(self, login=None, password=None, server=None):
        self.login = _coerce_login(login if login is not None else os.environ.get("MT5_LOGIN"))
        self.password = password if password is not None else os.environ.get("MT5_PASSWORD")
        self.server = server if server is not None else os.environ.get("MT5_SERVER")
        self.terminal_path = os.environ.get("MT5_TERMINAL_PATH")
        self.terminal_portable = _coerce_bool(os.environ.get("MT5_TERMINAL_PORTABLE"), default=False)
        self.deviation = int(os.environ.get("MT5_BRIDGE_DEVIATION", "20"))
        self.magic = int(os.environ.get("MT5_BRIDGE_MAGIC", "904120"))

    def ensure_session(self) -> bool:
        kwargs: dict[str, Any] = {}
        if self.terminal_path:
            kwargs["path"] = self.terminal_path
        if self.terminal_portable:
            kwargs["portable"] = True
        if not mt5.initialize(**kwargs):
            raise MT5ConnectorError(f"MT5 initialize failed: {mt5.last_error()}")
        if self.login is not None:
            login_kwargs: dict[str, Any] = {"login": self.login}
            if self.password:
                login_kwargs["password"] = self.password
            if self.server:
                login_kwargs["server"] = self.server
            if not mt5.login(**login_kwargs):
                raise MT5ConnectorError(f"MT5 login failed: {mt5.last_error()}")

            account_info = mt5.account_info()
            if account_info is None:
                raise MT5ConnectorError(f"MT5 account_info failed after login: {mt5.last_error()}")
            self._assert_expected_account(self._asdict(account_info))
        return True

    def connect(self) -> bool:
        try:
            self.ensure_session()
            logger.info("Connected to MT5. Version: %s", mt5.version())
            return True
        except MT5ConnectorError as exc:
            logger.error(str(exc))
            return False

    def disconnect(self):
        mt5.shutdown()
        logger.info("Disconnected from MT5")

    def get_ohlcv_range(self, symbol: str, timeframe: str, date_from: pd.Timestamp, date_to: pd.Timestamp) -> pd.DataFrame:
        self.ensure_session()
        self._ensure_symbol(symbol)
        tf = TF_MAP.get(timeframe)
        if tf is None:
            logger.error("Unsupported timeframe: %s", timeframe)
            return pd.DataFrame()
        rates = mt5.copy_rates_range(symbol, tf, date_from, date_to)
        if rates is None or len(rates) == 0:
            logger.warning("No data: %s %s [%s -> %s] - %s", symbol, timeframe, date_from, date_to, mt5.last_error())
            return pd.DataFrame()
        df = pd.DataFrame(rates)
        df["time"] = pd.to_datetime(df["time"], unit="s")
        if "tick_volume" in df.columns:
            df = df.rename(columns={"tick_volume": "volume"})
        return df[["time", "open", "high", "low", "close", "volume"]].sort_values("time").drop_duplicates(subset=["time"]).reset_index(drop=True)

    def get_ohlcv_latest(self, symbol: str, timeframe: str, count: int = 3) -> pd.DataFrame:
        self.ensure_session()
        self._ensure_symbol(symbol)
        tf = TF_MAP.get(timeframe)
        if tf is None:
            return pd.DataFrame()
        rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
        if rates is None or len(rates) == 0:
            return pd.DataFrame()
        df = pd.DataFrame(rates)
        df["time"] = pd.to_datetime(df["time"], unit="s")
        if "tick_volume" in df.columns:
            df = df.rename(columns={"tick_volume": "volume"})
        return df[["time", "open", "high", "low", "close", "volume"]].sort_values("time").drop_duplicates(subset=["time"]).reset_index(drop=True)

    def get_execution_readiness(self) -> dict[str, Any]:
        self.ensure_session()
        terminal_info = mt5.terminal_info()
        if terminal_info is None:
            raise MT5ConnectorError(f"MT5 terminal_info failed: {mt5.last_error()}")
        account_info = mt5.account_info()
        if account_info is None:
            raise MT5ConnectorError(f"MT5 account_info failed: {mt5.last_error()}")

        terminal_raw = self._asdict(terminal_info)
        account_raw = self._asdict(account_info)
        blockers: list[dict[str, Any]] = []
        if terminal_raw.get("trade_allowed") is False:
            blockers.append({
                "code": "TERMINAL_AUTOTRADING_DISABLED",
                "message": "The MT5 terminal reports trade_allowed=false. Enable AutoTrading in the dedicated execution terminal.",
                "field": "trade_allowed",
                "origin": "terminal",
                "value": False,
            })
        if terminal_raw.get("tradeapi_disabled") is True:
            blockers.append({
                "code": "TERMINAL_API_DISABLED",
                "message": "The MT5 terminal reports tradeapi_disabled=true. Allow external Python/API trading in MT5 terminal settings.",
                "field": "tradeapi_disabled",
                "origin": "terminal",
                "value": True,
            })
        if account_raw.get("trade_allowed") is False:
            blockers.append({
                "code": "ACCOUNT_TRADE_DISABLED",
                "message": "The broker account reports trade_allowed=false, so the server will reject trading requests.",
                "field": "trade_allowed",
                "origin": "account",
                "value": False,
            })

        return {
            "ready": len(blockers) == 0,
            "message": blockers[0]["message"] if blockers else "MT5 terminal and account are ready for execution.",
            "failureCode": blockers[0]["code"] if blockers else None,
            "blockers": blockers,
            "terminal": {
                "connected": self._optional_bool(terminal_raw.get("connected")),
                "tradeAllowed": self._optional_bool(terminal_raw.get("trade_allowed")),
                "tradeApiDisabled": self._optional_bool(terminal_raw.get("tradeapi_disabled")),
                "dllsAllowed": self._optional_bool(terminal_raw.get("dlls_allowed")),
                "path": self._string_or_none(terminal_raw.get("path")),
                "dataPath": self._string_or_none(terminal_raw.get("data_path")),
                "rawBrokerJson": terminal_raw,
            },
            "account": {
                "login": self._string_or_none(account_raw.get("login")) or self._string_or_none(self.login),
                "server": self._string_or_none(account_raw.get("server")) or self._string_or_none(self.server),
                "tradeAllowed": self._optional_bool(account_raw.get("trade_allowed")),
                "tradeExpert": self._optional_bool(account_raw.get("trade_expert")),
                "rawBrokerJson": account_raw,
            },
            "evaluatedAt": self._iso(datetime.now(timezone.utc)),
        }

    def get_account_summary(self) -> dict[str, Any]:
        self.ensure_session()
        info = mt5.account_info()
        if info is None:
            raise MT5ConnectorError(f"MT5 account_info failed: {mt5.last_error()}")
        raw = self._asdict(info)
        return {
            "login": str(raw.get("login") or self.login or ""),
            "server": str(raw.get("server") or self.server or ""),
            "balance": self._float(raw.get("balance")),
            "equity": self._float(raw.get("equity")),
            "margin": self._float(raw.get("margin")),
            "freeMargin": self._float(raw.get("margin_free")),
            "marginLevel": self._optional_float(raw.get("margin_level")),
            "unrealizedPnl": self._float(raw.get("profit")),
            "realizedPnlDay": self._calculate_realized_pnl_day(),
            "currency": raw.get("currency"),
            "leverage": int(raw["leverage"]) if raw.get("leverage") is not None else None,
            "brokerTime": self._iso(datetime.now(timezone.utc)),
            "rawBrokerJson": raw,
        }

    def get_positions(self) -> list[dict[str, Any]]:
        self.ensure_session()
        rows = mt5.positions_get() or []
        positions: list[dict[str, Any]] = []
        for row in rows:
            raw = self._asdict(row)
            positions.append({
                "brokerPositionId": str(raw.get("ticket")),
                "brokerOrderId": self._string_or_none(raw.get("identifier")),
                "symbol": raw.get("symbol"),
                "side": "SHORT" if raw.get("type") == mt5.POSITION_TYPE_SELL else "LONG",
                "volume": self._float(raw.get("volume")),
                "openPrice": self._float(raw.get("price_open")),
                "stopLoss": self._optional_float(raw.get("sl")),
                "takeProfit": self._optional_float(raw.get("tp")),
                "currentPrice": self._optional_float(raw.get("price_current")),
                "swap": self._float(raw.get("swap")),
                "commission": self._float(raw.get("commission")),
                "unrealizedPnl": self._float(raw.get("profit")),
                "openedAt": self._timestamp_to_iso(raw.get("time")),
                "rawBrokerJson": raw,
            })
        return positions

    def get_orders(self) -> list[dict[str, Any]]:
        self.ensure_session()
        rows = mt5.orders_get() or []
        orders: list[dict[str, Any]] = []
        for row in rows:
            raw = self._asdict(row)
            orders.append({
                "brokerOrderId": str(raw.get("ticket")),
                "relatedPositionBrokerId": self._string_or_none(raw.get("position_id")),
                "symbol": raw.get("symbol"),
                "side": self._order_side(raw.get("type")),
                "orderType": self._order_type_label(raw.get("type")),
                "requestedVolume": self._float(raw.get("volume_initial")),
                "filledVolume": self._float(raw.get("volume_initial")) - self._float(raw.get("volume_current")),
                "price": self._optional_float(raw.get("price_open")),
                "stopLoss": self._optional_float(raw.get("sl")),
                "takeProfit": self._optional_float(raw.get("tp")),
                "status": self._order_status_label(raw.get("state")),
                "placedAt": self._timestamp_to_iso(raw.get("time_setup")),
                "expiresAt": self._timestamp_to_iso(raw.get("time_expiration")),
                "rawBrokerJson": raw,
            })
        return orders

    def get_deals(self, limit: int = 50, days: int = 30) -> list[dict[str, Any]]:
        self.ensure_session()
        date_to = datetime.now(timezone.utc).replace(tzinfo=None)
        date_from = date_to - timedelta(days=days)
        rows = mt5.history_deals_get(date_from, date_to) or []
        deals: list[dict[str, Any]] = []
        for row in rows:
            raw = self._asdict(row)
            deals.append({
                "brokerDealId": str(raw.get("ticket")),
                "brokerOrderId": self._string_or_none(raw.get("order")),
                "brokerPositionId": self._string_or_none(raw.get("position_id")),
                "symbol": raw.get("symbol"),
                "side": "SHORT" if raw.get("type") == mt5.DEAL_TYPE_SELL else "LONG",
                "volume": self._float(raw.get("volume")),
                "price": self._float(raw.get("price")),
                "commission": self._float(raw.get("commission")),
                "swap": self._float(raw.get("swap")),
                "fee": self._float(raw.get("fee")),
                "realizedPnl": self._float(raw.get("profit")) + self._float(raw.get("commission")) + self._float(raw.get("swap")) + self._float(raw.get("fee")),
                "executedAt": self._timestamp_to_iso(raw.get("time")),
                "comment": raw.get("comment"),
                "rawBrokerJson": raw,
            })
        deals.sort(key=lambda item: item["executedAt"], reverse=True)
        return deals[:limit]

    def get_quote(self, symbol: str) -> dict[str, Any]:
        self._ensure_symbol(symbol)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise MT5ConnectorError(f"Unable to load tick for {symbol}: {mt5.last_error()}")
        raw = self._asdict(tick)
        broker_time = raw.get("time_msc")
        broker_time_iso = self._iso(datetime.fromtimestamp(float(broker_time) / 1000, tz=timezone.utc)) if broker_time not in (None, 0) else self._timestamp_to_iso(raw.get("time"))
        return {
            "symbol": symbol,
            "bid": self._optional_float(raw.get("bid")),
            "ask": self._optional_float(raw.get("ask")),
            "last": self._optional_float(raw.get("last")),
            "brokerTime": broker_time_iso,
            "rawBrokerJson": raw,
        }

    def open_market(self, symbol: str, side: str, volume: float, stop_loss=None, take_profit=None, comment=None) -> dict[str, Any]:
        symbol_info = self._get_symbol_info(symbol)
        order_type = mt5.ORDER_TYPE_BUY if side == "LONG" else mt5.ORDER_TYPE_SELL
        request = self._build_deal_request(symbol_info, symbol, float(volume), order_type, comment or "TV-GIT OPEN_MARKET")
        self._apply_protection(request, stop_loss, take_profit)
        return self._execute_trade_request(request, "Market order submitted.")

    def place_pending_order(self, symbol: str, volume: float, price: float, order_type: str, stop_loss=None, take_profit=None, comment=None) -> dict[str, Any]:
        self._get_symbol_info(symbol)
        request = {
            "action": mt5.TRADE_ACTION_PENDING,
            "symbol": symbol,
            "volume": float(volume),
            "type": self._pending_order_type(order_type),
            "price": float(price),
            "magic": self.magic,
            "comment": self._sanitize_comment(comment or "TV-GIT PLACE_PENDING"),
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": getattr(mt5, "ORDER_FILLING_RETURN", 0),
        }
        self._apply_protection(request, stop_loss, take_profit)
        return self._execute_trade_request(request, "Pending order submitted.")

    def close_position(self, broker_position_id: str, volume: float | None = None, comment=None) -> dict[str, Any]:
        position = self._find_position(broker_position_id)
        symbol = position["symbol"]
        symbol_info = self._get_symbol_info(symbol)
        target_volume = float(volume if volume is not None else position["volume"])
        order_type = mt5.ORDER_TYPE_BUY if position["type"] == mt5.POSITION_TYPE_SELL else mt5.ORDER_TYPE_SELL
        request = self._build_deal_request(
            symbol_info,
            symbol,
            target_volume,
            order_type,
            comment or f"TV-GIT CLOSE_POSITION {broker_position_id}",
            position=int(broker_position_id),
        )
        return self._execute_trade_request(request, "Position close submitted.")

    def partial_close(self, broker_position_id: str, volume: float, comment=None) -> dict[str, Any]:
        return self.close_position(broker_position_id, volume=volume, comment=comment or f"TV-GIT PARTIAL_CLOSE {broker_position_id}")

    def modify_position(self, broker_position_id: str, stop_loss=None, take_profit=None) -> dict[str, Any]:
        position = self._find_position(broker_position_id)
        request = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": int(broker_position_id),
            "symbol": position["symbol"],
            "magic": self.magic,
            "comment": self._sanitize_comment(f"TV-GIT MODIFY_POSITION {broker_position_id}"),
            "sl": float(stop_loss) if stop_loss is not None else float(position.get("sl") or 0.0),
            "tp": float(take_profit) if take_profit is not None else float(position.get("tp") or 0.0),
        }
        return self._execute_trade_request(request, "Position protection updated.")

    def cancel_order(self, broker_order_id: str) -> dict[str, Any]:
        request = {
            "action": mt5.TRADE_ACTION_REMOVE,
            "order": int(broker_order_id),
            "magic": self.magic,
            "comment": self._sanitize_comment(f"TV-GIT CANCEL_ORDER {broker_order_id}"),
        }
        return self._execute_trade_request(request, "Pending order cancel requested.")

    def _execute_trade_request(self, request: dict[str, Any], success_message: str) -> dict[str, Any]:
        self.ensure_session()
        readiness = self.get_execution_readiness()
        if not readiness["ready"]:
            failure = self._failure_from_readiness(readiness)
            return self._shape_trade_result(False, failure["message"], self._trade_payload(request, readiness, failure=failure), failure=failure)

        attempts = self._request_attempts(request)
        if not attempts:
            attempts = [dict(request)]

        last_failure = None
        last_payload = None
        for attempt in attempts:
            order_check_result = mt5.order_check(attempt)
            if order_check_result is None:
                failure = self._classify_failure("transport", None, readiness, mt5.last_error())
                return self._shape_trade_result(False, failure["message"], self._trade_payload(attempt, readiness, failure=failure), failure=failure)

            order_check_raw = self._asdict(order_check_result)
            if not self._is_preflight_success(order_check_raw):
                failure = self._classify_failure("preflight", order_check_raw, readiness, mt5.last_error())
                payload = self._trade_payload(attempt, readiness, preflight=order_check_raw, failure=failure)
                if failure["code"] == "INVALID_FILL_MODE":
                    last_failure, last_payload = failure, payload
                    continue
                return self._shape_trade_result(False, failure["message"], payload, failure=failure)

            order_send_result = mt5.order_send(attempt)
            if order_send_result is None:
                failure = self._classify_failure("transport", None, readiness, mt5.last_error())
                return self._shape_trade_result(False, failure["message"], self._trade_payload(attempt, readiness, preflight=order_check_raw, failure=failure), failure=failure)

            order_send_raw = self._asdict(order_send_result)
            if order_send_raw.get("retcode") in _ACCEPTED_ORDER_SEND_RETCODES:
                return self._shape_trade_result(
                    True,
                    success_message,
                    self._trade_payload(attempt, readiness, preflight=order_check_raw, order_send=order_send_raw),
                    raw_result=order_send_raw,
                )

            failure = self._classify_failure("broker", order_send_raw, readiness, mt5.last_error())
            payload = self._trade_payload(attempt, readiness, preflight=order_check_raw, order_send=order_send_raw, failure=failure)
            if failure["code"] == "INVALID_FILL_MODE":
                last_failure, last_payload = failure, payload
                continue
            return self._shape_trade_result(False, failure["message"], payload, raw_result=order_send_raw, failure=failure)

        if last_failure is not None and last_payload is not None:
            return self._shape_trade_result(False, last_failure["message"], last_payload, failure=last_failure)

        raise MT5ConnectorError(f"MT5 trade execution failed unexpectedly: {mt5.last_error()}")

    def _build_deal_request(self, symbol_info: dict[str, Any], symbol: str, volume: float, order_type: int, comment: str, position: int | None = None) -> dict[str, Any]:
        request: dict[str, Any] = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "deviation": self.deviation,
            "magic": self.magic,
            "comment": self._sanitize_comment(comment),
        }
        if position is not None:
            request["position"] = position
        if self._requires_deal_price(symbol_info):
            request["price"] = self._market_price(symbol, order_type)
        fillings = self._deal_filling_candidates(symbol_info)
        if fillings:
            request["type_filling"] = fillings[0]
        return request

    def _trade_payload(self, request: dict[str, Any], readiness: dict[str, Any], preflight: dict[str, Any] | None = None, order_send: dict[str, Any] | None = None, failure: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"request": request, "preflight": preflight, "orderSend": order_send, "readiness": readiness, "failure": failure}

    def _shape_trade_result(self, accepted: bool, message: str, payload: dict[str, Any], raw_result: dict[str, Any] | None = None, failure: dict[str, Any] | None = None) -> dict[str, Any]:
        source = raw_result or {}
        return {
            "accepted": accepted,
            "brokerReference": self._string_or_none(source.get("deal")) or self._string_or_none(source.get("order")),
            "brokerPositionId": self._string_or_none(source.get("position")),
            "brokerOrderId": self._string_or_none(source.get("order")),
            "message": message,
            "payload": payload,
            "failure": failure,
        }

    def _request_attempts(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        if request.get("action") != getattr(mt5, "TRADE_ACTION_DEAL", None):
            return [dict(request)]
        symbol = self._string_or_none(request.get("symbol"))
        if not symbol:
            return [dict(request)]
        fillings = self._deal_filling_candidates(self._get_symbol_info(symbol))
        if not fillings:
            return [dict(request)]
        attempts: list[dict[str, Any]] = []
        for filling in fillings:
            attempt = dict(request)
            attempt["type_filling"] = filling
            attempts.append(attempt)
        return attempts

    def _deal_filling_candidates(self, symbol_info: dict[str, Any]) -> list[int]:
        filling_mode = symbol_info.get("filling_mode")
        execution_mode = symbol_info.get("trade_exemode")
        market_execution = execution_mode == getattr(mt5, "SYMBOL_TRADE_EXECUTION_MARKET", object())
        candidates: list[int | None] = []
        if self._supports_filling_flag(filling_mode, getattr(mt5, "SYMBOL_FILLING_IOC", None)):
            candidates.append(getattr(mt5, "ORDER_FILLING_IOC", None))
        if self._supports_filling_flag(filling_mode, getattr(mt5, "SYMBOL_FILLING_FOK", None)):
            candidates.append(getattr(mt5, "ORDER_FILLING_FOK", None))
        if not market_execution:
            candidates.append(getattr(mt5, "ORDER_FILLING_RETURN", None))
        candidates.extend([getattr(mt5, "ORDER_FILLING_IOC", None), getattr(mt5, "ORDER_FILLING_FOK", None)])
        if not market_execution:
            candidates.append(getattr(mt5, "ORDER_FILLING_RETURN", None))
        ordered: list[int] = []
        for candidate in candidates:
            if candidate is None or candidate in ordered:
                continue
            ordered.append(candidate)
        return ordered

    def _supports_filling_flag(self, filling_mode: Any, symbol_flag: Any) -> bool:
        return isinstance(filling_mode, int) and symbol_flag is not None and bool(filling_mode & symbol_flag)

    def _requires_deal_price(self, symbol_info: dict[str, Any]) -> bool:
        return symbol_info.get("trade_exemode") != getattr(mt5, "SYMBOL_TRADE_EXECUTION_MARKET", object())

    def _market_price(self, symbol: str, order_type: int) -> float:
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise MT5ConnectorError(f"Unable to load tick for {symbol}: {mt5.last_error()}")
        raw = self._asdict(tick)
        return float(raw.get("ask")) if order_type == getattr(mt5, "ORDER_TYPE_BUY", None) else float(raw.get("bid"))

    def _apply_protection(self, request: dict[str, Any], stop_loss: Any, take_profit: Any):
        if stop_loss is not None:
            request["sl"] = float(stop_loss)
        if take_profit is not None:
            request["tp"] = float(take_profit)

    def _classify_failure(self, stage: str, response_raw: dict[str, Any] | None, readiness: dict[str, Any], last_error: Any) -> dict[str, Any]:
        retcode = response_raw.get("retcode") if response_raw else None
        comment = str(response_raw.get("comment") or "").strip() if response_raw else ""
        normalized = comment.lower()
        last_error_message = str(last_error) if last_error is not None else None
        code, category = "BROKER_REJECTED", "broker"
        if retcode == 10027 or "auto trading disabled" in normalized:
            code, category = "TERMINAL_AUTOTRADING_DISABLED", "terminal"
        elif "tradeapi_disabled" in normalized:
            code, category = "TERMINAL_API_DISABLED", "terminal"
        elif retcode == 10030 or "unsupported filling mode" in normalized or "invalid filling" in normalized:
            code, category = "INVALID_FILL_MODE", ("preflight" if stage == "preflight" else "broker")
        elif "trade disabled" in normalized:
            code = "ACCOUNT_TRADE_DISABLED"
        elif stage == "preflight":
            code, category = "ORDER_PREFLIGHT_FAILED", "preflight"
        elif stage == "transport":
            code, category = "BRIDGE_TRANSPORT_FAILURE", "transport"
        return {
            "code": code,
            "category": category,
            "retcode": int(retcode) if retcode is not None else None,
            "comment": comment or None,
            "message": self._failure_message(code, retcode, comment or None, readiness, last_error_message),
        }

    def _failure_from_readiness(self, readiness: dict[str, Any]) -> dict[str, Any]:
        failure_code = readiness.get("failureCode") or "ORDER_PREFLIGHT_FAILED"
        category = "account" if failure_code == "ACCOUNT_TRADE_DISABLED" else "terminal"
        return {
            "code": failure_code,
            "category": category,
            "retcode": self._readiness_retcode(failure_code),
            "comment": None,
            "message": readiness.get("message") or "MT5 execution readiness failed before order_send().",
        }

    def _readiness_retcode(self, failure_code: str) -> int | None:
        if failure_code == "TERMINAL_AUTOTRADING_DISABLED":
            return _TERMINAL_AUTOTRADING_DISABLED_RETCODE
        return None

    def _failure_message(self, code: str, retcode: int | None, comment: str | None, readiness: dict[str, Any], last_error_message: str | None) -> str:
        suffix = f" (retcode {retcode})" if retcode is not None else ""
        if code == "TERMINAL_AUTOTRADING_DISABLED":
            return f"{comment or readiness.get('message') or 'The MT5 terminal has AutoTrading disabled for external requests.'}{suffix}"
        if code == "TERMINAL_API_DISABLED":
            return f"{comment or readiness.get('message') or 'The MT5 terminal is blocking external API trading.'}{suffix}"
        if code == "INVALID_FILL_MODE":
            return f"{comment or 'Unsupported filling mode for this symbol and execution mode.'}{suffix}"
        if code == "ACCOUNT_TRADE_DISABLED":
            return f"{comment or 'The broker account is currently not allowed to trade.'}{suffix}"
        if code == "ORDER_PREFLIGHT_FAILED":
            return f"{comment or 'MT5 order_check() rejected the trade request before order_send().'}{suffix}"
        if code == "BRIDGE_TRANSPORT_FAILURE":
            return last_error_message or "MT5 bridge transport failed during order preflight or dispatch."
        return f"{comment or 'Broker rejected request.'}{suffix}"

    def _is_preflight_success(self, order_check_raw: dict[str, Any]) -> bool:
        retcode = order_check_raw.get("retcode")
        return retcode in _PRECHECK_SUCCESS_RETCODES or str(order_check_raw.get("comment") or "").strip().lower() == "done"

    def _calculate_realized_pnl_day(self) -> float:
        start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).replace(tzinfo=None)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        deals = mt5.history_deals_get(start_of_day, now) or []
        total = 0.0
        for deal in deals:
            raw = self._asdict(deal)
            total += self._float(raw.get("profit")) + self._float(raw.get("commission")) + self._float(raw.get("swap")) + self._float(raw.get("fee"))
        return total

    def _ensure_symbol(self, symbol: str):
        self.ensure_session()
        if not mt5.symbol_select(symbol, True):
            raise MT5ConnectorError(f"Unable to select symbol {symbol}: {mt5.last_error()}")

    def _assert_expected_account(self, account_raw: dict[str, Any]):
        expected_login = self._string_or_none(self.login)
        expected_server = self._string_or_none(self.server)
        actual_login = self._string_or_none(account_raw.get("login"))
        actual_server = self._string_or_none(account_raw.get("server"))

        if expected_login and actual_login and actual_login != expected_login:
            raise MT5ConnectorError(
                "MT5 session is attached to an unexpected account after login: "
                f"expected login {expected_login}, got {actual_login}."
            )
        if expected_server and actual_server and actual_server != expected_server:
            raise MT5ConnectorError(
                "MT5 session is attached to an unexpected server after login: "
                f"expected server {expected_server}, got {actual_server}."
            )

    def _get_symbol_info(self, symbol: str) -> dict[str, Any]:
        self._ensure_symbol(symbol)
        info = mt5.symbol_info(symbol)
        if info is None:
            raise MT5ConnectorError(f"Unable to load symbol_info for {symbol}: {mt5.last_error()}")
        return self._asdict(info)

    def _find_position(self, broker_position_id: str) -> dict[str, Any]:
        self.ensure_session()
        rows = mt5.positions_get(ticket=int(broker_position_id)) or []
        if not rows:
            raise MT5ConnectorError(f"Position {broker_position_id} not found.")
        return self._asdict(rows[0])

    def _pending_order_type(self, order_type: str):
        mapping = {
            "BUY_LIMIT": mt5.ORDER_TYPE_BUY_LIMIT,
            "SELL_LIMIT": mt5.ORDER_TYPE_SELL_LIMIT,
            "BUY_STOP": mt5.ORDER_TYPE_BUY_STOP,
            "SELL_STOP": mt5.ORDER_TYPE_SELL_STOP,
        }
        if order_type not in mapping:
            raise MT5ConnectorError(f"Unsupported pending order type: {order_type}")
        return mapping[order_type]

    def _sanitize_comment(self, comment: str | None) -> str:
        base = (comment or "").strip() or "TV-GIT"
        ascii_only = base.encode("ascii", "ignore").decode("ascii")
        normalized = _COMMENT_ALLOWED_PATTERN.sub("_", ascii_only)
        collapsed = re.sub(r"\s+", " ", normalized).strip(" ._-")
        return (collapsed or "TV-GIT")[:_COMMENT_MAX_LENGTH]

    def _order_side(self, raw_type: Any) -> str:
        sell_types = {
            getattr(mt5, "ORDER_TYPE_SELL", -1),
            getattr(mt5, "ORDER_TYPE_SELL_LIMIT", -1),
            getattr(mt5, "ORDER_TYPE_SELL_STOP", -1),
            getattr(mt5, "ORDER_TYPE_SELL_STOP_LIMIT", -1),
        }
        return "SHORT" if raw_type in sell_types else "LONG"

    def _order_type_label(self, raw_type: Any) -> str:
        mapping = {
            getattr(mt5, "ORDER_TYPE_BUY", -1): "MARKET",
            getattr(mt5, "ORDER_TYPE_SELL", -1): "MARKET",
            getattr(mt5, "ORDER_TYPE_BUY_LIMIT", -1): "BUY_LIMIT",
            getattr(mt5, "ORDER_TYPE_SELL_LIMIT", -1): "SELL_LIMIT",
            getattr(mt5, "ORDER_TYPE_BUY_STOP", -1): "BUY_STOP",
            getattr(mt5, "ORDER_TYPE_SELL_STOP", -1): "SELL_STOP",
        }
        return mapping.get(raw_type, "MARKET")

    def _order_status_label(self, raw_state: Any) -> str:
        mapping = {
            getattr(mt5, "ORDER_STATE_STARTED", -1): "PENDING",
            getattr(mt5, "ORDER_STATE_PLACED", -1): "PLACED",
            getattr(mt5, "ORDER_STATE_PARTIAL", -1): "PARTIALLY_FILLED",
            getattr(mt5, "ORDER_STATE_FILLED", -1): "FILLED",
            getattr(mt5, "ORDER_STATE_CANCELED", -1): "CANCELED",
            getattr(mt5, "ORDER_STATE_REJECTED", -1): "REJECTED",
            getattr(mt5, "ORDER_STATE_EXPIRED", -1): "EXPIRED",
        }
        return mapping.get(raw_state, "PENDING")

    def _asdict(self, value: Any) -> dict[str, Any]:
        return value._asdict() if hasattr(value, "_asdict") else dict(value)

    def _iso(self, value: datetime | None) -> str | None:
        if value is None:
            return None
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    def _timestamp_to_iso(self, value: Any) -> str | None:
        if value in (None, 0):
            return None
        return self._iso(datetime.fromtimestamp(int(value), tz=timezone.utc))

    def _float(self, value: Any) -> float:
        return 0.0 if value is None else float(value)

    def _optional_float(self, value: Any) -> float | None:
        return None if value in (None, 0, 0.0) else float(value)

    def _optional_bool(self, value: Any) -> bool | None:
        return None if value is None else bool(value)

    def _string_or_none(self, value: Any) -> str | None:
        return None if value in (None, "", 0) else str(value)
