# API Security Hardening Review

Date: 2026-03-11

## Scope

This document records the API hardening pass applied after the March 11, 2026 backend/API review. The goal was to close the concrete issues found during review and leave a durable audit trail for future re-review.

## What Changed

### 1. Auth hardening

- Removed reliance on a known default JWT secret.
- Stopped auto-creating the first admin user with a default password.
- Added a safer bootstrap requirement: an empty user store now requires `AUTH_BOOTSTRAP_ADMIN_PASSWORD` to be set explicitly before first sign-in.
- Added stricter auth route rate limits for `/api/auth/login` and `/api/auth/refresh`.
- Stopped returning the access token in login, refresh, and session JSON responses.
- Normalized access/refresh cookie handling so clear operations match the cookie configuration.

### 2. Client auth flow migration

- Migrated the web client away from JS-managed bearer tokens for normal session use.
- Session bootstrap now relies on secure cookies instead of localStorage access tokens.
- API fetch interception now defaults API requests to `credentials: include`.
- Existing localStorage token cleanup is still performed to flush old browser state after the migration.

### 3. Socket authentication hardening

- Removed the development bypass that previously allowed Socket.IO connections with no token.
- Removed acceptance of the legacy magic token `legacy-session-token`.
- Added cookie-based Socket.IO auth support so realtime flows continue working without exposing JWTs to browser JavaScript.

### 4. Outbound webhook restrictions

- Added outbound webhook host allowlisting via `TRADING_WEBHOOK_ALLOWED_HOSTS`.
- Rejected webhook URLs that use:
  - non-HTTPS schemes
  - embedded credentials
  - localhost
  - private/loopback IP literals
- Re-validated stored endpoint URLs at delivery time, not only at creation time.

### 5. Abuse resistance and query bounds

- Added upper bounds for OHLCV query limits.
- Added batch size limits for ingestion endpoints.
- Added bounded limits for:
  - indicator event pagination
  - trading command history
  - trading sync history
  - trading deal history
- Added a maximum expansion cap for signal preview batch planning.

### 6. Error exposure reduction

- Replaced several generic 500 responses that previously returned raw internal error messages.
- Added server-side logging for unexpected failures so diagnostics remain available without exposing internals to clients.

## Runtime Config Changes

The local `.env` file was updated to add:

- `JWT_SECRET`
- `AUTH_BOOTSTRAP_ADMIN_PASSWORD`
- `TRADING_WEBHOOK_ALLOWED_HOSTS`

Notes:

- `TRADING_WEBHOOK_ALLOWED_HOSTS` was intentionally left blank by default so outbound webhook creation fails closed until an explicit allowlist is chosen.
- The actual secret values are stored in `.env` and are intentionally not duplicated in this document.

## Verification Performed

### Automated tests

Executed successfully:

- backend trading service and route tests
- trading operations route tests
- trading export route tests
- webhook delivery service tests

### Type checking

Executed successfully:

- backend TypeScript compile: `tsc --noEmit`
- web TypeScript compile: `tsc -p web/tsconfig.json --noEmit`

### Environment check

- Prisma database connection verified successfully after the changes.

## Files Touched

Primary code changes were applied in:

- `src/services/auth/config.ts`
- `src/services/auth/AuthUserService.ts`
- `src/middleware/auth.ts`
- `src/routes/registerAuthRoutes.ts`
- `src/services/SocketService.ts`
- `src/services/trading/TradingWebhookDeliveryService.ts`
- `src/routes/registerTradingExportRoutes.ts`
- `src/server.ts`
- `src/services/trading/TradingExecutionService.ts`
- `src/services/trading/TradingWorkspaceService.ts`
- `src/services/signals/SignalBatchPlannerService.ts`
- `src/routes/registerIndicatorRoutes.ts`
- `src/routes/registerSignalRoutes.ts`
- `src/routes/registerEngineRoutes.ts`
- `src/routes/registerTradingAccountRoutes.ts`
- `src/routes/registerTradingWorkspaceRoutes.ts`
- `web/src/lib/authApi.ts`
- `web/src/lib/authFetch.ts`
- `web/src/store/useAuthStore.ts`
- `web/src/components/Providers.tsx`
- `web/src/components/auth/LoginWorkspace.tsx`
- `web/src/components/SocketProvider.tsx`
- `web/src/hooks/useSocket.ts`
- `web/src/components/layout/Watchlist.tsx`
- `web/src/lib/tradingview/datafeed.ts`
- `.env`

## Follow-up Required Before Enabling Outbound Webhooks

Set `TRADING_WEBHOOK_ALLOWED_HOSTS` to an explicit allowlist such as:

- exact hosts: `ops.example.com,webhooks.example.net`
- wildcard suffixes: `*.example.com`

Do not leave it empty if trading webhooks are intended to be used.
