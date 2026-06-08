# 07 - MT5 Bridge Service

Disaster recovery documentation for the MT5 Python bridge service. Contains enough detail to rebuild the service from scratch.

---

## 1. Service Overview

The MT5 service is a Python application that bridges MetaTrader 5 (MT5) with the trading platform backend (TV-GIT). It serves two distinct purposes:

1. **Market Data Collection** (`main.py`) -- connects to MT5 to fetch OHLCV candle data and pushes it to TimescaleDB via the backend's REST API. Runs on port **8765** (read bridge, optional).
2. **Trade Execution** (`trade_exec_main.py`) -- exposes an HTTP bridge for order execution commands. Runs on port **8766** (exec bridge).

Both processes use the same `bridge_server.py` HTTP server code but are meant to run against **separate MT5 terminal installations/profiles** so that OHLCV sync does not interfere with trade execution sessions.

### MT5 Terminal Dependency

The service requires a running MetaTrader 5 terminal on Windows. The `MetaTrader5` Python package communicates with the terminal via a local IPC mechanism. The terminal must be running and logged in for the Python service to function.

### Two-Process Architecture

| Process | Entry Point | Default Port | Purpose |
|---------|------------|-------------|---------|
| Market Data | `main.py` | 8765 (optional, controlled by `MT5_ENABLE_BRIDGE`) | OHLCV sync + optional bridge |
| Trade Execution | `trade_exec_main.py` | 8765 (from `MT5_BRIDGE_PORT` env) | Dedicated execution bridge |

The trade execution process loads `.trade-exec.env` first, then falls back to `.env`. This allows separate MT5 credentials per process.

---

## 2. Bridge Server

File: `bridge_server.py`

A `ThreadingHTTPServer` that serializes all MT5 API calls through a shared `threading.Lock` (MT5 API is not thread-safe).

### HTTP Endpoints

All endpoints are POST except health check. Every request body must include `mt5Login`, `mt5Password`, and `mt5Server` fields for per-request credential injection (the bridge builds a fresh `MT5Connector` per request).

#### GET Endpoints

| Path | Response |
|------|----------|
| `GET /bridge/health` | `{"ok": true, "data": {"status": "ok"}}` |

#### POST Endpoints -- Account Reads

| Path | Parameters | Returns |
|------|-----------|---------|
| `/bridge/account/summary` | (none) | Account balance, equity, margin, free margin, leverage, currency, unrealized PnL, realized PnL (day) |
| `/bridge/account/readiness` | (none) | Execution readiness check: terminal trade_allowed, tradeapi_disabled, account trade_allowed, with blocker details |
| `/bridge/account/positions` | (none) | All open positions with brokerPositionId, symbol, side, volume, openPrice, SL, TP, swap, commission, unrealizedPnl |
| `/bridge/account/orders` | (none) | All pending orders with brokerOrderId, symbol, side, orderType, volumes, price, SL, TP, status |
| `/bridge/account/deals` | `limit` (optional, default 50) | Recent deal history (last 30 days), sorted newest first |
| `/bridge/market/quote` | `symbol` (required) | Current bid, ask, last price, broker timestamp |

#### POST Endpoints -- Trade Commands

| Path | Required Parameters | Optional Parameters |
|------|-------------------|-------------------|
| `/bridge/command/open-market` | `symbol`, `side` (LONG/SHORT), `volume` | `stopLoss`, `takeProfit`, `comment` |
| `/bridge/command/place-pending` | `symbol`, `volume`, `price`, `orderType` | `stopLoss`, `takeProfit`, `comment` |
| `/bridge/command/close-position` | `brokerPositionId` | `comment` |
| `/bridge/command/partial-close` | `brokerPositionId`, `volume` | `comment` |
| `/bridge/command/modify-position` | `brokerPositionId` + at least one of `stopLoss`/`takeProfit` | |
| `/bridge/command/cancel-order` | `brokerOrderId` | |

### Response Format

All responses follow a consistent envelope:

```json
// Success
{"ok": true, "data": { ... }}

// Client error (400)
{"ok": false, "error": {"code": "INVALID_REQUEST", "message": "..."}}

// MT5 bridge failure (502)
{"ok": false, "error": {"code": "MT5_BRIDGE_FAILED", "message": "..."}}

// Internal error (500)
{"ok": false, "error": {"code": "BRIDGE_INTERNAL_ERROR", "message": "..."}}
```

### Supported Pending Order Types

- `BUY_LIMIT`
- `SELL_LIMIT`
- `BUY_STOP`
- `SELL_STOP`

---

## 3. Trade Execution

File: `mt5_connector.py`

### Order Flow

1. **Readiness check** -- before any trade, `get_execution_readiness()` verifies:
   - `terminal_info().trade_allowed` is True
   - `terminal_info().tradeapi_disabled` is False
   - `account_info().trade_allowed` is True
2. **Fill mode negotiation** -- for DEAL actions, the connector builds multiple request attempts with different filling modes, ordered by priority:
   - IOC (if symbol supports `SYMBOL_FILLING_IOC`)
   - FOK (if symbol supports `SYMBOL_FILLING_FOK`)
   - RETURN (if not market execution mode)
   - Fallback: IOC, FOK, RETURN again
3. **Preflight** -- `mt5.order_check()` validates the request. If `INVALID_FILL_MODE` (retcode 10030), the next filling mode is tried.
4. **Execution** -- `mt5.order_send()` dispatches the order. Same retry logic for fill mode failures.

### Trade Actions

| Action | MT5 Action Constant | Used For |
|--------|-------------------|----------|
| Market order | `TRADE_ACTION_DEAL` | `open_market()`, `close_position()`, `partial_close()` |
| Pending order | `TRADE_ACTION_PENDING` | `place_pending_order()` |
| Modify SL/TP | `TRADE_ACTION_SLTP` | `modify_position()` |
| Cancel pending | `TRADE_ACTION_REMOVE` | `cancel_order()` |

### Trade Result Structure

```json
{
  "accepted": true/false,
  "brokerReference": "deal_or_order_id",
  "brokerPositionId": "position_id",
  "brokerOrderId": "order_id",
  "message": "...",
  "payload": {
    "request": { ... },
    "preflight": { ... },
    "orderSend": { ... },
    "readiness": { ... },
    "failure": null
  },
  "failure": null
}
```

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `_COMMENT_MAX_LENGTH` | 31 | MT5 comment field limit |
| `deviation` | 20 (default, from `MT5_BRIDGE_DEVIATION`) | Max slippage in points |
| `magic` | 904120 (default, from `MT5_BRIDGE_MAGIC`) | Magic number for order identification |

### Accepted Return Codes

- `TRADE_RETCODE_DONE` -- order executed
- `TRADE_RETCODE_PLACED` -- pending order placed
- `TRADE_RETCODE_DONE_PARTIAL` -- partially filled
- `TRADE_RETCODE_NO_CHANGES` -- no changes needed (modify)

### Comment Sanitization

Comments are sanitized before sending to MT5:
- Only allows `A-Za-z0-9 _.:/#-`
- Truncated to 31 characters
- Non-ASCII characters stripped
- Default prefix: `TV-GIT`

---

## 4. MT5 Connector

File: `mt5_connector.py`

### Connection Lifecycle

1. `MT5Connector.__init__()` -- reads credentials from constructor args or environment variables
2. `connect()` / `ensure_session()`:
   - Calls `mt5.initialize()` with optional `path` (terminal path) and `portable` mode
   - Calls `mt5.login()` with login, password, server
   - Calls `mt5.account_info()` and validates the logged-in account matches expected credentials (`_assert_expected_account`)
3. `disconnect()` -- calls `mt5.shutdown()`

### Reconnection Logic

Every public method calls `ensure_session()` at the start, which re-initializes and re-logs-in if the session dropped. This provides automatic reconnection on every API call.

### Account Validation

After login, the connector verifies:
- `account_info().login` matches `self.login`
- `account_info().server` matches `self.server`

If mismatched, raises `MT5ConnectorError` with message "unexpected account after login". This prevents trading on the wrong account if the terminal is already logged into a different account.

### OHLCV Data Methods

| Method | Purpose |
|--------|---------|
| `get_ohlcv_range(symbol, timeframe, date_from, date_to)` | Fetch candles in date range via `mt5.copy_rates_range()` |
| `get_ohlcv_latest(symbol, timeframe, count=3)` | Fetch latest N candles via `mt5.copy_rates_from_pos()` |

Both methods return a pandas DataFrame with columns: `time`, `open`, `high`, `low`, `close`, `volume`. The `tick_volume` column from MT5 is renamed to `volume`.

### Timeframe Mapping (`TF_MAP`)

| MT5 Key | MT5 Constant |
|---------|-------------|
| `M1` | `mt5.TIMEFRAME_M1` |
| `M5` | `mt5.TIMEFRAME_M5` |
| `M15` | `mt5.TIMEFRAME_M15` |
| `M30` | `mt5.TIMEFRAME_M30` |
| `H1` | `mt5.TIMEFRAME_H1` |
| `H2` | `mt5.TIMEFRAME_H2` |
| `H3` | `mt5.TIMEFRAME_H3` |
| `H4` | `mt5.TIMEFRAME_H4` |
| `H12` | `mt5.TIMEFRAME_H12` |
| `D1` | `mt5.TIMEFRAME_D1` |
| `W1` | `mt5.TIMEFRAME_W1` |
| `MN1` | `mt5.TIMEFRAME_MN1` |

---

## 5. Symbol Configuration

File: `symbol_config.py`, `config.yaml`

### Configured Symbols

| MT5 Symbol | Backend (TV) Symbol | Market | Aliases | Enabled |
|-----------|-------------------|--------|---------|---------|
| `XAUUSDc` | `XAUUSD` | metal | `XAUUSDc` | true |
| `XAGUSDc` | `XAGUSD` | metal | `XAGUSDc` | true |
| `BTCUSDc` | `BTCUSD` | crypto | `BTCUSDc` | true |

### Symbol Naming Convention

- **MT5 name**: broker-specific suffix (e.g., `XAUUSDc` for Exness cent accounts)
- **TV/backend name**: clean canonical name (e.g., `XAUUSD`)
- **Aliases**: alternative names that resolve to the same symbol config

### Key Functions

| Function | Purpose |
|----------|---------|
| `load_service_config()` | Load and cache `config.yaml` (LRU cached) |
| `get_enabled_symbols(market=None)` | Return list of enabled symbol configs, optionally filtered by market type |
| `get_symbol_config(symbol_or_cfg)` | Lookup symbol config by any name (MT5, TV, alias). Case-insensitive. |
| `canonical_backend_symbol(symbol_or_cfg)` | Resolve any symbol reference to its TV name (e.g., `XAUUSDc` -> `XAUUSD`) |
| `symbol_aliases(symbol_or_cfg)` | Return all aliases for a symbol |
| `is_crypto_symbol(symbol_or_cfg)` | Check if symbol's market is "crypto". Falls back to checking for "BTC" in name. |
| `is_market_open(symbol_or_cfg)` | Crypto: always True. FX/Metals: False on weekends (Saturday/Sunday). |

### Adding New Symbols

Add a new block to `config.yaml` under `symbols:`. No Python code changes needed:

```yaml
- mt5: "EURUSDc"
  tv: "EURUSD"
  market: "forex"
  aliases:
    - "EURUSDc"
  enabled: true
```

---

## 6. Historical Data Pipeline

### Data Flow

```
MT5 Terminal
  -> mt5.copy_rates_range() / mt5.copy_rates_from_pos()
  -> HistoricalFetcher (chunks + filters)
  -> build_batch_item() (timezone conversion + format)
  -> push_batch() (HTTP POST to backend)
  -> Backend POST /api/ohlcv/batch (upsert into TimescaleDB)
```

### HistoricalFetcher

File: `historical_fetcher.py`

| Method | Purpose |
|--------|---------|
| `fetch_days(symbol, timeframe, days)` | Fetch last N days of data |
| `fetch_range(symbol, timeframe, date_from, date_to)` | Fetch specific date range, auto-chunked into 30-day windows |

Key behaviors:
- Chunks long ranges into 30-day segments to avoid MT5 API limits
- Skips weekend-only chunks for non-crypto symbols
- Filters out bars MT5 returns outside the requested range
- Filters weekend bars for non-crypto symbols
- Deduplicates by timestamp
- Returns empty DataFrame on error

### main.py Scheduler

The main process runs three jobs:

1. **Startup sync** (`job_startup_sync`) -- runs once at boot:
   - For each symbol/timeframe, queries TV-GIT `/api/sync-status/:symbol` for the latest candle
   - If no data exists: full sync of `historical_days` (default 30 days)
   - If gap > 2x timeframe: gap fill from last known time to now
   - If gap small: skip
   - Pushes in chunks of 2000 candles max

2. **Live collection** (`job_live_collection`) -- runs every `live_interval_seconds` (default 10s):
   - Fetches latest 3 bars per symbol/timeframe via `get_ohlcv_latest()`
   - Skips non-crypto symbols on weekends
   - Pushes via batch API

3. **Buffer flush** (`flush_failed_buffer`) -- runs every 5 minutes:
   - Retries previously failed push payloads

### Thread Safety

MT5 API is not thread-safe. All MT5 calls are serialized through a `threading.Lock` (`_mt5_lock`). Data fetching uses `ThreadPoolExecutor` with `fetch_workers` (default 4) workers, but each worker acquires the lock before calling MT5.

---

## 7. Data Pusher

File: `pusher.py`

### Batch Item Format

```json
{
  "symbol": "XAUUSD",
  "exchange": "MT5",
  "timeframe": "1h",
  "candles": [
    {
      "time": "2026-01-01T00:00:00.000Z",
      "open": 2650.50,
      "high": 2655.00,
      "low": 2648.00,
      "close": 2653.25,
      "volume": 1234.0
    }
  ]
}
```

### Timezone Conversion

MT5 returns naive datetimes in broker timezone. The pusher converts to UTC:
1. Localize naive datetime to broker timezone (`Etc/GMT-3` for Exness)
2. Convert to UTC
3. Format as ISO-8601 with `.000Z` suffix

### MT5-to-Backend Timeframe Map (`MT5_TF_MAP`)

| MT5 | Backend |
|-----|---------|
| `M1` | `1m` |
| `M5` | `5m` |
| `M15` | `15m` |
| `M30` | `30m` |
| `H1` | `1h` |
| `H2` | `2h` |
| `H3` | `3h` |
| `H4` | `4h` |
| `H12` | `12h` |
| `D1` | `1d` |
| `D3` | `3d` |
| `W1` | `1w` |
| `MN1` | `1M` |

### Push Logic

1. **Normalize**: split oversized batch items into slices of max `tvgit_max_candles_per_batch` (default 5000) candles each
2. **Chunk**: group normalized items into request payloads of max `tvgit_max_batches_per_request` (default 25) batches each
3. **Send**: POST each payload to `{TVGIT_URL}/api/ohlcv/batch` with `Authorization: Bearer {INGESTION_TOKEN}`, timeout 120s
4. **Retry**: exponential backoff (1s, 2s, 4s), up to `retry_max_attempts` (default 3)
5. **Buffer**: failed payloads saved to `_failed_buffer` deque (max `retry_buffer_size` = 1000 entries) for periodic flush

### Conflict Resolution

The backend `/api/ohlcv/batch` endpoint performs upsert (INSERT ON CONFLICT UPDATE). Pushing duplicate candles is safe -- existing data gets updated with the latest values.

---

## 8. Gap Detection & Repair

### Gap Filler (Live Service)

File: `gap_filler.py`

Used during startup sync to decide what to fetch:

1. Query `GET /api/sync-status/:symbol?timeframe=:tf` for the latest candle timestamp
2. If no data: trigger full sync
3. Calculate gap in seconds (crypto: raw difference; metals/FX: exclude weekends via `trading_gap_seconds()`)
4. If gap <= 2x timeframe delta: no action needed
5. If gap > 2x timeframe delta: return range `(last_known_time, now)` for gap fill

Weekend behavior:
- FX/Metals: skip sync entirely on weekends
- Crypto: sync 24/7

### Standalone Gap Backfill

File: `sync_gap_backfill.py`

The most comprehensive gap detection tool. Operates in dry-run mode by default.

```bash
python sync_gap_backfill.py                                    # dry-run all symbols
python sync_gap_backfill.py --apply                            # actually repair
python sync_gap_backfill.py --symbols BTCUSD --timeframes M5   # specific
python sync_gap_backfill.py --from 2026-03-01 --to 2026-03-26 --apply
```

**Gap classification types:**
- `gap` -- missing bars within existing data range (repairable)
- `stale_tail` -- gap extends to end of analysis range (repairable)
- `empty_range` -- no data at all in the window (repairable)
- `micro_gap` -- fewer bars missing than `--min-gap-bars` threshold (skipped)
- `closed_market` -- all missing times fall in market closed hours (skipped)

**Repairable types:** `gap`, `stale_tail`, `empty_range`

**Alert watchlist freshness:** checks these pairs for staleness:
- `XAUUSD/M5`, `XAGUSD/M5`, `BTCUSD/M5`
- Stale threshold: 15 minutes

**Metal market hours:**
- Close: Friday 21:00 UTC
- Open: Sunday 22:00 UTC
- Saturday: fully closed

### repair_all_gaps.py

Universal gap repair for all symbols. Same architecture as `sync_gap_backfill.py` but simpler classification.

**Gap types:** `scheduled_break`, `abnormal_gap`, `stale_tail`
**Repairable:** `abnormal_gap`, `stale_tail`
**Default timeframes:** `D1`, `H4`, `H1`, `M15`, `M5`

```bash
python repair_all_gaps.py                                       # dry-run
python repair_all_gaps.py --symbols XAUUSD --apply              # repair XAU
python repair_all_gaps.py --from 2026-03-01 --apply             # from date
```

### repair_gaps_btc.py

BTC-specific repair. Key difference: BTC trades 24/7 on Exness, so weekend gaps are NOT skipped.

**Gap types:** `scheduled_break_or_rollover` (<=3 bars, skipped), `abnormal_gap`, `stale_tail`
**Default date range:** 2023-01-01 to now
**API symbols probed:** `BTCUSD`, `BTCUSDc` (both checked for existing data)

### repair_gaps_metals.py

Metals-specific repair with peer comparison. Compares XAUUSD and XAGUSD against each other to classify gaps:

**Gap types:**
- `scheduled_break_or_rollover` -- peer also missing, <= 3 bars
- `shared_weekend_or_holiday` -- peer also missing, <= 100 bars
- `shared_extended_gap` -- peer also missing, > 100 bars (repairable)
- `symbol_only_gap` -- only this symbol missing, peer has data (repairable)
- `partial_overlap_gap` -- mixed presence (repairable)

**Default timeframe:** H1 only
**Repairable:** `symbol_only_gap`, `partial_overlap_gap`, `shared_extended_gap`

---

## 9. History Sync

### sync_history_mt5.py (Universal)

One-time bulk sync for all enabled symbols. Default range: 2017-01-01 to today.

```bash
python sync_history_mt5.py                                  # all symbols, all TFs
python sync_history_mt5.py --symbols BTCUSDc XAUUSDc        # specific symbols
python sync_history_mt5.py --timeframes D1 H4 H1            # specific TFs
python sync_history_mt5.py --from 2020-01-01                # custom start
python sync_history_mt5.py --dry-run                        # estimate only
```

**Process order (coarse first):** `MN1`, `W1`, `D3`, `D1`, `H12`, `H4`, `H3`, `H2`, `H1`, `M30`, `M15`, `M5`, `M1`

**Chunk sizes per timeframe (days per MT5 request):**

| Timeframe | Chunk Days | Approx Bars/Chunk |
|-----------|-----------|-------------------|
| M1 | 7 | ~10,000 |
| M5 | 15 | ~4,300 |
| M15 | 30 | ~2,900 |
| M30 | 60 | ~2,900 |
| H1 | 90 | ~2,200 |
| H2 | 180 | ~2,200 |
| H3 | 270 | ~2,200 |
| H4 | 365 | ~2,200 |
| H12 | 1095 | ~2,200 |
| D1 | 365 | ~260 |
| D3 | 1095 | ~260 |
| W1 | 3650 | -- |
| MN1 | 14600 | -- |

**Resume support:** saves cursor to `.sync_history_mt5_state.json` after every chunk. If interrupted, restarts from the last saved cursor. State file is cleared after successful completion of each symbol/TF pair.

**Push limit:** max 2000 candles per HTTP push.

### sync_history_btc.py

BTC-specific variant. Identical architecture to `sync_history_mt5.py` but hardcoded to `BTCUSDc`/`BTCUSD`.

**Key difference:** BTC trades 24/7, so no weekend skips.
**Resume file:** `.sync_history_btc_state.json`

### sync_history_metals.py

Metals-specific variant for XAUUSD/XAGUSD. Filters symbols by `market: "metal"`.

**Key difference:** skips weekend-only chunks (metals close Fri-Sun).
**Resume file:** `.sync_history_metals_state.json`

### Trading Hours Assumptions

| Market | Hours Per Day | Weekend Behavior |
|--------|-------------|-----------------|
| Metals/FX | 23 | Skip (closed Fri 21:00 - Sun 22:00 UTC) |
| Crypto | 24 | Active (24/7) |

---

## 10. Configuration

### config.yaml

File: `mt5-service/config.yaml`

```yaml
broker_timezone: "Etc/GMT-3"          # Exness GMT+3 (summer)
fetch_workers: 4                       # Parallel fetch threads (MT5 calls serialized via lock)
live_interval_seconds: 10              # Live collection poll interval
live_fetch_bars_per_timeframe: 3       # Bars fetched per live poll cycle
historical_days: 30                    # Full sync lookback when no data exists
retry_max_attempts: 3                  # Push retry count
retry_buffer_size: 1000                # Max buffered failed payloads

timeframes:                            # All timeframes to collect
  - M1, M5, M15, M30, H1, H2, H3, H4, H12, D1, W1, MN1

symbols:                               # Symbol definitions (see section 5)
```

Additional undocumented config keys read by pusher:
- `tvgit_max_batches_per_request`: 25 (max batch items per POST)
- `tvgit_max_candles_per_batch`: 5000 (max candles per batch item)

### Environment Variables

File: `mt5-service/.env` (template: `.env.example`)

| Variable | Required | Default | Purpose |
|----------|---------|---------|---------|
| `MT5_LOGIN` | Yes | -- | MT5 account number |
| `MT5_PASSWORD` | Yes | -- | MT5 account password |
| `MT5_SERVER` | Yes | -- | MT5 broker server (e.g., `Exness-MT5Real36`) |
| `MT5_TERMINAL_PATH` | No | System default | Path to `terminal64.exe` |
| `MT5_TERMINAL_PORTABLE` | No | `false` | Run terminal in portable mode |
| `MT5_BRIDGE_PORT` | No | `8765` | HTTP bridge listen port |
| `MT5_ENABLE_BRIDGE` | No | `false` | Enable bridge in market-data process |
| `MT5_BRIDGE_DEVIATION` | No | `20` | Max slippage in points for market orders |
| `MT5_BRIDGE_MAGIC` | No | `904120` | Magic number for order identification |
| `TVGIT_URL` | Yes | -- | Backend API URL (e.g., `http://localhost:3001`) |
| `INGESTION_TOKEN` | Yes | -- | Bearer token for `/api/ohlcv/batch` and `/api/sync-status` |

The trade execution process additionally loads `.trade-exec.env` (same format, allows separate MT5 terminal credentials).

---

## 11. Dependencies

File: `mt5-service/requirements.txt`

| Package | Version | Purpose |
|---------|---------|---------|
| `MetaTrader5` | >=5.0.45 | Python bindings for MT5 terminal IPC. Windows-only. |
| `requests` | >=2.31.0 | HTTP client for pushing data to TV-GIT backend and querying sync status |
| `APScheduler` | >=3.10.4 | Cron-like scheduler for live collection and buffer flush jobs |
| `python-dotenv` | >=1.0.0 | Load `.env` files into `os.environ` |
| `pandas` | >=2.0.0 | DataFrame handling for OHLCV data transformation |
| `pytz` | >=2024.1 | Broker timezone conversion (MT5 broker time -> UTC) |
| `PyYAML` | >=6.0.1 | Parse `config.yaml` |

Install: `pip install -r mt5-service/requirements.txt`

**Note:** `MetaTrader5` only works on Windows. For development on macOS/Linux, tests mock the `mt5` module.

---

## 12. Error Handling

### MT5 Error Codes and Classification

The connector classifies failures into categories:

| Failure Code | Category | Trigger |
|-------------|----------|---------|
| `TERMINAL_AUTOTRADING_DISABLED` | terminal | `trade_allowed=false` on terminal, or retcode 10027 |
| `TERMINAL_API_DISABLED` | terminal | `tradeapi_disabled=true` on terminal |
| `ACCOUNT_TRADE_DISABLED` | account | `trade_allowed=false` on account |
| `INVALID_FILL_MODE` | preflight/broker | Retcode 10030 or "unsupported filling mode" in comment |
| `ORDER_PREFLIGHT_FAILED` | preflight | `order_check()` returned non-zero retcode |
| `BRIDGE_TRANSPORT_FAILURE` | transport | `order_check()` or `order_send()` returned None |
| `BROKER_REJECTED` | broker | Any other rejection from broker |

### Retry Strategies

**Fill mode retry:** When `INVALID_FILL_MODE` is returned, the connector automatically tries the next filling mode candidate (IOC -> FOK -> RETURN). This happens both at preflight and execution stages.

**Push retry (pusher):** Exponential backoff with base 2:
- Attempt 1: immediate
- Attempt 2: wait 1s
- Attempt 3: wait 2s
- Attempt 4: wait 4s (if configured)

Failed payloads are buffered in a `deque(maxlen=1000)` and retried every 5 minutes by `flush_failed_buffer()`. The flush stops at the first failure to avoid hammering an unavailable backend.

### Connection Recovery

- `ensure_session()` is called before every MT5 API operation
- If `mt5.initialize()` or `mt5.login()` fails, `MT5ConnectorError` is raised
- The startup sequence in `main.py` exits with code 1 if initial connection fails
- During runtime, individual fetch errors are logged and skipped (the next poll cycle will retry)

### Bridge Error Responses

| HTTP Status | Error Code | Cause |
|------------|-----------|-------|
| 400 | `INVALID_REQUEST` | Missing required fields, invalid values |
| 404 | `NOT_FOUND` | Unknown endpoint |
| 500 | `BRIDGE_INTERNAL_ERROR` | Unhandled Python exception |
| 502 | `MT5_BRIDGE_FAILED` | `MT5ConnectorError` (MT5 API failure) |

---

## 13. Test Suite

File: `mt5-service/tests/`

Tests use Python's built-in `unittest` module with MT5 API mocking.

| Test File | Coverage |
|-----------|----------|
| `test_mt5_connector.py` | Terminal disablement blocks trades, account trade disablement, fill mode retry, wrong account detection |
| `test_pusher.py` | Symbol canonicalization, oversized batch splitting, normalization, request chunking |
| `test_symbol_config.py` | Canonical symbol resolution, market type detection |
| `test_sync_gap_backfill.py` | Metal market hours filtering, gap classification (stale_tail, empty_range), contiguous block splitting |

### Running Tests

```bash
cd mt5-service
python -m pytest tests/
# or
python -m unittest discover tests/
```

---

## 14. Utility Scripts

### check_history.py

Probes MT5 for the oldest available data per symbol/timeframe. Uses binary search (year-by-year probing) when full-range requests fail.

```bash
python check_history.py
```

Output: table of oldest/newest dates, bar counts, years of history. Also prints recommended `--from` dates for sync scripts.

### check_mt5_limit.py

Quick diagnostic to check `terminal_info().maxbars` and verify data retrieval for XAUUSDc, XAGUSDc, BTCUSDc at M1 and M5 timeframes.

```bash
python check_mt5_limit.py
```

---

## 15. Rebuilding from Scratch Checklist

1. **Windows machine** with MetaTrader 5 installed and logged into the broker account
2. Install Python 3.10+ and `pip install -r requirements.txt`
3. Copy `.env.example` to `.env` and fill in MT5 credentials and TV-GIT connection details
4. Verify connectivity: `python check_history.py`
5. For market data service: `python main.py`
6. For trade execution: create `.trade-exec.env` with separate MT5 terminal path, then `python trade_exec_main.py`
7. For historical backfill: `python sync_history_mt5.py --dry-run` to estimate, then without `--dry-run`
8. For gap repair: `python sync_gap_backfill.py` to detect, then `--apply` to fix

**Critical:** market data and trade execution should use separate MT5 terminal installations to avoid session conflicts.
