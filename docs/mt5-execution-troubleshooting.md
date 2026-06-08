# MT5 Execution Troubleshooting

## Purpose

This runbook covers the dedicated MT5 execution bridge introduced for trading writes. Use it when the trading workspace or auto-execution worker reports terminal-side or broker-side order failures.

## Required Terminal Settings

Use the dedicated execution terminal/profile only.

- `AutoTrading` must be enabled in the MT5 toolbar.
- MT5 terminal options must allow external Python/API trading.
- The execution bridge must run against the same terminal path/profile configured through `MT5_TERMINAL_PATH`, `MT5_TERMINAL_PORTABLE`, and `MT5_EXEC_BRIDGE_PORT`.
- The saved MT5 credential must still point to the intended login and server for the selected account.

## Quick Checks

1. Confirm the bridge is up on the execution port.
   - `GET /bridge/health`
2. Confirm terminal readiness before placing an order.
   - `POST /bridge/account/readiness`
   - Inspect `terminal.tradeAllowed`, `terminal.tradeApiDisabled`, and `account.tradeAllowed`.
3. Confirm symbol quote/readiness using the same account credential.
   - `POST /bridge/market/quote`
4. For write failures, inspect the latest command record in the trading workspace audit drawer.
   - Use `errorCode`, `errorMessage`, and the latest broker payload JSON.

## Common Failures

### `10027` / `TERMINAL_AUTOTRADING_DISABLED`

Meaning:
- The MT5 terminal disabled AutoTrading for external requests.

Expected evidence:
- `errorCode = TERMINAL_AUTOTRADING_DISABLED`
- readiness shows `terminal.tradeAllowed = false`
- MT5 comment or retcode includes `10027`

Operator action:
- Re-enable `AutoTrading` in the dedicated MT5 execution terminal.
- Re-run `/bridge/account/readiness`.

### `tradeapi_disabled=true` / `TERMINAL_API_DISABLED`

Meaning:
- The terminal is reachable, but MT5 blocks external Python/API trading.

Expected evidence:
- readiness shows `terminal.tradeApiDisabled = true`
- `errorCode = TERMINAL_API_DISABLED`

Operator action:
- Update MT5 terminal settings to allow external algorithmic/Python trading.
- Restart the execution bridge if terminal settings were changed while the bridge was already running.

### `10030` / `INVALID_FILL_MODE`

Meaning:
- The broker rejected the request shape for the symbol/filling-policy combination.

Expected evidence:
- `errorCode = INVALID_FILL_MODE`
- broker payload includes preflight or order-send retcode `10030`
- latest payload shows the attempted `type_filling`

Operator action:
- Re-check symbol execution mode and supported filling policy.
- Prefer the bridge-generated filling mode instead of forcing a raw MT5 `filling_mode` value.
- Re-test on the target symbol, especially `BTCUSDc` or other broker-specific CFDs/crypto symbols.

### `ORDER_PREFLIGHT_FAILED`

Meaning:
- `order_check()` rejected the request before `order_send()`.

Expected evidence:
- `errorCode = ORDER_PREFLIGHT_FAILED`
- payload contains `preflight.retcode`, `preflight.comment`, and the request snapshot

Operator action:
- Inspect the payload request fields for invalid price, SL/TP, pending-order type, or symbol mismatch.
- Fix the request shape before retrying.

### `BRIDGE_TRANSPORT_FAILURE`

Meaning:
- The bridge was reachable, but MT5 rejected a local call path before a broker-native result was returned.

Expected evidence:
- `errorCode = BRIDGE_TRANSPORT_FAILURE`
- payload may contain a Python/MT5 local error rather than a broker retcode

Operator action:
- Check `logs/mt5-service-current.log`
- Confirm the dedicated execution terminal is still logged in and responsive.

## Manual Smoke Checklist

- `trade_allowed=false` blocks command submission before `order_send()`
- `tradeapi_disabled=true` shows terminal API disablement in readiness
- invalid fill mode on `BTCUSDc` surfaces `INVALID_FILL_MODE` with retcode `10030`
- successful preflight path records both `preflight` and `orderSend` payloads
