# Data Models — Backend

_Generated: 2026-04-16 | Deep Scan_

---

## Database Architecture

- **Main DB:** TimescaleDB (PostgreSQL 16) on `:5433` — 29 Prisma models
- **External DB:** PostgreSQL 16 Alpine on `:5434` — External signal deployments (separate connection)
- **ORM:** Prisma 6.19.2 with `prisma/schema.prisma`

## Enums

### Trading Enums
| Enum | Values |
|---|---|
| PositionSide | LONG, SHORT |
| TradingSession | ASIAN, LONDON, NY |
| ExitReason | STOP_LOSS, TAKE_PROFIT_1, TAKE_PROFIT_2, BREAK_EVEN, TRAILING_STOP, EXPIRATION, MANUAL, OPEN |
| BrokerKind | MT5 |
| TradingAccountStatus | PENDING, ACTIVE, DISCONNECTED, ERROR, ARCHIVED |
| TradingAccountMode | LIVE, PAPER |
| TradingPositionStatus | OPEN, CLOSED |
| TradingOrderType | MARKET, BUY_LIMIT, SELL_LIMIT, BUY_STOP, SELL_STOP |
| TradingOrderStatus | PENDING, PLACED, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED |
| ExecutionCommandType | OPEN_MARKET, CLOSE_POSITION, PARTIAL_CLOSE, PLACE_PENDING, MODIFY_POSITION, CANCEL_ORDER, FORCE_SYNC |
| ExecutionCommandStatus | PENDING, VALIDATED, DISPATCHED, ACKNOWLEDGED, COMPLETED, REJECTED, FAILED, RECONCILED |
| TradingAutomationMode | OBSERVE, MANUAL_APPROVAL, AUTO_EXECUTE |
| TradingAutomationBindingStatus | PENDING_APPROVAL, ACTIVE, PAUSED, ARCHIVED |
| TradeIntentStatus | QUEUED, PROCESSING, EXECUTED, REJECTED, FAILED |
| TradingSyncKind | SUMMARY, POSITIONS, ORDERS, DEALS, FULL |
| TradingSyncStatus | QUEUED, RUNNING, SUCCEEDED, PARTIAL, FAILED |

### Signal Enums
| Enum | Values |
|---|---|
| SignalSourceType | IMPORTED, GENERATED |
| BacktestRunStatus | PENDING, RUNNING, COMPLETED, FAILED, CANCELED |
| SignalEventType | TRAP, X1, ENTRY, ENTRY_CONFIRMED, FAIL, COMPLETE_Y, MOVE_SL_BE, TRAIL_START, TRAIL_UPDATE, TP1_HIT, TP2_HIT, STOP_HIT, EXPIRATION |
| OptimizationJobStatus | PENDING, RUNNING, SUCCEEDED, FAILED, CANCELED |
| IndicatorStatus | DRAFT, ACTIVE, PAUSED, FAILED, ARCHIVED |

### Auth Enums
| Enum | Values |
|---|---|
| AppRole | ADMIN, USER |
| AppModule | CHART, SIGNAL, REPORT, TRADING, ENGINE |

### Investigation Enums
| Enum | Values |
|---|---|
| TradingInvestigationRootCause | DATA_QUALITY, SIGNAL_LOGIC, RISK_SETTINGS, BROKER_EXECUTION |
| TradingInvestigationOutcome | RESOLVED, MITIGATED, ESCALATED |
| TradingWebhookDeliveryStatus | PENDING, SUCCEEDED, FAILED |

## Core Models

### Market Data

**Candle** (`price_candles`)
- PK: `(time, symbol, timeframe, exchange)`
- Fields: open, high, low, close, volume, quote_volume, trades, taker_buy_volume, is_closed (all Decimal)

### Signal System

**Strategy** — Trading strategy container
- `id` (cuid), `code` (unique, varchar 40), `name`, `description`, `isActive`
- Has many: signals, backtestRuns

**SignalDefinition** — Signal code/version blueprint
- `id` (cuid), unique: `(code, version)`
- `name`, `category`, `description`, `isComposed`
- JSON fields: `parameterSchema`, `indicatorSchema`, `eventSchema`, `composedBlocks`
- `createdBy` (user ref)

**TechIndicatorDefinition** — Technical indicator catalog
- `id` (varchar 60, PK), `name`, `category`, `description`
- `paramSchema`, `conditions` (JSON)
- `runtimeBindingKey`, `catalogStatus`, `isActive`
- Audit: `createdAt`, `updatedAt`, `lastSyncedAt`, `syncSource`

**Signal** — Individual trade signal
- `id` (cuid), `backtestRunId`, `sourceType`, `definitionCode/Version`
- Trade: `symbol`, `timeframe`, `side`, `session`, `entryTime`, `entryPrice`, `stopLoss`, `takeProfit1/2`, `invalidationPrice`
- JSON: `executionConfigJson`
- Has many: results, events, logicTraces

**BacktestRun** — Backtest execution record
- `id` (cuid), `sourceType`, `status`, `signalCode/Version`
- Config: `symbol`, `timeframe`, `side`, `initialEquity`, `riskPercent`
- JSON: `parametersJson`, `executionConfigJson`
- Has many: signals, events, logicTraces, results

**BacktestTradeResult** — Per-signal outcome
- Unique: `(backtestRunId, signalId, exitRuleId)`
- Metrics: `win`, `isOpen`, `rMultiple`, `pnlUsd`, `maxDrawdownPct`
- `exitReason`, `exitTime`, `exitPrice`

**SignalEvent** — Event in backtest/live execution (13-step state machine)
- Unique: `(indicatorInstanceId, candleTime, eventType, cycleNumber)`
- Fields: `eventType`, `candleTime`, `price`, `label`, `metaJson`

**SignalLogicTrace** — Decision trace
- `signalEventId` (unique)
- State: `stateBefore`, `stateAfter`, `ruleId`
- Data: `indicatorJson`, `thresholdJson`, `priceJson`, `notes`

### Indicator System

**IndicatorInstance** — Live running indicator
- `id` (cuid), `status`, `sourceBacktestRunId`
- Config: `signalCode/Version`, `symbol`, `timeframe`
- State: `stateJson`, `stateVersion`, `lastProcessedCandleTime`
- Has many: events, logicTraces, alerts, tradeBindings, tradeIntents

**IndicatorAlert** — Alert condition
- `id` (cuid), `instanceId`, `type`, `conditionJson`, `isActive`

**SignalOptimizationJob** — Parameter optimization
- `signalCode/Version`, `symbol`, `timeframe`, `status`
- JSON: `parameterSpaceJson`, `rankingConfigJson`
- Has many: runs

### Trading System

**TradingAccount** — MT5 brokerage account
- `id` (cuid), `ownerUserId`, `brokerKind`, `accountMode` (LIVE/PAPER)
- `label`, `status`, `baseCurrency`, `leverage`
- Has: credential, snapshots, syncRuns, positions, orders, deals, commands, bindings, intents

**Mt5Credential** — Encrypted credentials
- `tradingAccountId` (unique), `ciphertext`

**TradingAccountSnapshot** — Point-in-time state
- `balance`, `equity`, `margin`, `freeMargin`, `marginLevel`, `unrealizedPnl`, `realizedPnlDay`

**TradingPosition** — Open/closed position
- Unique: `(accountId, brokerPositionId)`
- Fields: `symbol`, `side`, `volume`, `openPrice`, `stopLoss`, `takeProfit`, `status`

**TradingOrder** — Pending/filled order
- Unique: `(accountId, brokerOrderId)`
- Fields: `orderType`, `requestedVolume`, `filledVolume`, `status`

**TradingDeal** — Executed deal
- Unique: `(accountId, brokerDealId)`
- Fields: `commission`, `swap`, `fee`, `realizedPnl`

**TradingExecutionCommand** — Command to broker
- `tradeIntentId` (unique), `idempotencyKey` (unique)
- `commandType`, `status` (PENDING → VALIDATED → DISPATCHED → ACKNOWLEDGED → COMPLETED)
- Has many: events (state transition log)

**TradingAutomationBinding** — Links indicator to account
- Unique: `(accountId, indicatorInstanceId, name)`
- `mode` (OBSERVE/MANUAL_APPROVAL/AUTO_EXECUTE)
- JSON: `filtersJson`, `riskConfigJson`, `guardrailsJson`
- `killSwitchActive`, `approvalRequired`

**TradingTradeIntent** — Automation-generated intent
- Unique: `(bindingId, signalEventId)`
- `status` (QUEUED → PROCESSING → EXECUTED/REJECTED/FAILED)
- Fields: `commandType`, `symbol`, `side`, `volume`, `entryPrice`, `stopLoss`, `takeProfit`

### Auth System

**User** — System user
- `email` (unique), `username` (unique), `role` (ADMIN/USER)
- `activeTradingAccountId` (optional)
- Has many: permissions (UserModuleAccess), tradingAccounts

**UserModuleAccess** — Module permissions
- Unique: `(userId, module)`
- Modules: CHART, SIGNAL, REPORT, TRADING, ENGINE

### Audit & Investigation

**TradingInvestigationOutcomeRecord** — Root cause analysis
- `rootCause`, `outcome`, `summary`, `evidenceJson`

**TradingSyncRun** — Account sync record
- `syncKind`, `status`, `summaryJson`

### External Delivery

**TradingWebhookEndpoint** — Webhook receiver
- `url`, `contractKindsJson`, `bearerTokenCiphertext`, `signingSecretCiphertext`

**TradingWebhookDelivery** — Delivery attempt
- `status`, `httpStatus`, `payloadJson`, `recordRefsJson`

## Relationships Diagram (simplified)

```
User ─────────── UserModuleAccess (CHART, SIGNAL, REPORT, TRADING, ENGINE)
  │
  ├── TradingAccount ─── Mt5Credential
  │     ├── TradingPosition
  │     ├── TradingOrder
  │     ├── TradingDeal
  │     ├── TradingAccountSnapshot
  │     ├── TradingSyncRun
  │     ├── TradingExecutionCommand ─── TradingExecutionEvent
  │     ├── TradingAutomationBinding
  │     └── TradingTradeIntent
  │
Strategy ─── Signal ─── BacktestTradeResult
  │            ├── SignalEvent
  │            └── SignalLogicTrace
  │
  └── BacktestRun ─── SignalOptimizationRun ─── SignalOptimizationJob
                 └── IndicatorInstance ─── IndicatorAlert
                                     ├── SignalEvent
                                     ├── SignalLogicTrace
                                     ├── TradingAutomationBinding
                                     └── TradingTradeIntent
```
