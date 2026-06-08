# Trading System -- Disaster Recovery Documentation

This document describes the full trading automation subsystem in enough detail to rebuild it from scratch. Every service, state machine, validation rule, and integration point is covered.

---

## 1. System Overview

The trading system bridges **signal generation** (backtesting engine, live indicator runner) with **broker execution** (MetaTrader 5) and **external delivery** (Telegram). The full lifecycle:

```
SignalDefinition
  -> BacktestRun (validation)
  -> IndicatorInstance (live deployment)
  -> SignalEvent (ENTRY, TP_HIT, STOP_HIT, etc.)
  -> TradingTradeIntent (queued for execution)
  -> TradingExecutionCommand (dispatched to MT5 bridge)
  -> MT5 Bridge (Python HTTP service)
  -> TradingReconciliation (broker state mirrored)
```

Parallel to execution, external action events are delivered to Telegram channels via the `externalAction/` subsystem.

### Key Architectural Decisions

- **Paper-only auto-execution**: Auto-execute mode is restricted to PAPER/demo accounts. Live accounts are blocked at the binding, intent, and processor layers.
- **Idempotency**: Execution commands use idempotency keys to prevent duplicate broker submissions.
- **Mirror-based reconciliation**: The system maintains a local mirror of broker state (positions, orders, deals, snapshots) and enforces freshness checks before allowing trade commands.
- **Encryption at rest**: MT5 credentials, webhook secrets, and Telegram bot tokens are encrypted with AES-256-GCM using `ENCRYPTION_KEY`.

---

## 2. Account Management

### Service: `TradingAccountService`

**File**: `TradingAccountService.ts`

Manages trading accounts with full CRUD, active account selection, and credential encryption.

#### Data Model

```typescript
interface TradingAccountSummary {
    id: string;
    ownerUserId: string;
    ownerEmail: string;
    ownerUsername: string;
    label: string;
    brokerKind: 'MT5';             // Only MT5 supported
    accountMode: 'LIVE' | 'PAPER';
    status: string;                // 'PENDING' default
    baseCurrency: string | null;
    leverage: number | null;
    lastSeenAt: string | null;
    lastSuccessfulSyncAt: string | null;
    mt5Login: string | null;       // Decrypted for display
    mt5Server: string | null;      // Decrypted for display
    hasStoredCredential: boolean;
    isActive: boolean;
}
```

#### Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `listAccounts` | `(actor, query?) -> TradingAccountListResult` | Lists accounts. Admins can list all; users see own only. Ordered by `updatedAt desc`. |
| `createAccount` | `(actor, input) -> TradingAccountSummary` | Creates account with encrypted credentials. Auto-selects as active if user has no active account. |
| `updateAccount` | `(actor, accountId, input, scope?) -> TradingAccountSummary` | Merges credential fields -- omitted fields retain current values, `null` password retains current. |
| `deleteAccount` | `(actor, accountId, scope?) -> TradingAccountDeleteResult` | Deletes account. If deleted account was active, falls back to most recent remaining account. |
| `selectActiveAccount` | `(actor, accountId, scope?) -> TradingAccountSelectionResult` | Sets the active trading account for the user. |
| `getBrokerContext` | `(actor, accountId, scope?) -> TradingAccountBrokerContext` | Returns account with decrypted credentials, metadata, and broker state. Used by execution and workspace services. |

#### Access Control

- **Users** can only manage their own accounts.
- **Admins** can manage other users' accounts only with explicit `scope.ownerUserId`.
- Accessing another user's account without scope throws `TRADING_ACCOUNT_FORBIDDEN` (403).

#### Error Codes

| Code | HTTP | Condition |
|------|------|-----------|
| `TRADING_ACCOUNT_NOT_FOUND` | 404 | Account ID does not exist |
| `TRADING_ACCOUNT_FORBIDDEN` | 403 | Actor lacks access to the account |
| `TRADING_ACCOUNT_ALREADY_EXISTS` | 409 | Unique constraint violation (P2002) |
| `TRADING_ACCOUNT_INVALID` | 400 | Validation failure (label, accountMode, credentials) |
| `TRADING_ACCOUNT_OWNER_NOT_FOUND` | 404 | Referenced user does not exist |
| `TRADING_ACCOUNT_ENCRYPTION_REQUIRED` | 500 | `ENCRYPTION_KEY` not configured |
| `TRADING_ACCOUNT_SCHEMA_MISMATCH` | 500 | Database schema does not match expected |

#### Validation Rules

- `label`: required, 1-120 chars
- `mt5Login`: required, max 60 chars
- `mt5Password`: required, max 255 chars
- `mt5Server`: required, max 120 chars
- `accountMode`: must be `LIVE` or `PAPER`, defaults to `LIVE`

### Service: `TradingAccountReadinessService`

**File**: `TradingAccountReadinessService.ts`

Evaluates whether an account is ready for trading by checking credentials, bridge connectivity, and execution readiness.

#### Readiness States

```
ready                 -- All checks pass
execution-blocked     -- MT5 terminal/account flags block trading
credentials-missing   -- No credentials configured at all
credentials-partial   -- Some credentials present, some missing
bridge-unreachable    -- MT5 bridge not responding
unchecked            -- Not yet evaluated
```

#### Check Items

1. **MT5 Login** -- present and non-empty
2. **MT5 Password** -- present and non-empty
3. **MT5 Server** -- present and non-empty
4. **Bridge Port** -- resolved (exec-env > legacy-env > default 8765)
5. **Encryption Key** -- `ENCRYPTION_KEY` >= 32 chars

#### Full Readiness (with network checks)

`evaluateFullStoredAccountReadiness()` extends the basic check with:

1. **Bridge Health** -- HTTP GET to `http://localhost:{port}/bridge/health` (3s timeout)
2. **Execution Readiness** -- HTTP POST to `/bridge/account/readiness` checking:
   - `terminal.tradeAllowed` (not false)
   - `terminal.tradeApiDisabled` (not true)
   - `account.tradeAllowed` (not false)

---

## 3. Automation Binding

### Service: `TradingAutomationBindingService`

**File**: `TradingAutomationBindingService.ts`

Binds live indicator instances to trading accounts, defining how signals should be executed.

#### Data Model

```typescript
interface TradingAutomationBindingView {
    id: string;
    accountId: string;
    indicatorInstanceId: string;
    indicatorName: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    name: string;
    status: string;          // PENDING_APPROVAL, ACTIVE, PAUSED, etc.
    mode: string;            // AUTO_EXECUTE or MANUAL
    approvalRequired: boolean;
    killSwitchActive: boolean;
    filtersJson: JSON | null;
    riskConfigJson: JSON | null;     // Contains fixedVolume/volume/lotSize
    guardrailsJson: JSON | null;
}
```

#### Automation Snapshot

`listBindings()` returns a `TradingAutomationSnapshot`:

```typescript
{
    autoExecuteLocked: boolean;     // true if accountMode !== 'PAPER'
    pendingApprovalCount: number;
    bindings: TradingAutomationBindingView[];
    availableIndicators: TradingAutomationIndicatorCandidate[];  // Latest 20
}
```

#### Business Rules

1. **AUTO_EXECUTE mode is paper-only**: Creating a binding with `mode=AUTO_EXECUTE` on a non-PAPER account throws `TRADING_AUTOMATION_LOCKED` (409).
2. **Activating AUTO_EXECUTE on non-PAPER throws** `TRADING_AUTOMATION_LOCKED`.
3. New bindings start in `PENDING_APPROVAL` status.
4. Setting status to `ACTIVE` records `approvedByUserId` and `approvedAt`.
5. `killSwitchActive` can be toggled during status updates.

---

## 4. Signal Eligibility & Versioning

### Service: `SignalLiveEligibilityService`

**File**: `SignalLiveEligibilityService.ts`

Evaluates whether signals are ready for live trading based on backtest results.

#### Eligibility States

| State | Meaning |
|-------|---------|
| `live-eligible` | Ready for live deployment |
| `validated` | Passed minimum checks but sub-threshold for live |
| `blocked` | Hard blockers found (negative returns, extreme drawdown) |
| `draft` | Insufficient data or incomplete backtest |
| `no-backtest` | No backtest run exists |

#### Thresholds

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `STRONG_SAMPLE_THRESHOLD` | 10 | Minimum closed trades for live eligibility |
| `MIN_VALIDATED_SAMPLE` | 5 | Minimum closed trades for validation |
| `MIN_PROFIT_FACTOR_LIVE` | 1.5 | Required for live eligibility |
| `MIN_PROFIT_FACTOR_VALID` | 1.0 | Required for any positive evidence |
| `MAX_DRAWDOWN_LIVE_PCT` | -8% | Live eligibility ceiling |
| `BLOCKED_DRAWDOWN_PCT` | -15% | Hard stop -- blocks signal |

#### Live Eligibility Requirements (all must be true)

- `closedTrades >= 10`
- `openTrades === 0`
- `netR > 0`
- `profitFactor >= 1.5`
- `maxDrawdownPct > -8%`

#### Blocking Reasons (hard stops)

- `net_negative`: Net return is negative or zero
- `profit_factor_too_low`: Below 1.0
- `excessive_drawdown`: Below -15%

### Service: `SignalVersionService`

**File**: `SignalVersionService.ts`

Resolves signal version snapshots from three possible origins:

1. **`signal-definition`** -- bare signal definition with preferred backtest
2. **`backtest-run`** -- specific backtest run context
3. **`indicator-instance`** -- live deployment with its parameters

Returns `SignalVersionSnapshot` including parameter schema, indicator schema, event schema, composed blocks, and linked backtest/account context.

---

## 5. Trade Intent Pipeline

### Service: `TradingTradeIntentService`

**File**: `TradingTradeIntentService.ts`

Creates trade intents from live signal events and dispatches them to the auto-execution worker.

#### Intent Creation Flow (`captureAutoExecuteEntryIntents`)

1. Filter persisted events for `ENTRY` type matching the runtime signal's external key.
2. Find all ACTIVE automation bindings for the indicator instance with:
   - `mode = AUTO_EXECUTE`
   - `status = ACTIVE`
   - `killSwitchActive = false`
   - `account.accountMode = PAPER`
3. For each binding x entry event pair, create a `TradingTradeIntent` with:
   - `status = QUEUED`
   - `commandType = OPEN_MARKET`
   - Entry price, stop loss, take profit from runtime signal
   - Payload includes: signalExternalKey, candleTime, entryTime, executionConfigJson, triggerSource
4. Update binding's `lastTriggeredAt`.
5. Enqueue to BullMQ auto-execution queue.
6. If enqueue fails, mark intent as `FAILED`.
7. Duplicate intents (P2002) are silently skipped.

#### Trade Intent States

```
QUEUED -> PROCESSING -> EXECUTED
                     -> REJECTED
                     -> FAILED
```

---

## 6. Execution Pipeline

### Service: `TradingExecutionService`

**File**: `TradingExecutionService.ts`

The central execution engine. Accepts command requests, validates, dispatches to MT5 bridge, and manages reconciliation.

#### Command Types

| Type | Required Fields | Description |
|------|----------------|-------------|
| `OPEN_MARKET` | symbol, side, volume (>0) | Open a market order |
| `PLACE_PENDING` | symbol, volume (>0), price, orderType | Place a pending order (BUY_LIMIT, SELL_LIMIT, BUY_STOP, SELL_STOP) |
| `CLOSE_POSITION` | brokerPositionId | Close an entire position |
| `PARTIAL_CLOSE` | brokerPositionId, volume (>0) | Partially close a position |
| `MODIFY_POSITION` | brokerPositionId, stopLoss or takeProfit | Modify SL/TP on a position |
| `CANCEL_ORDER` | brokerOrderId | Cancel a pending order |
| `FORCE_SYNC` | (none) | Force mirror reconciliation |

#### Execution Command State Machine

```
PENDING -> VALIDATED -> DISPATCHED -> COMPLETED -> RECONCILED
                                   -> REJECTED (broker rejected)
                                   -> FAILED (transport failure)
                     -> REJECTED (precondition blocked)
           -> REJECTED (validation failed)
```

#### Execution Flow (`createCommand`)

1. **Idempotency check**: Look up by `idempotencyKey`. If found and not retryable, return existing.
2. **Persist command**: Create with status `PENDING`, record `REQUESTED` event.
3. **Validation**: Check required fields per command type.
4. **Precondition check** (non-FORCE_SYNC): Verify `syncHealth.canTrade` and credential presence.
5. **Dispatch to bridge**: Call appropriate MT5BridgeClient method.
6. **Handle result**:
   - `accepted=true`: Transition to `COMPLETED`, then attempt reconciliation.
   - `accepted=false`, transport failure: Transition to `FAILED`.
   - `accepted=false`, broker rejection: Transition to `REJECTED`.
7. **Reconciliation**: If `skipReconciliation=false`, inline `forceSync`. If that fails, record `RECONCILE_PENDING` event. If `skipReconciliation=true`, defer via BullMQ reconciliation queue.

#### Retryable Error Codes

`BRIDGE_UNREACHABLE`, `BRIDGE_TRANSPORT_FAILURE` -- commands with these error codes can be retried when `retryFailedCommand=true`.

#### Event Types Recorded

`REQUESTED`, `VALIDATED`, `DISPATCHED`, `BROKER_COMPLETED`, `BROKER_REJECTED`, `DISPATCH_FAILED`, `PRECONDITION_BLOCKED`, `VALIDATION_REJECTED`, `RECONCILED`, `RECONCILE_PENDING`, `RECONCILE_DEFERRED`, `RETRY_REQUESTED`

---

## 7. Auto Execution

### Service: `TradingAutoExecutionProcessor`

**File**: `TradingAutoExecutionProcessor.ts`

BullMQ worker that processes queued trade intents.

#### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `DEFAULT_PAPER_VOLUME` | 0.01 lots | Fallback when no riskConfig volume |
| `MAX_INTENT_AGE_MS` | 30,000 ms | Intent expires if older |
| `MAX_PRICE_DEVIATION_PERCENT` | 0.5% | Max price drift from signal |

#### Processing Flow (`process(tradeIntentId, {attemptNumber, maxAttempts})`)

1. **Claim**: Atomically transition `QUEUED` or `FAILED` intents to `PROCESSING`. Prevents double-processing.
2. **Age check**: Reject if intent is older than 30 seconds.
3. **Existing command check**: If already linked to a command, sync intent status with command status. Retry only if command failed with retryable error.
4. **Safety checks**:
   - Account must be `PAPER` mode
   - Binding must be `AUTO_EXECUTE` mode
   - Binding must be `ACTIVE` status
   - Kill switch must be off
   - Command type must be `OPEN_MARKET`
   - Side must be present
5. **Volume resolution**: Read from `binding.riskConfigJson` (fields: `fixedVolume`, `volume`, `lotSize`). Fall back to 0.01.
6. **Price deviation check**: Fetch current quote from bridge. If price moved > 0.5% from signal entry price, reject.
7. **Execute**: Call `TradingExecutionService.createCommand` with `skipReconciliation=true`, `retryFailedCommand=true`.
8. **Retry**: If command fails with retryable error and attempts remain, throw `RetryScheduledError` for BullMQ retry.

---

## 8. MT5 Bridge Integration

### Client: `MT5BridgeClient`

**File**: `MT5BridgeClient.ts`

HTTP client for the Python MT5 bridge service.

#### Base URL

`http://localhost:{port}/bridge` where port is resolved by `mt5BridgeConfig.ts`.

#### API Endpoints

| Method | Path | Returns |
|--------|------|---------|
| `health()` | GET `/health` | `boolean` |
| `fetchSummary(creds)` | POST `/account/summary` | Account balance, equity, margin, etc. |
| `fetchPositions(creds)` | POST `/account/positions` | Open positions array |
| `fetchOrders(creds)` | POST `/account/orders` | Pending orders array |
| `fetchDeals(creds, {limit})` | POST `/account/deals` | Deal history |
| `fetchQuote(creds, symbol)` | POST `/market/quote` | Bid/ask/last for symbol |
| `fetchExecutionReadiness(creds)` | POST `/account/readiness` | Terminal & account trade permissions |
| `openMarket(creds, payload)` | POST `/command/open-market` | Command result |
| `placePending(creds, payload)` | POST `/command/place-pending` | Command result |
| `closePosition(creds, payload)` | POST `/command/close-position` | Command result |
| `partialClose(creds, payload)` | POST `/command/partial-close` | Command result |
| `modifyPosition(creds, payload)` | POST `/command/modify-position` | Command result |
| `cancelOrder(creds, payload)` | POST `/command/cancel-order` | Command result |

#### Response Envelope

```typescript
interface MT5BridgeEnvelope<T> {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string; };
}
```

#### Command Result

```typescript
interface MT5BridgeCommandResult {
    accepted: boolean;
    brokerReference: string | null;
    brokerPositionId: string | null;
    brokerOrderId: string | null;
    message: string;
    payload: Record<string, unknown> | null;
    failure?: {
        code: string;
        category: 'terminal' | 'preflight' | 'broker' | 'transport';
        retcode: number | null;
        comment: string | null;
        message: string;
    } | null;
}
```

#### Error Handling

- Network failures throw `MT5BridgeClientError` with code `BRIDGE_UNREACHABLE` (502).
- Non-OK responses throw with the bridge error code, or `BRIDGE_REQUEST_FAILED`.

### Credential Encryption: `MT5CredentialCipher`

**File**: `MT5CredentialCipher.ts`

#### Algorithm

- **Cipher**: AES-256-GCM
- **Key derivation**: SHA-256 hash of `ENCRYPTION_KEY` env var (minimum 32 chars)
- **IV**: 12 random bytes per encryption
- **Storage format**: `{iv_hex}:{auth_tag_hex}:{ciphertext_hex}`

#### Payload

```typescript
interface MT5CredentialPayload {
    mt5Login: string;
    mt5Password: string;
    mt5Server: string;
}
```

### Bridge Configuration: `mt5BridgeConfig.ts`

**File**: `mt5BridgeConfig.ts`

Port resolution priority:

1. `MT5_EXEC_BRIDGE_PORT` env var (source: `exec-env`)
2. `MT5_BRIDGE_PORT` env var (source: `legacy-env`)
3. Default: `8765` (source: `default`)

---

## 9. Reconciliation

### Service: `TradingReconciliationProcessor`

**File**: `TradingReconciliationProcessor.ts`

BullMQ worker that reconciles broker state after execution.

#### Processing Flow

1. Resolve the account owner user ID.
2. Call `tradingAccountService.getBrokerContext()` to verify account access.
3. Call `workspaceService.forceSync()` to mirror broker state.

### Workspace Service: `TradingWorkspaceService`

**File**: `TradingWorkspaceService.ts`

Maintains a local mirror of broker state and evaluates sync health.

#### Sync Health States

| State | canTrade | Meaning |
|-------|----------|---------|
| `healthy` | true (if readiness=ready) | Mirror is fresh (<300s) |
| `stale` | false | Mirror data is older than 300 seconds |
| `disconnected` | false | Bridge unreachable or no mirror exists |
| `failed` | false | Latest sync failed or partial |

#### Mirror Components

- **TradingAccountSnapshot**: Balance, equity, margin, free margin, unrealized PnL
- **TradingPosition**: Open/closed positions with broker IDs
- **TradingOrder**: Pending orders with statuses
- **TradingDeal**: Execution history
- **TradingSyncRun**: Sync attempt history

#### forceSync Flow

Calls the MT5 bridge to fetch current account summary, positions, orders, and deals, then upserts into the local database. Updates `lastSuccessfulSyncAt` on the trading account.

#### Constants

- `STALE_AFTER_SECONDS`: 300 (5 minutes)
- `DEFAULT_DEAL_LIMIT`: 50
- `MAX_DEAL_LIMIT`: 500

---

## 10. Quality Assurance

### Service: `FailureClassificationService`

**File**: `FailureClassificationService.ts`

Classifies system failures across four domains.

#### Domains

| Domain | What it checks | Critical threshold | Warning threshold |
|--------|---------------|-------------------|-------------------|
| `ingestion` | Candle data freshness per symbol/timeframe | >24h since last candle | >4h since last candle |
| `signal` | IndicatorInstance failures (backtest-linked) | Status = FAILED | Status = PAUSED |
| `alert` | Failed backtest runs in last 24h | (none) | Any FAILED run |
| `trading` | Live IndicatorInstance failures (no source backtest) | Status = FAILED | Status = PAUSED |

#### Output

```typescript
interface FailureClassificationSnapshot {
    domains: Record<FailureDomain, DomainStatus>;
    totalCritical: number;
    totalWarning: number;
    evaluatedAt: string;
}
```

### Service: `TradingDiscrepancyService`

**File**: `TradingDiscrepancyService.ts`

Compares backtest validation results with live deployment state to detect drift.

#### Investigation Kinds

- `alert-driven`: No trade record specified
- `reported-issue`: Trade record specified
- `mixed-context`: Trade record + backtest/indicator specified

#### Discrepancy Types Detected

| Code | Severity | Description |
|------|----------|-------------|
| `parameter-drift` | warning | Live parameters differ from validation run |
| `execution-config-drift` | warning | Live execution config differs from validation run |
| `market-context-drift` | warning | Live deployment running on different symbol/timeframe |
| `missing-source-link` | warning | No direct source-backtest link on deployment |
| `live-status-failed` | critical/warning | Live deployment not ACTIVE |
| `activity-gap` | warning | Validation produced trades but live has no commands |
| `missing-live-deployment` | warning | No live deployment linked |
| `outcome-drift` | critical | Historical outcome differs from latest live outcome |

#### Deployment Matching Priority

1. `exact` -- explicit indicator instance ID match
2. `source-run` -- deployment's source backtest matches
3. `market-context` -- same symbol + timeframe
4. `signal-version` -- same signal code + version

### Service: `TradingRootCauseService`

**File**: `TradingRootCauseService.ts`

Performs root cause analysis by scoring evidence across four categories.

#### Root Cause Categories

| Category | Label | Evidence sources |
|----------|-------|-----------------|
| `data-quality` | Data Quality | Ingestion failures, activity gaps, stale deployments |
| `signal-logic` | Signal Logic | Signal/alert failures, outcome drift, eligibility blocks |
| `risk-settings` | Risk Settings | Parameter/config drift, drawdown blocks |
| `broker-execution` | Broker Execution | Trading failures, broker-related text patterns, account readiness |

#### Confidence Levels

- `high`: score >= 120 or any critical evidence
- `medium`: score >= 60
- `low`: score < 60

#### Investigation Outcomes

- `resolved` -- Issue fixed
- `mitigated` -- Partial fix applied
- `escalated` -- Requires further attention

Outcomes are persisted as `TradingInvestigationOutcomeRecord` and can trigger webhook deliveries.

### Service: `TradingDiagnosisService`

**File**: `TradingDiagnosisService.ts`

Unified facade over the three diagnosis-layer services:

- `TradingAuditService` -- trade history and timeline
- `TradingDiscrepancyService` -- backtest-vs-live comparison
- `TradingRootCauseService` -- root cause analysis and investigation

Methods: `listHistory()`, `getHistoryDetail(recordId)`, `getDiscrepancy(input)`, `diagnose(input)`, `recordOutcome(input)`.

---

## 11. Audit & Export

### Service: `TradingAuditService`

**File**: `TradingAuditService.ts`

Provides trade history audit with full event timelines.

#### Trade Result Classification

- `ACTIVE`: `isOpen = true`
- `WIN`: closed, `win = true`
- `LOSS`: closed, `win = false`, PnL != 0
- `BE` (break-even): closed, PnL within epsilon of 0

#### Audit Coverage

- `full`: both command and decision events present
- `partial`: some events present
- `missing`: no events found

#### Timeline Item Kinds

- `command`: Events that represent actionable execution (ENTRY_CONFIRMED, MOVE_SL_BE, TRAIL_START, TRAIL_UPDATE, TP1_HIT, TP2_HIT, STOP_HIT, EXPIRATION)
- `decision`: All other events (signals, traces, internal logic)

#### Default/Max Limits

- Default: 12 records
- Maximum: 50 records

### Service: `TradingExportService`

**File**: `TradingExportService.ts`

Exports trading data as standardized output contract envelopes.

#### Export Record Types

1. **signal-event**: Signal events from SignalEvent table
2. **execution-event**: Logic traces from SignalLogicTrace table
3. **trade-outcome**: Trade results from BacktestTradeResult table
4. **investigation-outcome**: Investigation outcomes from TradingInvestigationOutcomeRecord table

#### Default/Max Limits

- Default: 200 records
- Maximum: 1000 records

### Service: `TradingOutputContractService`

**File**: `TradingOutputContractService.ts`

Defines and shapes standardized output envelopes with strict validation.

#### Contract Envelope

```typescript
interface TradingOutputEnvelope<T> {
    contractKind: TradingOutputContractKind;
    contractVersion: 1;       // Always version 1
    recordId: string;
    signalKey: string;        // Format: "{code}@v{version}"
    emittedAt: string;        // ISO 8601
    payload: T;
}
```

#### Validation

Every field is sanitized:
- Strings: trimmed, required fields must be non-empty
- Numbers: must be finite, versions must be positive integers
- Timestamps: parsed and re-serialized as ISO 8601
- Enums: validated against known sets

---

## 12. Webhook Delivery

### Service: `TradingWebhookDeliveryService`

**File**: `TradingWebhookDeliveryService.ts`

Manages outbound webhook endpoints and delivers trading output records.

#### Endpoint Registration

```typescript
interface TradingWebhookEndpointInput {
    name: string;
    url: string;                              // Must be HTTPS
    contractKinds?: TradingOutputContractKind[];  // Default: all 4 kinds
    bearerToken?: string | null;              // Optional, encrypted at rest
    signingSecret: string;                    // Required, encrypted at rest
    isActive?: boolean;                       // Default: true
}
```

#### Security

1. **URL validation**: Must be HTTPS, no embedded credentials
2. **Host allowlist**: `TRADING_WEBHOOK_ALLOWED_HOSTS` env var (comma-separated, supports `*.domain.com` wildcards)
3. **Private IP blocking**: localhost, 10.x, 127.x, 169.254.x, 172.16-31.x, 192.168.x, IPv6 loopback/link-local
4. **Request signing**: HMAC-SHA256 of request body with signing secret, sent as `x-signature` header
5. **Bearer token**: Sent as `Authorization: Bearer {token}` header

#### Delivery Flow

1. Load export records via `TradingExportService`.
2. Merge and sort by occurred-at descending.
3. For each active endpoint matching the contract kinds:
   - Create `PENDING` delivery record
   - POST JSON body to endpoint URL with 5s timeout
   - Record HTTP status, response body, and record references
   - Transition to `SUCCEEDED` or `FAILED`

#### Configured Dispatch (`deliverConfiguredOutputs`)

Used internally (e.g., after recording investigation outcomes) to deliver to all matching endpoints without explicit endpoint selection.

#### Delivery Limits

- Default: 100 records per delivery
- Maximum: 500 records per delivery

---

## 13. External Actions (Telegram Delivery)

### Architecture

External actions use a **separate PostgreSQL database** (`EXTERNAL_SIGNAL_DB_URL`) to isolate deployment data from the main trading database. The subsystem uses raw SQL via `$queryRawUnsafe` through `ExternalSignalStore`.

### Service: `ExternalActionDeploymentService`

**File**: `externalAction/ExternalActionDeploymentService.ts`

Manages Telegram signal deployments that forward live signal events to Telegram channels.

#### Deployment Lifecycle

```
DRAFT -> ACTIVE -> PAUSED -> ACTIVE (re-enable)
                -> ARCHIVED
      -> AUTO_PAUSED (eligibility change)
```

#### Create Deployment

Requires:
- `indicatorInstanceId` -- must exist in main database
- `telegramBotToken` -- encrypted with AES-256-GCM before storage
- `telegramChatId` -- Telegram chat/channel ID
- Eligibility state is snapshotted at creation time

#### Status Transitions

| Method | From | To | Records |
|--------|------|----|---------|
| `enableDeployment` | any | ACTIVE | `enabledByUserId`, `enabledAt`, eligibility snapshot |
| `pauseDeployment` | any | PAUSED | `pausedByUserId`, `pausedAt`, reason |
| `archiveDeployment` | any | ARCHIVED | `archivedByUserId`, `archivedAt`, reason |
| `autoPauseActiveDeploymentsByIndicatorInstance` | ACTIVE | AUTO_PAUSED | reason, eligibility state |

### Service: `ExternalActionEventService`

**File**: `externalAction/ExternalActionEventService.ts`

Captures actionable signal events from live indicator output.

#### Event Capture Flow (`captureActionableEvents`)

1. Check for valid runtime signal with external key.
2. Find all ACTIVE deployments for the indicator instance.
3. Filter persisted events for ENTRY type matching the signal's external key.
4. Look up signal eligibility.
5. For each deployment x entry event:
   - Create `ActionableSignalEventContractV1` payload
   - Idempotency key: `{deploymentId}:{signalEventId}`
   - Enqueue to BullMQ delivery queue
   - If enqueue fails, mark event as FAILED

#### Actionable Signal Event Contract V1

```typescript
interface ActionableSignalEventContractV1 {
    contractKind: 'actionable-signal-event';
    contractVersion: 1;
    eventId: string;
    emittedAt: string;
    actionability: 'ACTIONABLE' | 'CANCELED' | 'EXPIRED' | 'SUPERSEDED' | 'ADVISORY';
    actionType: 'OPEN_MARKET';
    source: { signalCode, signalVersion, indicatorInstanceId, sourceBacktestRunId, externalDeploymentId, eligibilityState };
    market: { symbol, timeframe, side, candleTime, referencePrice };
    execution: { entryPrice, entryType: 'MARKET', stopLoss, takeProfit1, takeProfit2, suggestedVolume };
    trace: { internalSignalEventId, signalKey };
}
```

### Service: `ExternalActionDeliveryProcessor`

**File**: `externalAction/ExternalActionDeliveryProcessor.ts`

BullMQ worker that delivers events to Telegram.

#### Processing Flow

1. If replay job, mark as started.
2. Load event with deployment context.
3. If deployment is not ACTIVE, cancel the event.
4. Create delivery attempt record.
5. Call `TelegramExternalActionDeliveryService.deliver()`.
6. On success: mark delivery as SENT, event as SENT, replay job as completed.
7. On failure: mark delivery as FAILED. If max attempts reached, mark event as FAILED.

### Service: `TelegramExternalActionDeliveryService`

**File**: `externalAction/TelegramExternalActionDeliveryService.ts`

Sends formatted messages to Telegram via the Bot API.

#### Message Format

```
Signal Alert
{signalCode}@v{version}
{side_icon} {symbol} {timeframe} {side}

Entry: {price}
Stop Loss: {price}
TP1: {price}
TP2: {price}

Emitted: {timestamp}
Deployment: {id}
Signal only. Not guaranteed execution.
```

#### Technical Details

- API URL: `TELEGRAM_API_BASE_URL` env var, default `https://api.telegram.org`
- Endpoint: `/bot{token}/sendMessage`
- Timeout: 5 seconds
- Response parsing extracts `message_id` and `chat.id`
- Request fingerprint: SHA-256 hash of request body

### Service: `ExternalActionReplayService`

**File**: `externalAction/ExternalActionReplayService.ts`

Allows manual retry of failed Telegram deliveries.

1. Verify event exists and actor has access.
2. Create replay job record with kind `MANUAL_RETRY`.
3. Reset event status to `READY`.
4. Enqueue to delivery queue with replay job ID.
5. If enqueue fails, restore original status and fail the replay job.

### Queue: `ExternalActionDeliveryQueue`

**File**: `externalAction/ExternalActionDeliveryQueue.ts`

- Queue name: `external-action-delivery`
- Job name: `deliver-external-action-event`
- Default attempts: 3
- Backoff: exponential, 2 second base delay
- Worker concurrency: `EXTERNAL_ACTION_WORKER_CONCURRENCY` env var, default 5
- Remove on complete: keep last 1000
- Remove on fail: keep last 5000

### Store: `ExternalSignalStore`

**File**: `externalAction/ExternalSignalStore.ts`

Raw SQL store against the external signal database. Uses `$queryRawUnsafe` and `$executeRawUnsafe` because this database has a different schema from the main Prisma-managed database.

### Encryption: `secretCrypto.ts`

**File**: `externalAction/secretCrypto.ts`

Same AES-256-GCM pattern as `MT5CredentialCipher`:
- Key: SHA-256 of `ENCRYPTION_KEY` (min 32 chars)
- Format: `{iv_hex}:{auth_tag_hex}:{ciphertext_hex}`

---

## 14. Feature Flags

### File: `tradingFeatureFlags.ts`

Three-tier capability system controlled by environment variables.

#### Environment Variables

| Env Var | Flag Key | Default |
|---------|----------|---------|
| `FEATURE_TRADING_READ` | `trading_read_enabled` | false |
| `FEATURE_TRADING_WRITE` | `trading_write_enabled` | false |
| `FEATURE_TRADING_AUTO` | `trading_automation_enabled` | false |

#### Capability Tiers (hierarchical)

| Tier | Requires | Controls |
|------|----------|----------|
| `read` | `trading_read_enabled` | View eligibility, account readiness, operational review |
| `write` | `read` + `trading_write_enabled` | Manual activation, command submission |
| `automation` | `write` + `trading_automation_enabled` | Automated execution paths |

#### Paper Account Override

When `accountMode === 'PAPER'`, the write and automation tiers are automatically enabled even if their environment flags are off. This allows paper trading without enabling live trading flags.

#### Snapshot Output

```typescript
interface TradingFeatureFlagSnapshot {
    evaluatedAt: string;
    flags: TradingFeatureFlags;
    capabilities: Record<TradingCapabilityTier, TradingCapabilitySnapshot>;
    highestEnabledTier: 'read' | 'write' | 'automation' | 'none';
}
```

Each capability includes: `tier`, `flagKey`, `requested`, `enabled`, `blockedBy[]`, `title`, `reason`.

---

## 15. Execution Logging

### File: `tradingExecutionLogger.ts`

Structured JSON logging for all trading execution events.

#### Log Record Fields

```typescript
interface TradingExecutionLogRecord {
    event: string;              // e.g., 'command_submission_requested'
    message: string;
    actorUserId?: string;
    ownerUserId?: string;
    accountId?: string;
    accountMode?: 'LIVE' | 'PAPER';
    commandId?: string;
    commandType?: string;
    tradeIntentId?: string;
    symbol?: string;
    side?: string;
    volume?: number;
    price?: number;
    brokerPositionId?: string;
    brokerOrderId?: string;
    brokerReference?: string;
    idempotencyKey?: string;
    status?: string;
    errorCode?: string;
    errorMessage?: string;
}
```

Format: `[TradingExecution] {JSON}` with timestamp and domain `trading.execution`.

---

## 16. State Machines Summary

### Trade Intent States

```
QUEUED ──> PROCESSING ──> EXECUTED
                      ──> REJECTED
                      ──> FAILED (retryable: re-enters QUEUED/FAILED)
```

### Execution Command States

```
PENDING ──> VALIDATED ──> DISPATCHED ──> COMPLETED ──> RECONCILED
                                     ──> REJECTED (broker)
                                     ──> FAILED (transport)
                      ──> REJECTED (precondition)
            ──> REJECTED (validation)
```

### Workspace Sync Health States

```
healthy       -- Mirror fresh, readiness=ready -> canTrade=true
stale         -- Mirror >300s old -> canTrade=false
disconnected  -- Bridge unreachable or no mirror -> canTrade=false
failed        -- Latest sync FAILED/PARTIAL -> canTrade=false
```

### Account Readiness States

```
ready               -- All checks pass
execution-blocked   -- Terminal/account flags block trading
credentials-missing -- No credentials at all
credentials-partial -- Some credentials missing
bridge-unreachable  -- Bridge not responding
unchecked          -- Not yet evaluated
```

### External Deployment States

```
DRAFT ──> ACTIVE ──> PAUSED ──> ACTIVE (re-enable)
                 ──> AUTO_PAUSED ──> ACTIVE (re-enable)
                 ──> ARCHIVED
```

### External Action Event States

```
READY ──> SENT
      ──> FAILED
      ──> CANCELED
```

### External Action Delivery States

```
PENDING ──> SENT
        ──> FAILED
```

### External Action Replay States

```
QUEUED ──> PROCESSING ──> COMPLETED
                      ──> FAILED
```

### Automation Binding States

```
PENDING_APPROVAL ──> ACTIVE ──> PAUSED
                            ──> (kill switch toggled)
```

---

## 17. Environment Variables Reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `ENCRYPTION_KEY` | Yes (>=32 chars) | AES-256-GCM key for credentials, webhook secrets, Telegram tokens |
| `MT5_EXEC_BRIDGE_PORT` | No | Execution bridge port (highest priority) |
| `MT5_BRIDGE_PORT` | No | Legacy bridge port |
| `MT5_LOGIN` | No | Fallback MT5 login (env-based accounts) |
| `MT5_PASSWORD` | No | Fallback MT5 password |
| `MT5_SERVER` | No | Fallback MT5 server |
| `FEATURE_TRADING_READ` | No | Enable read tier |
| `FEATURE_TRADING_WRITE` | No | Enable write tier |
| `FEATURE_TRADING_AUTO` | No | Enable automation tier |
| `TRADING_WEBHOOK_ALLOWED_HOSTS` | For webhooks | Comma-separated host allowlist |
| `EXTERNAL_SIGNAL_DB_URL` | For external actions | Separate PostgreSQL for Telegram deployments |
| `TELEGRAM_API_BASE_URL` | No | Default: `https://api.telegram.org` |
| `EXTERNAL_ACTION_WORKER_CONCURRENCY` | No | Default: 5 |
| `REDIS_URL` | Yes | BullMQ queue backend |
| `QUEUE_PREFIX` | No | Default: `tvgit` |
