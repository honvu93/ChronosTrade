from __future__ import annotations

import os
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

import yaml

_SERVICE_DIR = os.path.dirname(__file__)
_CFG_PATH = os.path.join(_SERVICE_DIR, "config.yaml")


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []

    for value in values:
        normalized = str(value).strip()
        if not normalized:
            continue
        key = normalized.upper()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)

    return result


@lru_cache(maxsize=1)
def load_service_config() -> dict[str, Any]:
    with open(_CFG_PATH) as file:
        return yaml.safe_load(file)


@lru_cache(maxsize=1)
def _build_symbol_lookup() -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}

    for symbol_cfg in load_service_config()["symbols"]:
        names = [
            symbol_cfg["mt5"],
            symbol_cfg["tv"],
            *symbol_cfg.get("aliases", []),
        ]
        for name in _dedupe_preserve_order(names):
            lookup[name.upper()] = symbol_cfg

    return lookup


def get_symbol_config(symbol_or_cfg: str | dict[str, Any]) -> dict[str, Any] | None:
    if isinstance(symbol_or_cfg, dict):
        return symbol_or_cfg

    symbol = str(symbol_or_cfg).strip()
    if not symbol:
        return None

    return _build_symbol_lookup().get(symbol.upper())


def get_enabled_symbols(market: str | None = None) -> list[dict[str, Any]]:
    symbols = [
        dict(symbol_cfg)
        for symbol_cfg in load_service_config()["symbols"]
        if symbol_cfg.get("enabled", True)
    ]

    if market is None:
        return symbols

    normalized_market = market.strip().lower()
    return [
        symbol_cfg
        for symbol_cfg in symbols
        if str(symbol_cfg.get("market", "")).strip().lower() == normalized_market
    ]


def canonical_backend_symbol(symbol_or_cfg: str | dict[str, Any]) -> str:
    symbol_cfg = get_symbol_config(symbol_or_cfg)
    if symbol_cfg is not None:
        return str(symbol_cfg["tv"])
    return str(symbol_or_cfg).strip()


def symbol_aliases(symbol_or_cfg: str | dict[str, Any]) -> list[str]:
    symbol_cfg = get_symbol_config(symbol_or_cfg)
    if symbol_cfg is None:
        return _dedupe_preserve_order([str(symbol_or_cfg)])

    return _dedupe_preserve_order([
        str(symbol_cfg["tv"]),
        *[str(alias) for alias in symbol_cfg.get("aliases", [])],
    ])


def is_crypto_symbol(symbol_or_cfg: str | dict[str, Any]) -> bool:
    symbol_cfg = get_symbol_config(symbol_or_cfg)
    if symbol_cfg is not None:
        return str(symbol_cfg.get("market", "")).strip().lower() == "crypto"

    return "BTC" in str(symbol_or_cfg).upper()


def is_market_open(symbol_or_cfg: str | dict[str, Any] = "") -> bool:
    if is_crypto_symbol(symbol_or_cfg):
        return True
    return datetime.now(timezone.utc).weekday() < 5
