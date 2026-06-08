# 06 - Real-time System & Background Workers

Disaster recovery reference for the Socket.IO real-time layer and all BullMQ background workers. All constants, queue names, event names, and channel names are reproduced exactly as they appear in the source code.

---

## Table of Contents

1. [Real-time Architecture](#1-real-time-architecture)
2. [Socket.IO Rooms](#2-socketio-rooms)
3. [Socket.IO Events](#3-socketio-events)
4. [Redis Pub/Sub Channels](#4-redis-pubsub-channels)
5. [BullMQ Queue Architecture](#5-bullmq-queue-architecture)
6. [Worker: Backtest Execution](#6-worker-backtest-execution)
7. [Worker: Trading Auto Execution](#7-worker-trading-auto-execution)
8. [Worker: Trading Reconciliation](#8-worker-trading-reconciliation)
9. [Worker: External Action Delivery](#9-worker-external-action-delivery)
10. [Data Flow Diagrams](#10-data-flow-diagrams)
11. [Error Handling & Retry](#11-error-handling--retry)
12. [Concurrency & Scaling](#12-concurrency--scaling)

---

## 1. Real-time Architecture

### Overview

The real-time system uses Socket.IO on top of the HTTP server, with Redis Pub/Sub as the transport between the API server (which ingests data) and Socket.IO (which broadcasts to clients). There is no Redis Socket.IO adapter; instead, a dedicated `SocketService` subscribes to Redis channels using pattern subscriptions (`psubscribe`) and re-emits messages to the appropriate Socket.IO rooms.

### Key Files

| File | Role |
|---|---|
| `src/server.ts` | `ApiServer` class -- creates HTTP server, SocketService, Redis publisher |
| `src/services/SocketService.ts` | Socket.IO server, Redis subscriber, authentication middleware, room management |

### Initialization Sequence

1. `ApiServer` constructor creates:
   - `http.Server` via `http.createServer(express())`
   - `SocketService(server)` -- instantiates `new Server(server, { cors })` and a Redis subscriber
   - `IORedis` publisher instance (`this.pub`) for publishing candle data and indicator events
2. On `server.start()`:
   - `this.socketService.init()` is called -- sets up auth middleware, connection handlers, and Redis pattern subscriptions
   - `this.alertEngine.init()` is called -- sets up a separate Redis subscriber for price/indicator alert monitoring

### Socket.IO Server Configuration

```typescript
// src/services/SocketService.ts
this.io = new Server(server, {
    cors: getCorsOptions()  // shares the same CORS config as Express
});
```

No custom transports, ping intervals, or adapter configuration. Uses default Socket.IO settings (WebSocket + long-polling fallback).

### Authentication Handshake

Socket.IO uses a middleware function that runs before `connection` is established. The authentication flow:

1. Extract token from one of three sources (in priority order):
   - `socket.handshake.auth.token` -- the Socket.IO auth object
   - `socket.handshake.headers.authorization` -- standard Authorization header
   - Cookie `tvgit.accessToken` -- extracted via `extractCookieTokenFromHeader()`
2. Strip `Bearer ` prefix if present
3. Verify the JWT token using `verifyJwtToken(tokenValue, resolveJwtSecret())`
4. On success, store claims in `socket.data`:
   - `socket.data.authorizedRole` -- `'ADMIN'` or `'USER'`
   - `socket.data.authorizedModules` -- normalized array of `AuthModuleKey` values (e.g., `'signal'`, `'engine'`, `'chart'`, `'report'`, `'trading'`)
   - `socket.data.canAccessIndicatorStreams` -- `true` if role is `ADMIN` or modules include `'signal'` or `'engine'`
5. On failure, the connection is rejected with `Error('Authentication error: ...')`

---

## 2. Socket.IO Rooms

| Room Name Pattern | Who Joins | Events Received | Auto-Joined |
|---|---|---|---|
| `workspace:indicators` | All clients with `canAccessIndicatorStreams === true` | `indicator:events`, `indicator:logs:{instanceId}`, `indicator:alerts:triggered`, `backtest:progress` | Yes, on connection |
| `{SYMBOL}:{TIMEFRAME}` (e.g., `XAUUSD:H1`) | Clients that send a `subscribe` event | `tick`, `candle` | No, client-initiated |

### Room Lifecycle

- `workspace:indicators`: Automatically joined on connection if the user has signal/engine module access. Never explicitly left (persists until disconnect).
- `{SYMBOL}:{TIMEFRAME}`: Joined via `subscribe` client event, left via `unsubscribe` client event. Symbol and timeframe are normalized using `normalizeMarketSymbol()` and `normalizeTimeframe()`.

---

## 3. Socket.IO Events

### Client-to-Server Events

| Event Name | Payload | Description |
|---|---|---|
| `subscribe` | `{ symbol: string, timeframe: string }` | Join the `{SYMBOL}:{TIMEFRAME}` room for live price data |
| `unsubscribe` | `{ symbol: string, timeframe: string }` | Leave the `{SYMBOL}:{TIMEFRAME}` room |

### Server-to-Client Events

| Event Name | Target Room | Payload | Source |
|---|---|---|---|
| `tick` | `{SYMBOL}:{TIMEFRAME}` | `{ s, t, open, high, low, close, volume, is_closed }` | Redis `live:*:*` channel |
| `candle` | `{SYMBOL}:{TIMEFRAME}` | `{ s, t, open, high, low, close, volume, is_closed }` | Redis `confirmed:*:*` channel |
| `indicator:events` | `workspace:indicators` | `{ instanceId, symbol, timeframe, event }` where `event` is a persisted `SignalEvent` record | Redis `indicator:events` channel |
| `indicator:logs:{instanceId}` | `workspace:indicators` | Log entry JSON (varies by log level) | Redis `indicator:logs:{instanceId}` channel |
| `indicator:alerts:triggered` | `workspace:indicators` | `{ alertId, instanceId, instanceName, symbol, message, timestamp }` | Redis `indicator:alerts:*` channel |
| `backtest:progress` | `workspace:indicators` | `{ status, backtestRunId, batchId, counts?, error? }` | Redis `backtest:progress:*` channel |

### Payload Details

**`tick` / `candle` payload:**
```json
{
    "s": "XAUUSD",
    "t": 1712000000000,
    "open": 2345.50,
    "high": 2346.00,
    "low": 2345.00,
    "close": 2345.80,
    "volume": 150,
    "is_closed": true
}
```

**`backtest:progress` payload (RUNNING):**
```json
{
    "status": "RUNNING",
    "backtestRunId": "uuid",
    "batchId": "uuid-or-null"
}
```

**`backtest:progress` payload (COMPLETED):**
```json
{
    "status": "COMPLETED",
    "backtestRunId": "uuid",
    "batchId": "uuid-or-null",
    "counts": { /* signal event counts from execution result */ }
}
```

**`backtest:progress` payload (FAILED):**
```json
{
    "status": "FAILED",
    "backtestRunId": "uuid",
    "batchId": "uuid-or-null",
    "error": "Error message string"
}
```

---

## 4. Redis Pub/Sub Channels

The system uses two separate Redis subscriber instances: one in `SocketService` and one in `AlertEngine`. Both use `psubscribe` (pattern subscription).

### Channel Definitions

| Channel Pattern | Published By | Subscribers | Message Format |
|---|---|---|---|
| `live:{SYMBOL}:{TIMEFRAME}` | `ApiServer.upsertCandles()` | `SocketService` (broadcasts as `tick`), `AlertEngine` (checks price alerts) | `{ s, t, open, high, low, close, volume, is_closed }` |
| `confirmed:{SYMBOL}:{TIMEFRAME}` | External source (MT5 pusher) | `SocketService` (broadcasts as `candle`) | Same as `live` |
| `indicator:events` | `IndicatorLiveRunner.runTick()` | `SocketService` (broadcasts as `indicator:events`), `AlertEngine` (checks indicator alerts) | `{ instanceId, symbol, timeframe, event }` |
| `indicator:logs:{instanceId}` | `IndicatorLogger` | `SocketService` (broadcasts as `indicator:logs:{instanceId}`) | Log entry JSON |
| `indicator:alerts:triggered` | `AlertEngine.triggerAlert()` | `SocketService` (broadcasts as `indicator:alerts:triggered`) | `{ alertId, instanceId, instanceName, symbol, message, timestamp }` |
| `backtest:progress:{backtestRunId}` | `backtestExecutionWorker` | `SocketService` (broadcasts as `backtest:progress`) | `{ status, backtestRunId, batchId, counts?, error? }` |

### Pattern Subscriptions

**SocketService subscribes to:**
```
live:*:*
confirmed:*:*
indicator:events
indicator:logs:*
indicator:alerts:*
backtest:progress:*
```

**AlertEngine subscribes to:**
```
live:*:*
indicator:events
```

### Publisher Instance

A single `IORedis` publisher instance (`this.pub`) is created in `ApiServer` constructor and shared with:
- `ApiServer.upsertCandles()` -- publishes to `live:{SYMBOL}:{TIMEFRAME}`
- `IndicatorLiveRunner` -- publishes to `indicator:events` and `indicator:logs:*` via `IndicatorLogger`
- `AlertEngine` -- publishes to `indicator:alerts:triggered`

The backtest worker creates its own separate Redis publisher for `backtest:progress:*`.

---

## 5. BullMQ Queue Architecture

All queues share a common configuration pattern:
- **Redis connection**: parsed from `REDIS_URL` env var (default `redis://localhost:6379`)
- **Queue prefix**: `QUEUE_PREFIX` env var (default `tvgit`)
- **Job ID deduplication**: each queue uses deterministic `jobId` values to prevent duplicate processing

### Queue Summary

| Queue Name | Job Name | Source File | Payload Interface |
|---|---|---|---|
| `backtest-execution` | `execute-backtest-run` | `src/queues/backtestExecutionQueue.ts` | `BacktestExecutionJobPayload` |
| `trading-auto-execution` | `execute-trade-intent` | `src/queues/tradingAutoExecutionQueue.ts` | `TradingAutoExecutionJobPayload` |
| `trading-reconciliation` | `reconcile-trading-account` | `src/queues/tradingReconciliationQueue.ts` | `TradingReconciliationJobPayload` |
| `external-action-delivery` | `deliver-external-action-event` | `src/services/trading/externalAction/ExternalActionDeliveryQueue.ts` | `ExternalActionDeliveryJobPayload` |

### Job Data Schemas

**`BacktestExecutionJobPayload`:**
```typescript
{
    backtestRunId: string;
    batchId?: string;
}
```
- `jobId`: `backtestRunId`
- `attempts`: 1
- `removeOnComplete`: 100
- `removeOnFail`: 50

**`TradingAutoExecutionJobPayload`:**
```typescript
{
    tradeIntentId: string;
}
```
- `jobId`: `tradeIntentId`
- `attempts`: 3
- `backoff`: exponential, 2000ms base delay
- `removeOnComplete`: 1000
- `removeOnFail`: 5000

**`TradingReconciliationJobPayload`:**
```typescript
{
    accountId: string;
    requestedByUserId: string | null;
    sourceCommandId: string;
}
```
- `jobId`: `reconcile:{accountId}`
- `delay`: `TRADING_RECONCILIATION_DELAY_MS` env var (default 5000ms)
- `removeOnComplete`: 1000
- `removeOnFail`: 5000
- No retry (attempts not set, defaults to 1)

**`ExternalActionDeliveryJobPayload`:**
```typescript
{
    externalActionEventId: string;
    replayJobId?: string | null;
}
```
- `jobId`: `replayJobId` if present, otherwise `externalActionEventId`
- `attempts`: 3
- `backoff`: exponential, 2000ms base delay
- `removeOnComplete`: 1000
- `removeOnFail`: 5000

---

## 6. Worker: Backtest Execution

### Entry Point

`src/workers/backtestExecutionWorker.ts` -- started via `npm run dev:backtest:worker`

### What It Does

Executes a single backtest run asynchronously. When a user creates a backtest via the API, the job is enqueued. The worker:

1. Publishes `RUNNING` status to Redis channel `backtest:progress:{backtestRunId}`
2. Calls `SignalBacktestExecutionService.executeRun(backtestRunId)` which replays candle history through the signal logic and records events
3. On success, publishes `COMPLETED` with event counts
4. On failure, publishes `FAILED` with error message, then re-throws to let BullMQ mark the job as failed

### Concurrency

- Env var: `BACKTEST_WORKER_CONCURRENCY`
- Default: **5**
- Configurable at startup, not dynamically adjustable

### Job Options

- `attempts`: 1 (no retry -- backtests are idempotent but expensive)
- `removeOnComplete`: 100 (keep last 100 completed jobs)
- `removeOnFail`: 50

### Dependencies

- `PrismaClient` -- database access
- `IORedis` publisher -- for progress broadcast
- `SignalBacktestExecutionService` -- contains the backtest engine

### Graceful Shutdown

- Listens for `SIGINT` and `SIGTERM`
- Calls `worker.close()`, `pub.quit()`, `prisma.$disconnect()`
- Force-exits after 30 seconds if graceful shutdown stalls

---

## 7. Worker: Trading Auto Execution

### Entry Point

`src/workers/tradingAutoExecutionWorker.ts` -- started via `npm run dev:trading:auto-worker`

### What It Does

Processes trade intents created by the `IndicatorLiveRunner` when a live signal produces an ENTRY event and an active AUTO_EXECUTE binding exists. This is event-driven (not polling): the intent is enqueued immediately when the signal fires.

### Processing Flow (`TradingAutoExecutionProcessor.process()`)

1. **Claim the intent**: atomically transition status from `QUEUED` or `FAILED` to `PROCESSING` (prevents double-processing)
2. **Check intent age**: reject if older than `MAX_INTENT_AGE_MS` (30 seconds)
3. **Check existing command**: if already linked to an execution command, resolve status and skip
4. **Safety checks** (any failure rejects the intent):
   - Account mode must be `PAPER` (auto-execution only for paper/demo accounts)
   - Binding mode must be `AUTO_EXECUTE`
   - Binding status must be `ACTIVE`
   - Kill switch must not be active
   - Command type must be `OPEN_MARKET`
   - Side must be present
5. **Resolve volume**: reads `fixedVolume`, `volume`, or `lotSize` from `binding.riskConfigJson`, falls back to `DEFAULT_PAPER_VOLUME` (0.01)
6. **Price deviation check**: if the intent has an `entryPrice`, fetch current quote from MT5 bridge; reject if deviation exceeds `MAX_PRICE_DEVIATION_PERCENT` (0.5%)
7. **Execute**: calls `TradingExecutionService.createCommand()` with idempotency key `trade-intent:{intentId}`
8. **Handle result**: update intent status to `EXECUTED`, `REJECTED`, or `FAILED`
9. **Retry on transient failure**: if `BRIDGE_UNREACHABLE` error and attempts remain, throw `RetryScheduledError` to trigger BullMQ retry

### Constants

| Constant | Value |
|---|---|
| `DEFAULT_PAPER_VOLUME` | `0.01` |
| `MAX_INTENT_AGE_MS` | `30_000` (30 seconds) |
| `MAX_PRICE_DEVIATION_PERCENT` | `0.5` |
| `RETRYABLE_COMMAND_ERROR_CODES` | `Set(['BRIDGE_UNREACHABLE'])` |

### Concurrency

- Env var: `WORKER_CONCURRENCY`
- Default: **10**

### Job Options

- `attempts`: 3
- `backoff`: exponential, 2000ms base (2s, 4s, 8s)
- `removeOnComplete`: 1000
- `removeOnFail`: 5000

---

## 8. Worker: Trading Reconciliation

### Entry Point

`src/workers/tradingReconciliationWorker.ts` -- started via `npm run dev:trading:reconciliation-worker`

### What It Does

Syncs local trading account state with the actual MT5 broker state. Triggered after a trade execution command is submitted to the broker.

### Reconciliation Cycle

1. **Triggered by**: `TradingExecutionService` enqueues a reconciliation job after submitting a command to the MT5 bridge (with `skipReconciliation: true` option, the reconciliation is deferred to this worker)
2. **Delay**: jobs are enqueued with a configurable delay (`TRADING_RECONCILIATION_DELAY_MS`, default 5000ms) to give the broker time to process the command
3. **Deduplication**: job ID is `reconcile:{accountId}`, so multiple commands for the same account within the delay window collapse into a single reconciliation
4. **Processing** (`TradingReconciliationProcessor.process()`):
   - Resolves the account owner (from `requestedByUserId` or by looking up the account)
   - Calls `TradingAccountService.getBrokerContext()` to verify account access
   - Calls `TradingWorkspaceService.forceSync()` which fetches the current broker state and reconciles positions, orders, and history

### Concurrency

- Env var: `TRADING_RECONCILIATION_WORKER_CONCURRENCY`
- Default: **3**

### Job Options

- `delay`: `TRADING_RECONCILIATION_DELAY_MS` env var (default 5000ms)
- No retry configuration (defaults to 1 attempt)
- `removeOnComplete`: 1000
- `removeOnFail`: 5000

---

## 9. Worker: External Action Delivery

### Entry Point

`src/workers/externalActionDeliveryWorker.ts` -- started via `npm run dev:external-action:worker`

### What It Does

Delivers signal notifications to external channels (currently Telegram only). Triggered when a live indicator produces an ENTRY event and an active external deployment exists for that indicator instance.

### Event Capture Flow (Upstream)

1. `IndicatorLiveRunner` produces signal events
2. `ExternalActionEventService.captureActionableEvents()` is called:
   - Filters for `ENTRY` events with matching `signalExternalKey`
   - Finds active deployments for the indicator instance (from external signal DB)
   - Creates an `ExternalActionEventRecord` in the external signal database with full payload (ActionableSignalEventContractV1)
   - Enqueues a delivery job via `ExternalActionDeliveryJobPublisher`

### Delivery Processing (`ExternalActionDeliveryProcessor`)

1. If this is a replay job, mark the replay job as started
2. Fetch the event with its deployment details from the external signal store
3. If deployment is not `ACTIVE`, cancel the event
4. Create a delivery attempt record (status `PENDING`)
5. Call `TelegramExternalActionDeliveryService.deliver()`:
   - Decrypt bot token from `telegramBotTokenCiphertext` using `decryptSecret()`
   - POST to Telegram API: `{TELEGRAM_API_BASE_URL}/bot{token}/sendMessage`
   - Request timeout: 5 seconds
   - Parse response for `message_id` and `chat_id`
6. On success:
   - Update delivery attempt to `SENT` with provider message/chat IDs
   - Update event status to `SENT`
   - Mark replay job as completed (if applicable)
7. On failure:
   - Update delivery attempt to `FAILED` with error details
   - If `attemptNumber >= maxAttempts`, update event status to `FAILED`
   - Mark replay job as failed (if applicable)
   - Re-throw error to trigger BullMQ retry

### Telegram Message Format

```
Signal Alert
{signalCode}@v{signalVersion}
{sideIcon} {symbol} {timeframe} {side}

Entry: {entryPrice}
Stop Loss: {stopLoss}
TP1: {takeProfit1}
TP2: {takeProfit2}

Emitted: {emittedAt}
Deployment: {deploymentId}
Signal only. Not guaranteed execution.
```

### Retry Policy

- `attempts`: 3
- `backoff`: exponential, 2000ms base (2s, 4s, 8s)
- Final failure persists error to both the delivery record and the event record

### External Signal Database

This worker uses a separate PostgreSQL database (`EXTERNAL_SIGNAL_DB_URL`) managed by `PostgresExternalActionStore`. This database is independent of the main TimescaleDB and stores:
- Deployments (Telegram bot configs)
- Action events (signal snapshots)
- Delivery attempts (audit trail)
- Replay jobs (manual retry tracking)

### Concurrency

- Env var: `EXTERNAL_ACTION_WORKER_CONCURRENCY`
- Default: **5**

---

## 10. Data Flow Diagrams

### Flow 1: Candle Ingestion to Client Broadcast

```
MT5 Pusher (Python)
    |
    | POST /api/ohlcv/:symbol  or  POST /api/ohlcv/batch
    | (Auth: Bearer INGESTION_TOKEN)
    v
ApiServer.upsertCandles()
    |
    |-- 1. Upsert candles to TimescaleDB (chunks of 500)
    |
    |-- 2. Publish last candle to Redis:
    |       Channel: live:{SYMBOL}:{TIMEFRAME}
    |       Payload: { s, t, open, high, low, close, volume, is_closed }
    |
    |-- 3. Trigger IndicatorLiveRunner (async, non-blocking)
    |
    v
SocketService (Redis subscriber)
    |
    |-- Receives pmessage on live:*:*
    |-- Emits 'tick' to room {SYMBOL}:{TIMEFRAME}
    v
Frontend (Socket.IO client)
```

### Flow 2: Live Indicator Evaluation to Signal Events

```
ApiServer.triggerIndicators()
    |
    | Find active IndicatorInstances matching symbol/timeframe
    |
    v
IndicatorLiveRunner.runTick(instanceId)
    |
    |-- 1. Load indicator plugin from SignalRegistry
    |-- 2. Query new candles since lastProcessedCandleTime
    |-- 3. Load 200-bar history window for context
    |-- 4. For each new bar, call plugin.onBar()
    |
    |-- If events produced:
    |       |-- Save SignalEvent records to DB
    |       |-- Publish to Redis: indicator:events
    |       |-- Call TradingTradeIntentService.captureAutoExecuteEntryIntents()
    |       |       |-- Creates TradingTradeIntent (QUEUED)
    |       |       |-- Enqueues to BullMQ: trading-auto-execution
    |       |-- Call ExternalActionEventService.captureActionableEvents()
    |       |       |-- Creates ExternalActionEventRecord in external DB
    |       |       |-- Enqueues to BullMQ: external-action-delivery
    |       |-- Dispatch webhook outputs
    |
    |-- Save state checkpoint
    v
SocketService
    |-- Receives indicator:events
    |-- Emits 'indicator:events' to workspace:indicators
    v
Frontend
```

### Flow 3: Trade Auto-Execution Pipeline

```
TradingTradeIntentService
    |
    | Creates TradingTradeIntent (status: QUEUED)
    | Enqueues job to BullMQ: trading-auto-execution
    v
TradingAutoExecutionWorker
    |
    | Dequeues job { tradeIntentId }
    v
TradingAutoExecutionProcessor.process()
    |
    |-- Claim intent (QUEUED/FAILED -> PROCESSING)
    |-- Validate: age, account mode, binding mode/status, kill switch
    |-- Resolve volume from riskConfigJson
    |-- Check price deviation against MT5 quote
    |
    v
TradingExecutionService.createCommand()
    |
    |-- Submit OPEN_MARKET to MT5 bridge
    |-- Enqueue reconciliation job (delayed)
    v
TradingReconciliationWorker (after 5s delay)
    |
    |-- TradingWorkspaceService.forceSync()
    |-- Sync positions/orders from MT5 broker
```

### Flow 4: External Signal Delivery (Telegram)

```
ExternalActionEventService.captureActionableEvents()
    |
    |-- Filter ENTRY events with externalKey
    |-- Find active deployments for indicator instance
    |-- Create ExternalActionEventRecord in external DB
    |-- Enqueue to BullMQ: external-action-delivery
    v
ExternalActionDeliveryWorker
    |
    | Dequeues job { externalActionEventId }
    v
ExternalActionDeliveryProcessor.process()
    |
    |-- Fetch event + deployment from external DB
    |-- Validate deployment is ACTIVE
    |-- Create delivery attempt record
    v
TelegramExternalActionDeliveryService.deliver()
    |
    |-- Decrypt bot token
    |-- POST /bot{token}/sendMessage to Telegram API
    |-- 5s timeout
    |
    |-- Success: update event=SENT, delivery=SENT
    |-- Failure: update delivery=FAILED, retry via BullMQ
```

### Flow 5: Alert Engine (Price & Indicator Alerts)

```
Redis Pub/Sub
    |
    |-- live:*:* messages
    |       |
    |       v
    |   AlertEngine.checkPriceAlerts()
    |       |-- Query active PRICE alerts for symbol/timeframe
    |       |-- Evaluate condition (> or < target)
    |       |-- If triggered & past 60s cooldown:
    |               |-- Update lastTriggeredAt
    |               |-- Publish to Redis: indicator:alerts:triggered
    |
    |-- indicator:events messages
            |
            v
        AlertEngine.checkIndicatorAlerts()
            |-- Query active INDICATOR alerts for instanceId
            |-- Match eventType against condition
            |-- If triggered & past 60s cooldown:
                    |-- Publish to Redis: indicator:alerts:triggered
                    v
                SocketService
                    |-- Emits 'indicator:alerts:triggered' to workspace:indicators
```

---

## 11. Error Handling & Retry

### Per-Worker Retry Configuration

| Worker | Attempts | Backoff | Dead Letter Queue |
|---|---|---|---|
| Backtest Execution | 1 (no retry) | N/A | No |
| Trading Auto Execution | 3 | Exponential, 2s base | No (failed jobs kept: 5000) |
| Trading Reconciliation | 1 (no retry) | N/A | No (failed jobs kept: 5000) |
| External Action Delivery | 3 | Exponential, 2s base | No (failed jobs kept: 5000) |

### Trading Auto Execution Error Handling

- **Intent expiry**: Intents older than 30 seconds are rejected outright (not retried)
- **Retryable errors**: only `BRIDGE_UNREACHABLE` triggers retry via BullMQ re-throw
- **Non-retryable errors**: intent is marked `REJECTED` or `FAILED` with reason stored in `statusReason`
- **Atomic claim**: `updateMany` with `status IN ('QUEUED', 'FAILED')` prevents double-processing
- **Price deviation**: rejected if current price deviates > 0.5% from signal entry price

### External Action Delivery Error Handling

- **Missing event**: silently returns (marks replay job as failed if applicable)
- **Inactive deployment**: event status set to `CANCELED`
- **Telegram API failure**: delivery attempt marked `FAILED`, error re-thrown for BullMQ retry
- **Final failure** (attempt 3): event status set to `FAILED`, replay job marked failed
- **Delivery audit trail**: every attempt is recorded as an `ExternalActionDeliveryRecord` regardless of outcome

### Backtest Execution Error Handling

- **No retry**: backtests run once; if they fail, the `FAILED` status is published to Redis for UI feedback
- **Progress channel**: clients can monitor `backtest:progress:{backtestRunId}` for real-time status

### IndicatorLiveRunner Error Handling

- **Reentrancy guard**: `processingInstances` Set prevents concurrent processing of the same instance
- **Fatal errors**: stored in `indicatorInstance.errorMessage` for UI display
- **Recovery**: on next successful tick, `errorMessage` is cleared
- **Non-blocking side effects**: trade intent capture, external action capture, and webhook delivery all use `try/catch` to prevent side-effect failures from blocking the indicator evaluation loop

### Graceful Shutdown (All Workers)

All four workers implement identical shutdown logic:
- Listen for `SIGINT` and `SIGTERM`
- Call `worker.close()` (drains in-progress jobs)
- Disconnect from Prisma/Redis
- Force-exit after `SHUTDOWN_TIMEOUT_MS` (30 seconds) if graceful shutdown stalls

---

## 12. Concurrency & Scaling

### Worker Concurrency Settings

| Worker | Env Var | Default | Notes |
|---|---|---|---|
| Backtest Execution | `BACKTEST_WORKER_CONCURRENCY` | 5 | CPU-bound; higher values may thrash DB |
| Trading Auto Execution | `WORKER_CONCURRENCY` | 10 | I/O-bound (MT5 bridge calls); higher is safe |
| Trading Reconciliation | `TRADING_RECONCILIATION_WORKER_CONCURRENCY` | 3 | Deduplication by accountId limits parallelism |
| External Action Delivery | `EXTERNAL_ACTION_WORKER_CONCURRENCY` | 5 | I/O-bound (Telegram API calls) |

### Horizontal Scaling Considerations

**BullMQ Workers:**
- All workers are stateless and can run multiple instances. BullMQ handles distributed locking.
- Job deduplication via `jobId` prevents duplicate processing across instances.
- The reconciliation worker uses `reconcile:{accountId}` as jobId, so concurrent reconciliation requests for the same account are collapsed.

**SocketService:**
- Currently runs in-process with the API server (single instance).
- Does NOT use the Redis Socket.IO adapter (`@socket.io/redis-adapter`). If horizontal scaling of the API server is needed, the Redis adapter must be added.
- Each API server instance creates its own Redis subscriber, so without the adapter, clients connected to different instances would not receive each other's broadcasts.

**IndicatorLiveRunner:**
- Runs in-process on the API server. The `processingInstances` Set is per-process, so running multiple API instances could cause duplicate indicator evaluations for the same instance.
- To scale horizontally, a distributed lock (e.g., Redis-based) would be needed for `runTick()`.

**AlertEngine:**
- Runs in-process on the API server. Each API instance creates its own subscriber.
- Running multiple API instances would cause duplicate alert evaluations, but the 60-second cooldown and `lastTriggeredAt` check provide some protection against duplicate notifications.

### Queue Prefix Isolation

All queues use a configurable prefix (`QUEUE_PREFIX` env var, default `tvgit`). This allows multiple environments (staging, production) to share the same Redis instance without queue name collisions. BullMQ stores keys as `{prefix}:{queueName}:*`.

### Environment Variables Summary

| Variable | Used By | Default |
|---|---|---|
| `REDIS_URL` | All queues and pub/sub | `redis://localhost:6379` |
| `QUEUE_PREFIX` | All BullMQ queues | `tvgit` |
| `BACKTEST_WORKER_CONCURRENCY` | Backtest worker | `5` |
| `WORKER_CONCURRENCY` | Trading auto-execution worker | `10` |
| `TRADING_RECONCILIATION_WORKER_CONCURRENCY` | Reconciliation worker | `3` |
| `TRADING_RECONCILIATION_DELAY_MS` | Reconciliation job delay | `5000` |
| `EXTERNAL_ACTION_WORKER_CONCURRENCY` | External action worker | `5` |
| `EXTERNAL_SIGNAL_DB_URL` | External action store (separate PostgreSQL) | N/A (optional) |
| `TELEGRAM_API_BASE_URL` | Telegram delivery service | `https://api.telegram.org` |
