# Trading Execution Logging

## Purpose

This note documents the structured logging added around Trading command submission so MT5 execution issues can be debugged from runtime logs without relying only on database state transitions.

The logging covers:

- write-capability blocks before the command route runs
- command route request receipt and invalid-body rejection
- execution-service lifecycle from request persistence through bridge dispatch, broker outcome, and reconciliation

## Log Format

All records are emitted as single-line JSON with the prefix:

```text
[TradingExecution] {...}
```

Core envelope fields:

- `timestamp`
- `domain` = `trading.execution`
- `level`
- `event`
- `message`

## Event Coverage

### Capability / Route Layer

- `command_capability_blocked`
- `command_capability_check_failed`
- `command_route_received`
- `command_route_invalid_body`
- `command_route_succeeded`
- `command_route_failed`

### Execution Lifecycle

- `command_submission_requested`
- `command_submission_reused_existing`
- `command_submission_retry_requested`
- `command_submission_persisted`
- `command_validation_rejected`
- `command_precondition_blocked`
- `command_validated`
- `command_force_sync_dispatched`
- `command_force_sync_reconciled`
- `command_force_sync_failed`
- `command_bridge_dispatched`
- `command_broker_rejected`
- `command_broker_completed`
- `command_reconciled_inline`
- `command_reconciliation_pending`
- `command_reconciliation_deferred`
- `command_reconciliation_deferred_missing_publisher`
- `command_reconciliation_enqueue_failed`
- `command_dispatch_failed`

## Useful Fields

These fields are included whenever available:

- `actorUserId`
- `requestedByUserId`
- `ownerUserId`
- `ownerScopeUserId`
- `accountId`
- `accountMode`
- `commandId`
- `commandType`
- `tradeIntentId`
- `symbol`
- `side`
- `volume`
- `price`
- `brokerPositionId`
- `brokerOrderId`
- `brokerReference`
- `idempotencyKey`
- `status`
- `errorCode`
- `errorMessage`

## Safety

The logger intentionally does not emit MT5 passwords or decrypted credential payloads.

Route-level request logging stores only sanitized command input details such as symbol, side, broker ids, and whether a comment was provided.

## Example

```text
[TradingExecution] {"timestamp":"2026-03-12T03:42:19.445Z","domain":"trading.execution","level":"info","event":"command_bridge_dispatched","message":"Trading command has been dispatched to the MT5 bridge.","actorUserId":"user-1","accountId":"acct-1","commandId":"cmd-1","commandType":"OPEN_MARKET","symbol":"BTCUSDc","side":"LONG","volume":0.1,"status":"DISPATCHED"}
```

## Primary Files

- `src/services/trading/tradingExecutionLogger.ts`
- `src/services/trading/TradingExecutionService.ts`
- `src/routes/registerTradingWorkspaceRoutes.ts`
- `src/middleware/featureFlag.ts`

## Verification

Targeted coverage was added in:

- `src/services/trading/TradingExecutionService.test.ts`
- `src/routes/registerTradingWorkspaceRoutes.test.ts`

Build verification:

- `npm run build`
