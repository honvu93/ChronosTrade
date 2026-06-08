# Actionable Live Signal Event Feature Brief

## Goal

Turn a signal that has passed `Signal Live Eligibility` into an externally consumable, action-ready signal stream that:

- persists actionable `signalEvent` records in a dedicated signal-event datastore boundary,
- uses an MT5-understandable payload contract,
- and fans out those persisted events to Telegram so many downstream users can read and act on them.

## Problem Statement

The current platform can:

- evaluate live eligibility from completed backtests,
- promote backtests into live indicator instances,
- emit runtime `signalEvent` records internally,
- and support webhook-style downstream delivery.

What is still missing is a productized path that says:

1. this signal is approved for external action,
2. its runtime events must be persisted in a dedicated external-facing event store,
3. the event payload must be action-ready for MT5-oriented consumers,
4. and the same persisted event must be distributed to mass subscribers through Telegram.

## Proposed Capability

### 1. External Action Enablement

After a signal reaches `live-eligible`, an authorized user can explicitly enable an `External Action Channel` for a promoted live deployment, with `indicator instance` as the practical v1 activation boundary.

That enablement should:

- remain separate from internal paper auto-execution,
- require explicit activation state,
- preserve auditability about who enabled it and when,
- and fail closed if the signal loses eligibility or the deployment is paused/archived.

### 2. Dedicated Signal Event Persistence Boundary

Actionable runtime signal events should be written to a dedicated signal-event persistence boundary instead of being mixed only into the current operational tables.

The intent is:

- keep external delivery concerns isolated from current trading/audit persistence,
- support retention and replay for Telegram or future consumer channels,
- reduce coupling between internal runtime records and external subscriber delivery,
- and create a clean source of truth for externally actioned signal events.

For v1, this brief now assumes a dedicated physical Postgres database for externally actionable signal events, replay metadata, and Telegram delivery history, rather than only a logical schema split inside the existing application database.

### 3. MT5-Understandable Payload Contract

Each actionable `signalEvent` should use a stable contract that contains enough information for an MT5-aware consumer to understand:

- what action is suggested,
- for which symbol and direction,
- what price context the action came from,
- what protective levels apply,
- what version of signal logic created it,
- and whether the event is actionable, advisory, canceled, or superseded.

### 4. Telegram Distribution

After the event is persisted successfully, the platform should publish it to Telegram through a bot integration so mass users can read the signal in near real time.

Telegram delivery should:

- use the persisted record as the source of truth,
- support retry and failure tracking,
- avoid publishing partial or uncommitted events,
- and preserve traceability back to the originating signal/deployment/event record.

For v1, Telegram should operate as a broadcast lane aimed at exactly one Telegram bot / audience configuration tied to each external deployment, not as individualized per-subscriber private delivery.

## Proposed Scope

### In Scope

- explicit activation path from `Signal Live Eligibility` to external-action readiness
- dedicated persistence boundary for external actionable `signalEvent` records
- stable MT5-ready signal payload contract
- Telegram bot connector for mass delivery
- delivery audit and failure visibility
- user-scoped or audience-scoped subscription targets

### Out of Scope for First Story

- direct MT5 order placement on behalf of Telegram users
- copy-trading account management for external subscribers
- subscriber billing, entitlement, or paid access tiers
- multi-channel fanout beyond Telegram unless designed as an extension point
- destructive migration of existing signal/trading tables

## Recommended High-Level Flow

1. User reviews `Signal Live Eligibility`.
2. User promotes and runs a live deployment backed by an `indicator instance`.
3. Platform creates or selects an `external deployment` record that references that runtime deployment.
4. User enables `External Action` for that external deployment.
5. Runtime emits a qualifying live `ENTRY` signal event.
6. Platform shapes the event into an MT5-ready actionable contract.
7. Platform persists the event in the dedicated signal-event datastore boundary.
8. Platform marks the persisted event ready for outbound delivery.
9. Telegram connector reads the persisted event and posts the subscriber-facing message to the configured broadcast audience.
10. Delivery status, retry state, and traceability remain queryable in the platform.

## Proposed Payload Shape

This is a draft contract for refinement, but v1 should be treated as `ENTRY`-only and machine-oriented first:

```json
{
  "contractKind": "actionable-signal-event",
  "contractVersion": 1,
  "eventId": "evt_123",
  "emittedAt": "2026-03-13T10:15:00.000Z",
  "actionability": "ACTIONABLE",
  "actionType": "OPEN_MARKET",
  "source": {
    "signalCode": "SONGTRAP",
    "signalVersion": 3,
    "indicatorInstanceId": "inst_123",
    "eligibilityState": "live-eligible"
  },
  "market": {
    "symbol": "BTCUSDc",
    "timeframe": "1h",
    "side": "LONG",
    "candleTime": "2026-03-13T10:00:00.000Z",
    "referencePrice": 84250.5
  },
  "execution": {
    "entryPrice": 84250.5,
    "entryType": "MARKET",
    "stopLoss": 83600.0,
    "takeProfit1": 85000.0,
    "takeProfit2": 85800.0,
    "riskModel": "SIGNAL_DEFINED",
    "suggestedVolume": null
  },
  "lifecycle": {
    "eventType": "ENTRY",
    "state": "ACTIVE",
    "supersedesEventId": null,
    "expiresAt": null
  },
  "trace": {
    "internalSignalEventId": "sig_evt_123",
    "sourceBacktestRunId": "run_123",
    "signalKey": "SONGTRAP@v3"
  }
}
```

## Architecture Notes

- Prefer additive design. Do not overload existing internal `signal_events` semantics for all external-consumer concerns.
- The dedicated signal-event store for v1 is assumed to be a separate physical database.
- Use an outbox or delivery-state pattern so Telegram fanout happens after persistence succeeds.
- Do not let Telegram delivery failure block core live runtime evaluation.
- Keep internal paper auto-execution and external subscriber signaling as separate lanes, even if they reuse some event-shaping logic.
- For v1, activate external action through a dedicated `external deployment` object that references an `indicator instance`, not on raw signal definitions.
- Keep the canonical persisted payload machine-readable first, then derive Telegram human-readable formatting from it.

## Delivery and Operational Needs

- replay support for missed Telegram deliveries
- idempotent outbound publishing
- event status lifecycle such as `PENDING`, `READY`, `SENT`, `FAILED`, `CANCELED`
- operator visibility into failed delivery attempts
- traceability from Telegram message back to internal source event
- replay and Telegram delivery history stored in the dedicated external signal-event database
- one Telegram bot / audience configuration per external deployment in v1

## Open Questions

1. The activation boundary for v1 is a dedicated `external deployment` object referencing an `indicator instance`. Do we also want a future shortcut where one indicator instance can auto-create exactly one default external deployment?
2. The dedicated signal-event store for v1 is a separate physical Postgres database and now includes Telegram delivery history plus replay metadata from day one. What retention policy should apply to that database?
3. V1 is currently scoped to `ENTRY` only. V2 priority is now stop-loss and take-profit lifecycle coverage. Should v2 model these as explicit `STOP_HIT` / `TP1_HIT` / `TP2_HIT` events, or as a more generic managed-exit family?
4. The canonical payload currently avoids locking a mandatory trade volume because end users may have different account sizes. Do you want `suggestedVolume` to remain optional, or remove it entirely from v1?
5. Telegram v1 assumes exactly one Telegram bot / audience configuration per external deployment. Should future phases allow multiple audiences per deployment?
6. When a signal becomes no longer eligible, the current direction is to auto-pause the external deployment immediately. Should reactivation require a full manual enable flow, or a lighter resume flow after eligibility returns?
7. Should downstream consumers be able to acknowledge, reject, or mark an event as acted-on in a future phase?

## Recommended Next Documentation Step

Before implementation, lock these decisions first:

1. activation boundary,
2. dedicated datastore strategy,
3. exact event taxonomy,
4. MT5-ready payload contract v1,
5. Telegram audience and delivery model.
