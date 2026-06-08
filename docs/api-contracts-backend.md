# API Contracts — Backend

_Generated: 2026-04-16 | Deep Scan_

---

## Overview

Backend exposes REST API on `:3001` under `/api/` prefix. Frontend proxies via Next.js rewrites. All authenticated endpoints require JWT Bearer token.

## Response Envelope

All endpoints return:
```json
{ "success": true|false, "data": {}, "error": { "code": "...", "message": "...", "domain": "..." } }
```

---

## Authentication Routes (`registerAuthRoutes.ts`)

| Method | Path | Auth | Rate Limit | Description |
|---|---|---|---|---|
| POST | `/api/auth/login` | None | 10/15min | Login with email+password |
| POST | `/api/auth/refresh` | Cookie | 30/15min | Refresh access token |
| POST | `/api/auth/logout` | JWT | — | Logout, clear refresh token |
| GET | `/api/auth/session` | JWT + hydrate | — | Get current session info |
| GET | `/api/auth/users` | Admin | — | List managed users |
| POST | `/api/auth/users` | Admin | — | Create user |
| PATCH | `/api/auth/users/:id` | Admin | — | Update user |

## Health & Public Routes (`server.ts`)

| Method | Path | Auth | Rate Limit | Description |
|---|---|---|---|---|
| GET | `/health` | None | — | DB + Redis probe |
| GET | `/api/public/trade-history` | None | 30/min | Last 10 trades |
| GET | `/api/public/reports` | None | 30/min | Public backtest reports |

## Market Data Routes (`server.ts`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/symbols` | JWT | List available symbols |
| GET | `/api/ohlcv/:symbol` | JWT | Candle data (max 5000, params: timeframe, limit, startTime, endTime) |
| POST | `/api/ohlcv/batch` | Ingestion token | Batch candle ingestion (max 25 batches × 5000 candles) |
| POST | `/api/ohlcv/:symbol` | Ingestion token | Single symbol candle ingestion (max 5000) |
| GET | `/api/sync-status/:symbol` | JWT or Ingestion | Oldest/latest candle time + total count |
| GET | `/api/market-summary` | JWT | Symbol summaries with sparklines |

## Engine Routes (`registerEngineRoutes.ts`)

Requires: signal + report + engine module access.
- Backtest analytics, trade histories, leaderboards, public metrics

## Signal Routes (`registerSignalRoutes.ts`)

Requires: signal module access.
- Signal definition CRUD (GET, POST, PATCH)
- Backtest execution and management
- Signal optimization and ranking
- Composed signal operations

## Indicator Routes (`registerIndicatorRoutes.ts`)

Requires: signal and/or engine module access.
- Indicator instance lifecycle (create, list, get, update, delete, pause, resume)
- Indicator events and logic traces
- Alert configuration
- Indicator promotion and publishing
- Admin-only: catalog management

## Trading Account Routes (`registerTradingAccountRoutes.ts`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/trading/accounts` | JWT + trading read | List accounts (optional userId filter) |
| POST | `/api/trading/accounts` | JWT + trading write | Create account (LIVE/PAPER) |
| PATCH | `/api/trading/accounts/:id` | JWT + trading write | Update account |
| DELETE | `/api/trading/accounts/:id` | JWT + trading write | Delete account |
| POST | `/api/trading/accounts/:id/select` | JWT + trading read | Set active account |
| POST | `/api/trading/commands/preflight` | JWT + trading write | Check write capability |
| POST | `/api/trading/automation/preflight` | JWT + trading auto | Check automation capability |

## Trading Operations Routes (`registerTradingOperationsRoutes.ts`)

Requires: trading write/auto feature flags.
- Execution commands: OPEN_MARKET, CLOSE_POSITION, PARTIAL_CLOSE, PLACE_PENDING, MODIFY_POSITION, CANCEL_ORDER, FORCE_SYNC
- Automation binding management (OBSERVE, MANUAL_APPROVAL, AUTO_EXECUTE)
- Trade intent lifecycle (QUEUED → PROCESSING → EXECUTED/REJECTED/FAILED)
- Reconciliation operations

## Trading Workspace Routes (`registerTradingWorkspaceRoutes.ts`)

Requires: trading read.
- Signal version snapshots
- Trade history and outcomes
- Account readiness and compatibility
- Trading diagnosis and investigation
- Trading checklists and discrepancy tracking

## Trading Integration Routes (`registerTradingIntegrationRoutes.ts`)

- External action event handling and replay
- Webhook deployment and event sourcing

## Monitoring Routes (`registerMonitoringRoutes.ts`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/monitoring` | Admin | System health snapshot |

## Trading Export Routes (`registerTradingExportRoutes.ts`)

- Trade history exports
- Output contract definitions

## MT5 Bridge Endpoints (bridge_server.py on :8765/:8766)

| Method | Path | Description |
|---|---|---|
| GET | `/bridge/health` | Health check |
| POST | `/bridge/account/summary` | Account info |
| POST | `/bridge/account/readiness` | Execution readiness |
| POST | `/bridge/account/positions` | Open positions |
| POST | `/bridge/account/orders` | Pending orders |
| POST | `/bridge/account/deals` | Trade history |
| POST | `/bridge/market/quote` | Current bid/ask |
| POST | `/bridge/command/open-market` | Market order |
| POST | `/bridge/command/place-pending` | Limit/stop order |
| POST | `/bridge/command/close-position` | Close position |
| POST | `/bridge/command/partial-close` | Partial close |
| POST | `/bridge/command/modify-position` | Modify SL/TP |
| POST | `/bridge/command/cancel-order` | Cancel order |
