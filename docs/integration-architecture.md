# Integration Architecture

_Generated: 2026-04-16 | Deep Scan_

---

## Part Communication Overview

```
┌────────────────┐     REST API      ┌────────────────┐
│   Frontend      │ ◄──────────────► │   Backend       │
│   (Next.js)     │   via /api proxy  │   (Express.js)  │
│   :5001         │                   │   :3001         │
│                 │ ◄──── Socket.IO   │                 │
│                 │   via /socket.io  │                 │
└────────────────┘   proxy            └───────┬────────┘
                                              │
                                    ┌─────────┼─────────┐
                                    │         │         │
                               ┌────▼──┐ ┌───▼───┐ ┌──▼───┐
                               │ Redis │ │TimescaleDB│ │Ext DB│
                               │ :6379 │ │  :5433  │ │:5434 │
                               └───┬───┘ └────────┘ └──────┘
                                   │
                          ┌────────┼────────┐
                          │                 │
                    ┌─────▼─────┐    ┌─────▼─────┐
                    │ BullMQ     │    │ Socket.IO  │
                    │ Workers    │    │ Adapter    │
                    │ (4 types)  │    │            │
                    └────────────┘    └────────────┘
                                              │
                               ┌──────────────┘
                               │
                        ┌──────▼──────┐
                        │ MT5 Bridge   │
                        │ (Python)     │
                        │ :8765 read   │
                        │ :8766 exec   │
                        └──────────────┘
```

## Integration Points

### 1. Frontend ↔ Backend (REST API)

| From | To | Type | Details |
|---|---|---|---|
| Frontend | Backend | REST API | `/api/:path*` rewritten via next.config.ts to `:3001` |
| Frontend | Backend | Socket.IO | `/socket.io/:path*` rewritten to `:3001` |
| Frontend | Backend | Auth | JWT Bearer token in Authorization header |
| Frontend | Backend | Cookies | Refresh token in HttpOnly cookie |

### 2. Frontend ↔ Backend (Real-time)

| From | To | Type | Details |
|---|---|---|---|
| Backend | Frontend | Socket.IO | Events: live ticks, candle confirmations, indicator events |
| Backend | Redis | Pub/Sub | Channels: `live:*:*`, `indicator:events`, `backtest:progress:*` |
| Redis | Backend | Pub/Sub | Socket.IO Redis adapter broadcasts to all server instances |

**Rooms:**
- `workspace:indicators` — Indicator workspace events
- `SYMBOL:TIMEFRAME` — Market data per symbol/timeframe
- `indicator:logs:INSTANCE_ID` — Indicator log streaming

### 3. Backend ↔ MT5 Bridge (HTTP)

| From | To | Type | Details |
|---|---|---|---|
| Backend | MT5 Bridge (read) | HTTP POST | `:8765` — Account info, positions, orders, deals, quotes |
| Backend | MT5 Bridge (exec) | HTTP POST | `:8766` — Order execution: open, close, modify, cancel |
| MT5 Bridge | Backend | HTTP POST | `/api/ohlcv/batch` — Candle data ingestion (Ingestion token auth) |
| MT5 Bridge | Backend | HTTP GET | `/api/sync-status/:symbol` — Check existing data range |

### 4. Backend ↔ Databases

| From | To | Type | Details |
|---|---|---|---|
| Backend | TimescaleDB | Prisma ORM | `:5433` — All 29 models (candles, signals, trading, users) |
| Backend | External DB | Raw PostgreSQL | `:5434` — External signal deployments (`PostgresExternalActionStore`) |
| Backend | Redis | ioredis | `:6379` — BullMQ queues, Socket.IO adapter, pub/sub, refresh tokens |

### 5. Backend ↔ External Services

| From | To | Type | Details |
|---|---|---|---|
| Backend | Telegram | HTTP POST | Via `TelegramExternalActionDeliveryService` |
| Backend | Webhook endpoints | HTTP POST | Via `TradingWebhookDeliveryService` |

### 6. Worker ↔ Backend

| Worker | Queue | Description |
|---|---|---|
| backtestExecutionWorker | `backtest-execution` | Processes backtest runs asynchronously |
| tradingAutoExecutionWorker | `trading-auto-execution` | Executes trade intents from automation bindings |
| tradingReconciliationWorker | `trading-reconciliation` | Syncs account state with broker |
| externalActionDeliveryWorker | (inline queue) | Delivers Telegram notifications and webhooks |

## Data Flow: Signal → Trade Execution

```
1. MT5 Bridge → /api/ohlcv/batch → TimescaleDB (candle storage)
2. Redis pub/sub → AlertEngine → IndicatorLiveRunner
3. IndicatorLiveRunner evaluates composed blocks → SignalEvent
4. SignalEvent → TradingTradeIntent (via automation binding)
5. TradingTradeIntent → BullMQ queue (trading-auto-execution)
6. Worker → TradingAutoExecutionProcessor → TradingExecutionService
7. TradingExecutionService → MT5BridgeClient → MT5 Bridge (:8766)
8. MT5 Bridge → MetaTrader 5 → Broker
9. Reconciliation worker → sync broker state → update positions/orders/deals
```

## Authentication Flow

```
1. Frontend POST /api/auth/login → Backend validates credentials
2. Backend returns: { accessToken (JWT), refreshToken (HttpOnly cookie) }
3. Frontend stores accessToken in Zustand → uses for API calls
4. Socket.IO connects with JWT in handshake auth
5. Refresh: Frontend POST /api/auth/refresh → new accessToken
6. Redis stores refresh token sessions with TTL
```

## Shared Dependencies

| Resource | Used By | Purpose |
|---|---|---|
| Redis | Backend, Workers | Job queues, pub/sub, Socket.IO adapter, token sessions |
| TimescaleDB | Backend, Workers | All persistent data |
| Prisma schema | Backend, Workers | Shared ORM models |
| Symbol normalization | Backend, MT5 Bridge | MT5 ↔ TradingView name mapping |
