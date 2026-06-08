# Live Smoke Report - 2026-03-11

## Scope

Live smoke was executed on March 11, 2026 against:

- Current backend code from this repo, started temporarily on `http://127.0.0.1:3002`
- Redis at `redis://localhost:6379`
- MT5 bridge at `http://127.0.0.1:8765/bridge`
- Existing trading account `cmmlw5lyp0001hqnss3lbontx` (`MT5 HVV Cen 01`)

The existing long-running backend on port `3001` was not used for the final verdict because runtime logs showed it was still serving an older process image that allowed the deprecated Socket.IO development bypass. A temporary instance on port `3002` was used to validate the current code safely against the same DB, Redis, and MT5 bridge.

## Runtime Checks Performed

1. `GET /health`
2. `GET /bridge/health`
3. `POST /api/auth/login`
4. Verified refresh token persistence in Redis
5. `POST /api/auth/refresh`
6. Verified refresh-token rotation and old-token invalidation in Redis
7. Socket.IO auth smoke:
   - no token -> rejected
   - cookie token -> connected
8. `GET /api/trading/accounts`
9. `GET /api/trading/operations/account-readiness?accountId=...`
10. `GET /api/trading/accounts/:id/workspace`
11. `GET /api/trading/accounts/:id/summary`
12. `GET /api/trading/accounts/:id/positions`
13. `GET /api/trading/accounts/:id/orders`
14. `GET /api/trading/accounts/:id/deals?limit=5`
15. `GET /api/trading/accounts/:id/sync-runs?limit=3`
16. `GET /api/trading/accounts/:id/commands?limit=5`
17. `POST /api/trading/accounts/:id/sync`
18. `POST /api/auth/logout`

## Result

Overall result: pass.

Observed values from the successful rerun:

- Backend health: `ok`
- Bridge health: `ok`
- Auth login: success, cookies issued
- Redis refresh-token storage: working
- Redis refresh-token rotation: working
- Socket auth:
  - unauthenticated connection rejected
  - authenticated cookie-based connection accepted
- Trading account readiness for explicit admin-selected account: `ready`
- Workspace sync health: `healthy`
- Base currency: `USC`
- Force sync result: `202 Accepted`
- Latest sync run after smoke: `SUCCEEDED`

## Code Change Triggered By Smoke

The smoke surfaced a real bug in `GET /api/trading/operations/account-readiness`:

- Before the fix, an admin querying another user's explicit `accountId` still received readiness for the admin's own active account context.
- The route now uses an actor-aware readiness lookup so admins can inspect the requested account correctly.

Files changed for this fix:

- `src/services/trading/TradingAccountService.ts`
- `src/routes/registerTradingOperationsRoutes.ts`
- `src/services/trading/TradingAccountService.test.ts`

Verification after the fix:

- Trading backend tests: `72` passed
- Backend TypeScript check: passed
- Live smoke rerun: passed

## Residual Risks

1. Legacy admin credential still valid in the database.
   - `admin@tvgit.local` still accepts the historical default password from the pre-hardening state.
   - This is now a data-level security issue, not a code-path fallback.
   - Rotating or disabling that account should be treated as an operational change because it affects real login access.

2. Port `3001` currently appears to be held by an older backend process outside this tool session.
   - Its logs showed the deprecated development Socket.IO bypass before the temporary `3002` smoke instance was used.
   - The app should be restarted from the current code before treating port `3001` as the production-like runtime baseline.

## Recommended Next Actions

- Restart the persistent backend process on port `3001` from the current code.
- Rotate the password for `admin@tvgit.local` or deactivate that legacy bootstrap account.
- Re-run a short smoke on the persistent `3001` process after restart.
