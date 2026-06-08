# API Routes Reference (Disaster Recovery)

This document covers every HTTP endpoint in the trading platform.
A developer should be able to reimplement the full API surface from this specification alone.

---

## Table of Contents

1. [Global Middleware Stack](#1-global-middleware-stack)
2. [Authentication and Authorization Model](#2-authentication-and-authorization-model)
3. [Error Response Format](#3-error-response-format)
4. [Rate Limiting](#4-rate-limiting)
5. [Request Body Limits](#5-request-body-limits)
6. [Pagination Patterns](#6-pagination-patterns)
7. [Health Check](#7-health-check)
8. [Auth Routes](#8-auth-routes)
9. [Public Routes](#9-public-routes)
10. [Market Data Routes](#10-market-data-routes)
11. [Signal Routes](#11-signal-routes)
12. [Indicator Routes](#12-indicator-routes)
13. [Engine (Analytics) Routes](#13-engine-analytics-routes)
14. [Monitoring Routes](#14-monitoring-routes)
15. [Trading Account Routes](#15-trading-account-routes)
16. [Trading Workspace Routes](#16-trading-workspace-routes)
17. [Trading Operations Routes](#17-trading-operations-routes)
18. [Trading Export Routes](#18-trading-export-routes)
19. [Trading External Action Routes](#19-trading-external-action-routes)
20. [Trading Command Preflight](#20-trading-command-preflight)
21. [Trading Automation Preflight](#21-trading-automation-preflight)

---

## 1. Global Middleware Stack

Middleware is applied in this exact order in `setupMiddlewares()`:

1. **`trust proxy`** -- Configured via `TRUST_PROXY` env var. Required for correct IP detection behind reverse proxies.
2. **`helmet()`** -- Security headers (CSP, HSTS, X-Frame-Options, etc.).
3. **`cors(getCorsOptions())`** -- CORS based on `CORS_ORIGINS` env var.
4. **Dynamic JSON body parser** -- Selects body size limit based on request path:
   - `/api/ohlcv/batch` -> 50 MB
   - `/api/ohlcv/:symbol` -> 10 MB
   - All other paths -> 1 MB
5. **`express-rate-limit`** on `/api/` -- 200 requests per minute per IP, returns `429` with `{ error: "Too many requests, please try again later." }`.
6. **`express.static`** -- Serves `public/` directory.

Global error handler catches `entity.too.large` (413) errors and returns:

```json
{
  "success": false,
  "error": {
    "code": "REQUEST_TOO_LARGE",
    "message": "JSON request body exceeds the <limit> limit for this endpoint.",
    "domain": "api.request"
  }
}
```

---

## 2. Authentication and Authorization Model

### Token Types

| Token Type | How Extracted | Purpose |
|---|---|---|
| JWT (HS256) | `Authorization: Bearer <jwt>` or cookie `tvgit.accessToken` | User session authentication |
| Ingestion Token | `Authorization: Bearer <INGESTION_TOKEN>` | Machine-to-machine data ingestion |
| Legacy Session Token | `Authorization: Bearer <non-jwt>` | Brownfield compatibility (pre-auth) |

### Middleware Functions

| Middleware | What It Does |
|---|---|
| `requireAppAuthentication` | Requires valid JWT. Rejects non-JWT tokens. Populates `res.locals.auth`. |
| `hydrateAuthorizedUser(prisma)` | Loads user from DB using JWT `sub` claim. Populates `res.locals.authorizedUser` with `{ id, email, username, displayName, role, isActive, modules, firstAllowedPath }`. Rejects disabled users (403). |
| `requireAdminAccess(prisma)` | Requires `role === 'ADMIN'` after hydration. |
| `requireModuleAccess(prisma, modules)` | Requires user has at least one of the listed module permissions. Admins always pass. Modules: `chart`, `signal`, `report`, `trading`, `engine`. |
| `requireAppAuthenticationOrIngestion(env)` | Passes if request carries either a valid JWT or the `INGESTION_TOKEN`. |
| `hydrateAuthorizedUserUnlessIngestion(prisma)` | Hydrates user only for JWT requests; skips for ingestion token requests. |
| `requireAuthenticatedRequest` | Accepts JWT or legacy session tokens. Less strict than `requireAppAuthentication`. |

### Route Guard Presets (defined in `setupRoutes()`)

| Preset | Middleware Chain |
|---|---|
| `requireWorkspaceAuth()` | `requireAppAuthentication` + `hydrateAuthorizedUser` |
| `requireWorkspaceOrIngestionAuth()` | `requireAppAuthenticationOrIngestion` + `hydrateAuthorizedUserUnlessIngestion` |
| `requireAdmin()` | `requireWorkspaceAuth()` + `requireAdminAccess` |
| `requireModule(...modules)` | `requireWorkspaceAuth()` + `requireModuleAccess(modules)` |

### Feature Flag Middleware (Trading)

| Middleware | Gate |
|---|---|
| `requireTradingCapability('read')` | Env `FEATURE_TRADING_READ=true` |
| `requireTradingCapability('write')` | Env `FEATURE_TRADING_WRITE=true` (paper accounts bypass) |
| `requireTradingCapability('automation')` | Env `FEATURE_TRADING_AUTO=true` (paper accounts bypass) |
| `requireTradingCapabilityForAccount(prisma, tier)` | Same as above but also loads the account to check `accountMode`. Paper accounts bypass write/automation flags. |

Feature flag denial returns:

```json
{
  "success": false,
  "error": {
    "code": "TRADING_FEATURE_DISABLED",
    "message": "<reason>",
    "domain": "trading.<tier-domain>",
    "meta": {
      "tier": "write",
      "blockedBy": ["trading_write_enabled"],
      "flags": { "trading_read_enabled": true, "trading_write_enabled": false, "trading_automation_enabled": false },
      "evaluatedAt": "<ISO timestamp>"
    }
  }
}
```

### Trading Route Mounting

All routes under `/api/trading/*` are protected by `requireModule('trading')` applied via `app.use('/api/trading', ...requireModule('trading'))`. Individual endpoints add additional feature-flag middleware.

---

## 3. Error Response Format

The platform uses two error envelope styles:

### Style A -- Domain Errors (Auth, Trading, Operations)

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message.",
    "domain": "error.domain",
    "meta": {}
  }
}
```

### Style B -- Simple Errors (Engine, Signals, Indicators)

```json
{
  "error": "Human-readable error message."
}
```

Some Signal/Indicator routes also return:

```json
{
  "error": "Validation message.",
  "code": "COMPOSED_SIGNAL_VALIDATION_ERROR",
  "issues": ["issue 1", "issue 2"]
}
```

---

## 4. Rate Limiting

| Scope | Window | Max Requests | Response |
|---|---|---|---|
| Global `/api/` | 1 minute | 200 | `{ error: "Too many requests, please try again later." }` |
| `POST /api/auth/login` | 15 minutes | 10 | `{ success: false, error: { code: "AUTH_RATE_LIMITED", ... } }` |
| `POST /api/auth/refresh` | 15 minutes | 30 | `{ success: false, error: { code: "AUTH_RATE_LIMITED", ... } }` |
| `/api/public/*` | 1 minute | 30 | `{ success: false, error: { code: "RATE_LIMITED", ... } }` |

All rate limiters use `standardHeaders: true`, `legacyHeaders: false`.

---

## 5. Request Body Limits

| Path Pattern | Limit |
|---|---|
| `POST /api/ohlcv/batch` | 50 MB |
| `POST /api/ohlcv/:symbol` | 10 MB |
| All other POST/PATCH | 1 MB |

---

## 6. Pagination Patterns

### Engine Trade History / Leaderboard

Query params `page` (1-indexed, positive int), `pageSize` (positive int), `sort`, `order` (`asc`/`desc`).

Response includes:

```json
{
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalRows": 100,
    "totalPages": 5
  }
}
```

### Indicator Events

Uses `limit` (default 200, max 500) + `offset` (default 0).

### Trading Lists

Uses `limit` (positive integer, default varies by endpoint).

---

## 7. Health Check

### `GET /health`

- **Auth**: None (public)
- **Response**: `200 { "status": "ok" }`

---

## 8. Auth Routes

Source: `registerAuthRoutes.ts`

### `POST /api/auth/login`

- **Auth**: None (public)
- **Rate limit**: 10 per 15 minutes per IP
- **Body**:
  ```json
  {
    "identifier": "email-or-username",
    "password": "plaintext-password"
  }
  ```
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "session": {
        "user": { "id", "email", "username", "displayName", "role", "isActive", "modules", "firstAllowedPath" },
        "expiresAt": "<ISO>"
      }
    }
  }
  ```
- **Side effects**: Sets `tvgit.accessToken` (httpOnly, lax, path=/) and `tvgit.refreshToken` (httpOnly, strict, path=/) cookies.
- **Errors**: `400 AUTH_LOGIN_INVALID` (missing fields), `401 AUTH_LOGIN_FAILED` (bad credentials)

### `POST /api/auth/refresh`

- **Auth**: Requires `tvgit.refreshToken` cookie
- **Rate limit**: 30 per 15 minutes per IP
- **Body**: None
- **Response** `200`: Same session envelope as login
- **Side effects**: Rotates both cookies. On failure, clears both cookies.
- **Errors**: `401 AUTH_REFRESH_INVALID` (missing/expired refresh token)

### `POST /api/auth/logout`

- **Auth**: None (reads refresh cookie if present)
- **Body**: None
- **Response** `200`:
  ```json
  { "success": true, "data": { "loggedOut": true } }
  ```
- **Side effects**: Deletes refresh token from Redis, clears both cookies.

### `GET /api/auth/session`

- **Auth**: `requireAppAuthentication` + `hydrateAuthorizedUser`
- **Response** `200`: Same session envelope as login
- **Side effects**: Refreshes `tvgit.accessToken` cookie
- **Headers**: `Cache-Control: no-store`
- **Errors**: `401 AUTH_REQUIRED`

### `GET /api/auth/users`

- **Auth**: `requireAppAuthentication` + `hydrateAuthorizedUser` + `requireAdminAccess`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "users": [{ "id", "email", "username", "displayName", "role", "isActive", "modules", "createdAt", "updatedAt" }]
    }
  }
  ```

### `POST /api/auth/users`

- **Auth**: Admin only (same chain as GET users)
- **Body**:
  ```json
  {
    "email": "new@example.com",
    "username": "newuser",
    "displayName": "New User",
    "password": "plaintext",
    "role": "USER",
    "isActive": true,
    "modules": ["chart", "signal", "trading"]
  }
  ```
  - `role`: `"ADMIN"` or `"USER"` (default USER)
  - `modules`: Array of `"chart" | "signal" | "report" | "trading" | "engine"`
- **Response** `201`:
  ```json
  { "success": true, "data": { "user": { ... } } }
  ```

### `PATCH /api/auth/users/:id`

- **Auth**: Admin only
- **Path params**: `id` -- User UUID
- **Body**: Partial update. Any subset of: `email`, `username`, `displayName`, `password`, `role`, `isActive`, `modules`.
  - `displayName` accepts `null` to clear
  - `modules` replaces the full set
- **Response** `200`:
  ```json
  { "success": true, "data": { "user": { ... } } }
  ```

---

## 9. Public Routes

Source: `registerPublicRoutes.ts`

No authentication required. Rate limited to 30/min. Response cached for 5 minutes (`Cache-Control: public, max-age=300`).

### `GET /api/public/trade-history`

- **Auth**: None
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "summary": {
        "totalRecords": 10,
        "wins": 7,
        "losses": 2,
        "breakEven": 1,
        "activeTrades": 0
      },
      "records": [{
        "entryTime": "<ISO>",
        "exitTime": "<ISO>",
        "symbol": "XAUUSD",
        "side": "LONG",
        "entryPrice": 3230,
        "stopLoss": 3220,
        "exitPrice": 3245,
        "rMultiple": 1.5,
        "pnlUsd": 450,
        "result": "WIN"
      }],
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Returns up to 10 most recent trade history records from the live audit trail.

### `GET /api/public/reports`

- **Auth**: None
- **Query params**:
  - `side` -- `ALL`, `LONG`, `SHORT`
  - `status` -- `ALL`, `ACTIVE`, `CLOSED`
  - `outcome` -- `ALL`, `WIN`, `LOSS`, `BE`
  - `page` -- positive integer
  - `pageSize` -- positive integer
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "overview": {
        "winRate", "profitFactor", "expectancy", "netR", "totalTrades",
        "closedTrades", "wins", "losses", "maxConsecutiveLoss", "maxDrawdownPct"
      },
      "analytics": { ... },
      "trades": {
        "summary": { ... },
        "rows": [{ "entryTime", "exitTime", "symbol", "side", "session", "entryPrice", "stopLoss", "exitPrice", "pnlPct", "rMultiple", "durationMs", "result" }],
        "pagination": { "page", "pageSize", "totalRows", "totalPages" }
      },
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Prefers backtests tagged `[★ GO-LIVE]` in notes. Falls back to the latest completed run. Returns null overview if no completed runs exist.

---

## 10. Market Data Routes

Defined inline in `server.ts` (not in a separate route file).

### `GET /api/symbols`

- **Auth**: `requireWorkspaceAuth()` (JWT + user hydration)
- **Permissions**: Any authenticated user
- **Response** `200`: `["BTCUSD", "XAUUSD", ...]` -- sorted unique normalized symbols from the candle table.

### `GET /api/ohlcv/:symbol`

- **Auth**: `requireWorkspaceAuth()`
- **Path params**: `symbol` -- market symbol (e.g., `XAUUSD`)
- **Query params**:
  - `timeframe` -- default `1m`, normalized
  - `limit` -- positive integer, default 500, max 5000
  - `startTime` -- numeric timestamp (ms since epoch)
  - `endTime` -- numeric timestamp (ms since epoch)
- **Response** `200`:
  ```json
  [
    { "time": "<Date>", "open": 3230.5, "high": 3235, "low": 3228, "close": 3234, "volume": 120, "symbol": "XAUUSD", "timeframe": "1h" }
  ]
  ```
- **Business logic**: Deduplicates across symbol aliases (e.g., `XAUUSD` and `GOLD`). Returns oldest-first order. Handles timeframe aliases.

### `GET /api/sync-status/:symbol`

- **Auth**: `requireWorkspaceOrIngestionAuth()` (JWT or ingestion token)
- **Path params**: `symbol`
- **Query params**: `timeframe` (default `1m`)
- **Response** `200`:
  ```json
  {
    "symbol": "XAUUSD",
    "timeframe": "1m",
    "oldest": "<Date>",
    "latest": "<Date>",
    "totalCandles": 12345
  }
  ```

### `GET /api/market-summary`

- **Auth**: `requireWorkspaceAuth()`
- **Response** `200`:
  ```json
  [
    {
      "symbol": "XAUUSD",
      "lastPrice": 3234.5,
      "openPrice": 3230,
      "highPrice": 3240,
      "lowPrice": 3225,
      "volume": 5000,
      "changePercent": 0.14,
      "sparkline": [3220, 3225, ...]
    }
  ]
  ```
- **Business logic**: Gets latest 1d candle per symbol. Sparkline is last 20 daily closes.

### `POST /api/ohlcv/batch`

- **Auth**: Ingestion token (`Authorization: Bearer <INGESTION_TOKEN>`)
- **Body limit**: 50 MB
- **Body**:
  ```json
  {
    "batches": [
      {
        "symbol": "XAUUSD",
        "exchange": "MT5",
        "timeframe": "1m",
        "candles": [
          { "time": "2026-01-01T00:00:00Z", "open": 3230, "high": 3235, "low": 3228, "close": 3234, "volume": 100 }
        ]
      }
    ]
  }
  ```
  - Max 25 batches per request
  - Max 5000 candles per batch
- **Candle validation**: Requires valid time, numeric OHLC where `max(open,close) <= high`, `min(open,close) >= low`, `high >= low`, non-negative volume.
- **Response** `200`:
  ```json
  {
    "ok": true,
    "results": [
      { "symbol": "XAUUSD", "timeframe": "1m", "inserted": 100, "rejected": 2 }
    ]
  }
  ```
- **Side effects**: Upserts candles to TimescaleDB, publishes last candle to Redis `live:SYMBOL:TIMEFRAME`, triggers indicator runner for matching active instances.

### `POST /api/ohlcv/:symbol`

- **Auth**: Ingestion token
- **Body limit**: 10 MB
- **Path params**: `symbol`
- **Body**:
  ```json
  {
    "exchange": "MT5",
    "timeframe": "1m",
    "candles": [{ "time", "open", "high", "low", "close", "volume" }]
  }
  ```
  - Max 5000 candles per request
- **Response** `200`:
  ```json
  { "ok": true, "inserted": 100, "rejected": 0 }
  ```
- **Side effects**: Same as batch ingestion.

---

## 11. Signal Routes

Source: `registerSignalRoutes.ts`

### `GET /api/signals/definitions`

- **Auth**: `requireModule('signal')`
- **Response** `200`: `{ "data": [{ signal definition objects }] }`
- **Business logic**: Lists all registered signal definitions (built-in + composed).

### `POST /api/signals/preview`

- **Auth**: `requireModule('signal')`
- **Body**:
  ```json
  {
    "signalCode": "songTrap",
    "signalVersion": 3,
    "symbol": "XAUUSD",
    "timeframe": "H1",
    "dateRange": { "from": "2025-01-01", "to": "2025-12-31" },
    "parameters": { "lookback": 20 },
    "executionConfig": {},
    "initialEquity": 10000,
    "riskPercent": 1.5
  }
  ```
- **Response** `200`:
  ```json
  {
    "data": {
      "signalCode": "SONGTRAP",
      "signalVersion": 3,
      "symbol": "XAUUSD",
      "timeframe": "H1",
      "dateRange": { "from": "<ISO>", "to": "<ISO>" },
      "counts": { "barsProcessed", "signals", "events", "traces", "results" },
      "signals": [{ "symbol", "timeframe", "side", "entryTime", "entryPrice", "stopLoss", ... }],
      "events": [{ "signalExternalKey", "eventType", "candleTime", "price", "label", "metaJson" }],
      "traces": [{ ... }],
      "results": [{ "signalExternalKey", "resultSide", "session", "win", "isOpen", "rMultiple", "pnlUsd", ... }]
    }
  }
  ```
- **Business logic**: Runs signal definition against historical candles in-memory without persisting.

### `POST /api/signals/preview-batch`

- **Auth**: `requireModule('signal')`
- **Body**:
  ```json
  {
    "requests": [{ ... }],
    "matrix": {
      "assets": [{ "symbol", "timeframe" }],
      "definitions": [{ "signalCode", "signalVersion", "dateRange", "parameters" }]
    },
    "maxConcurrency": 5
  }
  ```
  Either `requests` (explicit list) or `matrix` (cross-product).
- **Response** `200`: `{ "data": { ... batch results } }`

### `POST /api/signals/backtests`

- **Auth**: `requireModule('signal')`
- **Body**:
  ```json
  {
    "signalCode": "songTrap",
    "signalVersion": 3,
    "symbol": "XAUUSD",
    "timeframe": "H1",
    "dateRange": { "from": "2025-01-01", "to": "2025-12-31" },
    "parameters": { "lookback": 20 },
    "executionConfig": {},
    "initialEquity": 10000,
    "riskPercent": 1.5,
    "notes": "Test run",
    "executeNow": true,
    "async": true
  }
  ```
  - `executeNow: true` + `async: true` -> queues to BullMQ worker, returns `202`
  - `executeNow: true` + `async: false` -> executes synchronously, returns `201`
  - `executeNow: false` -> creates run record only, returns `201`
- **Response** `201` / `202`:
  ```json
  { "data": { "created": { "backtestRunId": "..." }, "execution": { ... }, "queued": false } }
  ```

### `POST /api/signals/backtests/batch`

- **Auth**: `requireModule('signal')`
- **Body**:
  ```json
  {
    "runs": [{ same fields as single backtest minus executeNow/async }],
    "batchLabel": "XAU Optimization Round 1"
  }
  ```
  Requires async backtest publisher to be configured (returns `503` otherwise).
- **Response** `202`:
  ```json
  {
    "data": {
      "batchId": "<UUID>",
      "batchLabel": "...",
      "runs": [{ "backtestRunId": "...", "status": "QUEUED" }]
    }
  }
  ```

### `POST /api/signals/backtests/:id/execute`

- **Auth**: `requireModule('signal')`
- **Path params**: `id` -- backtest run ID
- **Response** `200`: `{ "data": { execution result } }`
- **Errors**: `404` (not found), `400` (already executed or invalid state)

### `GET /api/signals/backtests`

- **Auth**: `requireModule('signal', 'report')`
- **Query params**: `signalCode`, `signalVersion`, `symbol`, `timeframe`, `status` (BacktestRunStatus enum), `notes`
- **Response** `200`: `{ "data": [backtest run summaries] }`

### `GET /api/signals/backtests/:id`

- **Auth**: `requireModule('signal', 'report')`
- **Path params**: `id`
- **Response** `200`: `{ "data": { backtest run detail } }`
- **Errors**: `404`

### `DELETE /api/signals/backtests/:id`

- **Auth**: `requireModule('signal')`
- **Path params**: `id`
- **Response** `200`: `{ "data": { deleted details } }`
- **Errors**: `404` (not found), `409` (still active, or linked to indicator)

### `GET /api/signals/backtests/:id/events`

- **Auth**: `requireModule('signal', 'report')`
- **Path params**: `id`
- **Query params**: `signalId`, `eventType` (SignalEventType enum), `from`, `to`
- **Response** `200`: `{ "data": [signal events] }`

### `GET /api/signals/backtests/:id/trace`

- **Auth**: `requireModule('signal', 'report')`
- **Path params**: `id`
- **Query params**: `signalId`, `signalEventId`, `eventType`
- **Response** `200`: `{ "data": [trace records] }`

### `GET /api/signals/backtests/:id/trades/:rowId/replay`

- **Auth**: `requireModule('signal', 'report')`
- **Path params**: `id` (backtest run), `rowId` (format: `signalId:exitRuleId`)
- **Response** `200`: `{ "data": { trade replay } }`
- **Errors**: `404`, `400` (invalid rowId format)

### `POST /api/signals/optimization-jobs`

- **Auth**: `requireModule('signal')`
- **Body**:
  ```json
  {
    "signalCode": "songTrap",
    "signalVersion": 3,
    "symbol": "XAUUSD",
    "timeframe": "H1",
    "dateRange": { "from": "2025-01-01", "to": "2025-12-31" },
    "parameterSpace": { "lookback": { "min": 10, "max": 30, "step": 5 } },
    "executionConfig": {},
    "rankingConfig": {}
  }
  ```
- **Response** `201`: `{ "data": { optimization job } }`

### `GET /api/signals/optimization-jobs`

- **Auth**: `requireModule('signal')`
- **Query params**: `signalCode`, `signalVersion`, `status` (OptimizationJobStatus enum)
- **Response** `200`: `{ "data": [optimization jobs] }`

### `GET /api/signals/optimization-jobs/:id`

- **Auth**: `requireModule('signal')`
- **Path params**: `id`
- **Response** `200`: `{ "data": { optimization job detail } }`
- **Errors**: `404`

---

## 12. Indicator Routes

Source: `registerIndicatorRoutes.ts`

### Tech Indicator Catalog (Public for Signal/Engine Users)

#### `GET /api/tech-indicators`

- **Auth**: `requireModule('signal', 'engine')`
- **Response** `200`: Array of indicator block definitions for the Signal Composer UI.
  ```json
  [{ "id": "RSI", "name": "Relative Strength Index", ... }]
  ```

### Admin Indicator Catalog Management

All admin catalog endpoints require `requireAdmin()` (JWT + user hydration + ADMIN role).

#### `GET /api/admin/indicator-catalog`

- **Response** `200`: Array of all catalog items including draft/published/retired.
  ```json
  [{ "id": "RSI", "catalogStatus": "PUBLISHED", ... }]
  ```

#### `GET /api/admin/indicator-catalog/:id`

- **Path params**: `id` -- catalog item ID
- **Response** `200`: Single catalog item detail.

#### `GET /api/admin/indicator-catalog/:id/dependencies`

- **Path params**: `id`
- **Response** `200`: Dependency graph for the catalog item.

#### `POST /api/admin/indicator-catalog`

- **Body**: Catalog item draft definition (schema varies by indicator type)
- **Response** `201`: Created catalog item.
- **Business logic**: Creates a new draft catalog entry. The actor's user ID is recorded.
- **Errors**: `409 INDICATOR_CATALOG_PUBLISH_BLOCKED` (with `reasons` array)

#### `PATCH /api/admin/indicator-catalog/:id`

- **Path params**: `id`
- **Body**: Partial update to catalog item
- **Response** `200`: Updated catalog item.

#### `POST /api/admin/indicator-catalog/:id/publish`

- **Path params**: `id`
- **Response** `200`: Published catalog item.
- **Business logic**: Transitions draft to published state.

#### `POST /api/admin/indicator-catalog/:id/retire`

- **Path params**: `id`
- **Response** `200`: Retired catalog item.

#### `DELETE /api/admin/indicator-catalog/:id`

- **Path params**: `id`
- **Response** `200`: Deleted catalog item.
- **Business logic**: Only drafts can be deleted; published items must be retired.

### Composed Signals CRUD

All composed signal endpoints require `requireModule('signal')`.

#### `GET /api/signals/composed`

- **Response** `200`: Array of composed signal definitions.

#### `GET /api/signals/composed/:id`

- **Path params**: `id`
- **Response** `200`: Single composed signal.
- **Errors**: `404`

#### `POST /api/signals/composed`

- **Body**:
  ```json
  {
    "name": "My Signal",
    "description": "Description",
    "category": "Breakout",
    "composedBlocks": [{ block definitions }],
    "createdBy": "HVV"
  }
  ```
- **Response** `201`: Created composed signal.
- **Errors**: `400` with `code: "COMPOSED_SIGNAL_VALIDATION_ERROR"` and `issues[]`

#### `PATCH /api/signals/composed/:id`

- **Path params**: `id`
- **Body**: Partial update (name, description, category, composedBlocks)
- **Response** `200`: Updated composed signal.
- **Errors**: `400` (validation), `404` (not found), `409` (retired signal cannot be updated)

#### `DELETE /api/signals/composed/:id`

- **Path params**: `id`
- **Response** `200`: Retired composed signal (soft delete for traceability).
- **Errors**: `404`

### Indicator Instances

#### `GET /api/indicators/instances`

- **Auth**: `requireModule('signal', 'engine')`
- **Query params**: `symbol`, `timeframe`, `status`
- **Response** `200`: Array of indicator instances.

#### `GET /api/indicators/instances/:id`

- **Auth**: `requireModule('signal', 'engine')`
- **Path params**: `id`
- **Response** `200`: Instance detail.
- **Errors**: `404`

#### `POST /api/indicators/instances/promote`

- **Auth**: `requireModule('signal', 'engine')`
- **Body**:
  ```json
  { "backtestRunId": "run-1", "name": "Live Song Trap" }
  ```
- **Response** `200`: Created indicator instance.
- **Business logic**: Promotes a completed backtest into a live indicator instance.

#### `POST /api/indicators/instances/:id/status`

- **Auth**: `requireModule('signal', 'engine')`
- **Path params**: `id`
- **Body**: `{ "status": "ACTIVE" | "PAUSED" | "ARCHIVED" }`
- **Response** `200`: Updated instance.

#### `PATCH /api/indicators/instances/:id`

- **Auth**: `requireModule('signal', 'engine')`
- **Path params**: `id`
- **Body**: Partial configuration update.
- **Response** `200`: Updated instance.

### Indicator Events

#### `GET /api/indicators/instances/:id/events`

- **Auth**: `requireModule('signal', 'engine')`
- **Path params**: `id`
- **Query params**:
  - `limit` -- positive integer, default 200, max 500
  - `offset` -- non-negative integer, default 0
- **Response** `200`: Array of signal events, newest first.

#### `GET /api/indicators/instances/:id/events/:eventId/trace`

- **Auth**: `requireModule('signal', 'engine')`
- **Path params**: `id` (instance), `eventId`
- **Response** `200`: Logic trace for the event (state transitions, indicator values, thresholds).
- **Errors**: `404` (trace not found)

### Indicator Alerts

#### `POST /api/indicators/alerts`

- **Auth**: `requireModule('signal', 'engine')`
- **Body**: Alert configuration object.
- **Response** `200`: Created alert.

#### `GET /api/indicators/instances/:id/alerts`

- **Auth**: `requireModule('signal', 'engine')`
- **Path params**: `id`
- **Response** `200`: Array of alerts for this instance.

#### `PATCH /api/indicators/alerts/:id`

- **Auth**: `requireModule('signal', 'engine')`
- **Path params**: `id`
- **Body**: `{ "isActive": true | false }`
- **Response** `200`: Updated alert.

#### `DELETE /api/indicators/alerts/:id`

- **Auth**: `requireModule('signal', 'engine')`
- **Path params**: `id`
- **Response** `200`: `{ "success": true }`

---

## 13. Engine (Analytics) Routes

Source: `registerEngineRoutes.ts`

All engine routes are guarded by `requireModule('engine', 'signal', 'report')`.

### Common Filter Query Params (EngineFilters)

Used across multiple engine endpoints:

| Param | Type | Description |
|---|---|---|
| `backtestRunId` | string | Filter by backtest run |
| `signalId` | string | Filter by signal |
| `symbol` | string | Normalized market symbol |
| `timeframe` | string | Timeframe |
| `strategyId` | string | Filter by strategy |
| `side` | `LONG`, `SHORT`, `ALL` | Position side |
| `session` | `ASIAN`, `LONDON`, `NY` | Trading session |
| `exitRuleId` | string | Filter by exit rule |
| `from` | ISO date string | Start date |
| `to` | ISO date string | End date |

### `GET /api/engine/strategies`

- **Response** `200`: `{ "data": [{ strategy objects }] }`

### `GET /api/engine/exit-rules`

- **Response** `200`: `{ "data": [{ exit rule objects }] }`

### `GET /api/engine/runs`

- **Query params**: `includeId` (string, optional) -- ensures a specific run is included even if it would normally be filtered out (e.g., archived runs)
- **Response** `200`: `{ "data": [{ run objects }] }`

### `GET /api/engine/overview`

- **Query params**: EngineFilters
- **Response** `200`:
  ```json
  {
    "data": {
      "metrics": {
        "winRate", "profitFactor", "expectancy", "netR", "totalTrades",
        "closedTrades", "wins", "losses", "maxConsecutiveLoss", "maxDrawdownPct"
      }
    }
  }
  ```

### `GET /api/engine/backtest-leaderboard`

- **Query params**:
  - EngineFilters: `signalCode`, `symbol`, `timeframe`, `from`, `to`
  - `status` -- `ALL` or BacktestRunStatus (`COMPLETED`, `FAILED`, etc.)
  - `mode` -- `ALL_RUNS` or `BEST_PER_SIGNAL`
  - `minClosedTrades` -- non-negative integer (0 clears the filter)
  - `page`, `pageSize` -- pagination
  - `sort` -- `rank`, `createdAt`, `closedTrades`, `winRate`, `netR`, `profitFactor`, `expectancy`, `maxDrawdownPct`
  - `order` -- `asc` or `desc`
- **Response** `200`:
  ```json
  {
    "data": {
      "rows": [{ leaderboard entries }],
      "pagination": { "page", "pageSize", "totalRows", "totalPages" },
      "summary": { "totalRows", "totalSignals", "constructiveRows", "weakerRows", "suspiciousRows" },
      "mode": "ALL_RUNS",
      "sort": "rank",
      "order": "desc"
    }
  }
  ```
- **Errors**: `400` for invalid enum values

### `GET /api/engine/by-strategy`

- **Query params**: EngineFilters
- **Response** `200`: `{ "data": { strategy breakdown } }`

### `GET /api/engine/sessions`

- **Query params**: EngineFilters
- **Response** `200`: `{ "data": { session breakdown } }`

### `GET /api/engine/exit-comparison`

- **Query params**: EngineFilters
- **Response** `200`: `{ "data": { exit comparison } }`

### `GET /api/engine/annotations`

- **Query params**: EngineFilters
- **Response** `200`: `{ "data": { annotations } }`

### `GET /api/engine/trades`

- **Query params**: EngineFilters + `status` (`ALL`, `ACTIVE`, `CLOSED`) + `outcome` (`ALL`, `WIN`, `LOSS`, `BE`) + `page`, `pageSize`, `sort` (`entryTime`, `exitTime`, `pnlUsd`, `rMultiple`, `durationMs`), `order` (`asc`/`desc`)
- **Required**: `backtestRunId`
- **Response** `200`:
  ```json
  {
    "data": {
      "rows": [{ trade objects }],
      "summary": { ... },
      "pagination": { ... }
    }
  }
  ```
- **Errors**: `400` (missing backtestRunId)

### `GET /api/engine/equity-curve`

- **Required query**: `backtestRunId`
- **Response** `200`:
  ```json
  {
    "data": {
      "initialEquity": 10000,
      "finalEquity": 12500,
      "totalReturn": 25.0,
      "maxDrawdownPct": 8.5,
      "maxDrawdownUsd": 850,
      "tradesPerWeek": 2.5,
      "bestYear": { "year": 2025, "pnl": 3000 },
      "worstYear": { "year": 2024, "pnl": -500 },
      "yearlyBreakdown": [{ "year", "trades", "wins", "winRate", "pnlUsd" }],
      "points": [{ "time", "equity", "pnlUsd", "rMultiple", "r1to1", "drawdown", "session", "win" }],
      "points1to1": [{ "equity" }]
    }
  }
  ```
- **Business logic**: Computes equity curve from closed trades. Downsamples to max 500 points. Includes 1:1R benchmark curve.
- **Errors**: `400` (missing backtestRunId), `404` (run not found)

### `GET /api/engine/signals-review`

- **Query params**: EngineFilters
- **Response** `200`: `{ "data": { signal review analytics } }`

### `POST /api/engine/import-bundle`

- **Body**:
  ```json
  {
    "signals": [{
      "signalKey": "s1",
      "strategyCode": "BREAKOUT",
      "symbol": "XAUUSD",
      "timeframe": "H1",
      "side": "LONG",
      "session": "LONDON",
      "entryTime": "2025-01-01T08:00:00Z",
      "entryPrice": 3230,
      "stopLoss": 3220,
      "takeProfit1": 3245,
      "notes": null
    }],
    "results": [{
      "signalKey": "s1",
      "exitRuleCode": "TP1",
      "resultSide": "LONG",
      "session": "LONDON",
      "win": true,
      "isOpen": false,
      "rMultiple": 1.5,
      "pnlUsd": 450,
      "maxDrawdownPct": 2.3,
      "exitReason": "TAKE_PROFIT_1",
      "exitTime": "2025-01-01T09:00:00Z",
      "exitPrice": 3245
    }],
    "backtestRun": {
      "name": "Import Run",
      "symbol": "XAUUSD",
      "timeframe": "H1",
      "strategyCode": "BREAKOUT",
      "side": "LONG",
      "initialEquity": 10000,
      "riskPercent": 1.5
    },
    "existingBacktestRunId": null
  }
  ```
  Either `backtestRun` (creates new) or `existingBacktestRunId` (appends to existing).
- **Response** `201`:
  ```json
  {
    "data": {
      "backtestRunId": "...",
      "importedSignals": 5,
      "importedResults": 8,
      "createdBacktestRun": true
    }
  }
  ```
- **Errors**: `400` (unknown strategy/exit rule codes, missing data)

---

## 14. Monitoring Routes

Source: `registerMonitoringRoutes.ts`

### `GET /api/admin/monitoring`

- **Auth**: `requireAdmin()` (JWT + user hydration + ADMIN role)
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "cached": false,
      "generatedAt": "<ISO>",
      "cacheTtlMs": 60000,
      "health": [{ health check items }],
      "candleDistribution": [{ distribution data }],
      "activeSymbolFreshness": [{ freshness data }],
      "alerts": [{ alert items }],
      "tableCounts": { "candles": 1000, "signals": 200, "tradeResults": 50 }
    }
  }
  ```
- **Business logic**: Returns a system-wide monitoring snapshot covering candle health, symbol freshness, active alerts, and table counts.

---

## 15. Trading Account Routes

Source: `registerTradingAccountRoutes.ts`

All routes are under `/api/trading/` which requires `requireModule('trading')` at the router level.

### `GET /api/trading/accounts`

- **Query params**: `userId` (optional, admin-only scope override)
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "accounts": [{
        "id": "acct-1",
        "ownerUserId": "user-1",
        "ownerEmail": "pilot@example.com",
        "ownerUsername": "pilot",
        "ownerDisplayName": "Pilot User",
        "label": "Pilot MT5",
        "brokerKind": "MT5",
        "accountMode": "PAPER",
        "status": "PENDING",
        "baseCurrency": null,
        "leverage": null,
        "lastSeenAt": null,
        "lastSuccessfulSyncAt": null,
        "mt5Login": "10001",
        "mt5Server": "Demo-Server",
        "hasStoredCredential": true,
        "isActive": true,
        "createdAt": "<ISO>",
        "updatedAt": "<ISO>"
      }],
      "activeAccountId": "acct-1"
    }
  }
  ```

### `POST /api/trading/accounts`

- **Body**:
  ```json
  {
    "ownerUserId": null,
    "label": "My MT5 Account",
    "accountMode": "PAPER",
    "mt5Login": "10001",
    "mt5Password": "secret",
    "mt5Server": "Demo-Server"
  }
  ```
  - `accountMode`: `"LIVE"` or `"PAPER"` (case-insensitive). Invalid values return `400`.
  - `ownerUserId`: null = current user. Admins can set to another user's ID.
- **Response** `201`:
  ```json
  { "success": true, "data": { "account": { ... } } }
  ```

### `POST /api/trading/accounts/:id/select`

- **Path params**: `id` -- account UUID
- **Query params**: `userId` (optional scope override)
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "account": { ... },
      "activeAccountId": "acct-2"
    }
  }
  ```
- **Business logic**: Switches the user's active account.

### `PATCH /api/trading/accounts/:id`

- **Path params**: `id`
- **Query params**: `userId` (optional scope override)
- **Body**: Partial update. Fields: `label`, `accountMode`, `mt5Login`, `mt5Password`, `mt5Server`.
  - `mt5Password: null` preserves existing password.
  - `accountMode` validates strictly.
- **Response** `200`: `{ "success": true, "data": { "account": { ... } } }`

### `DELETE /api/trading/accounts/:id`

- **Path params**: `id`
- **Query params**: `userId` (optional scope override)
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "deletedId": "acct-1",
      "activeAccountId": "acct-2"
    }
  }
  ```

---

## 16. Trading Workspace Routes

Source: `registerTradingWorkspaceRoutes.ts`

All routes are under `/api/trading/` and use the module-level trading guard.

### `GET /api/trading/accounts/:id/workspace`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id` -- account UUID
- **Query params**: `userId` (optional scope override)
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "summary": {
        "accountId", "accountLabel", "brokerKind", "accountMode", "accountStatus",
        "mt5Login", "mt5Server", "baseCurrency", "leverage",
        "balance", "equity", "margin", "freeMargin", "marginLevel",
        "unrealizedPnl", "realizedPnlDay",
        "openPositionCount", "pendingOrderCount", "totalDealCount",
        "syncHealth": { "state", "label", "message", "lastSuccessfulSyncAt", "staleAfterSeconds", "canForceSync", "canTrade" },
        "evaluatedAt"
      },
      "positions": [],
      "orders": [],
      "deals": [],
      "syncRuns": []
    }
  }
  ```

### `GET /api/trading/accounts/:id/summary`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**: `userId`
- **Response** `200`: `{ "success": true, "data": { summary object } }`

### `GET /api/trading/accounts/:id/positions`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**: `userId`
- **Response** `200`: `{ "success": true, "data": { "items": [positions] } }`

### `GET /api/trading/accounts/:id/orders`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**: `userId`
- **Response** `200`: `{ "success": true, "data": { "items": [orders] } }`

### `GET /api/trading/accounts/:id/deals`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**:
  - `userId` (scope override)
  - `limit` -- positive integer
  - `from` -- UTC ISO timestamp (`2026-03-01T00:00:00.000Z`)
  - `to` -- UTC ISO timestamp
- **Response** `200`: `{ "success": true, "data": { "items": [deals] } }`
- **Errors**: `400` (invalid limit/dates, `from > to`)

### `GET /api/trading/accounts/:id/sync-runs`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**: `limit`, `userId`
- **Response** `200`: `{ "success": true, "data": { "items": [sync runs] } }`

### `POST /api/trading/accounts/:id/sync`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**: `userId`
- **Response** `202`: `{ "success": true, "data": { workspace snapshot } }`
- **Business logic**: Forces an immediate MT5 reconciliation sync.

### `GET /api/trading/accounts/:id/commands`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**: `limit`, `userId`
- **Response** `200`: `{ "success": true, "data": { "items": [execution commands] } }`

### `POST /api/trading/accounts/:id/commands`

- **Auth**: Trading module + `requireTradingCapabilityForAccount(prisma, 'write')` (account-scoped; paper accounts bypass write flag)
- **Path params**: `id` -- account UUID
- **Query params**: `userId` (scope override)
- **Body**:
  ```json
  {
    "commandType": "OPEN_MARKET",
    "symbol": "XAUUSD",
    "side": "LONG",
    "volume": 0.1,
    "price": null,
    "stopLoss": 3220,
    "takeProfit": 3245,
    "brokerPositionId": null,
    "brokerOrderId": null,
    "orderType": "MARKET",
    "comment": "Entry signal",
    "idempotencyKey": "unique-key-123"
  }
  ```
  - `commandType` enum: `OPEN_MARKET`, `CLOSE_POSITION`, `PARTIAL_CLOSE`, `PLACE_PENDING`, `MODIFY_POSITION`, `CANCEL_ORDER`, `FORCE_SYNC`
  - `orderType` enum: `MARKET`, `BUY_LIMIT`, `SELL_LIMIT`, `BUY_STOP`, `SELL_STOP`
  - `side`: `LONG` or `SHORT`
- **Response** `201`:
  ```json
  {
    "success": true,
    "data": {
      "id": "cmd-1",
      "accountId": "acct-1",
      "commandType": "OPEN_MARKET",
      "symbol": "XAUUSD",
      "side": "LONG",
      "volume": 0.1,
      "price": null,
      "status": "PENDING",
      "brokerPositionId": null,
      "brokerOrderId": null,
      "brokerReference": null,
      "idempotencyKey": "unique-key-123"
    }
  }
  ```
- **Business logic**: Creates an execution command that is dispatched to the MT5 bridge. All commands are audit-logged.
- **Errors**: `400 INVALID_BODY` (invalid commandType)

### `GET /api/trading/accounts/:id/automation/bindings`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**: `userId`
- **Response** `200`: `{ "success": true, "data": { bindings array } }`

### `GET /api/trading/accounts/:id/automation/intents`

- **Auth**: Trading module + `requireTradingCapability('read')`
- **Path params**: `id`
- **Query params**: `limit`, `userId`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "items": [{
        "id": "intent-1",
        "accountId": "acct-1",
        "bindingId": "binding-1",
        "bindingName": "Paper Auto",
        "indicatorInstanceId": "inst-1",
        "indicatorName": "Live Song Trap",
        "signalEventId": "evt-1",
        "executionCommandId": "cmd-1",
        "executionCommandStatus": "RECONCILED",
        "mode": "AUTO_EXECUTE",
        "status": "EXECUTED",
        "eventType": "ENTRY",
        "commandType": "OPEN_MARKET",
        "symbol": "XAUUSD",
        "side": "LONG",
        "volume": 0.1,
        "entryPrice": 3230,
        "stopLoss": 3220,
        "takeProfit": 3240,
        "candleTime": "<ISO>",
        "createdAt": "<ISO>",
        "updatedAt": "<ISO>",
        "startedAt": "<ISO>",
        "completedAt": "<ISO>"
      }]
    }
  }
  ```

### `POST /api/trading/accounts/:id/automation/bindings`

- **Auth**: Trading module + `requireTradingCapabilityForAccount(prisma, 'automation')` (paper accounts bypass automation flag)
- **Path params**: `id`
- **Query params**: `userId`
- **Body**:
  ```json
  {
    "indicatorInstanceId": "inst-1",
    "name": "London Trap Auto",
    "mode": "AUTO_EXECUTE",
    "filtersJson": {},
    "riskConfigJson": {},
    "guardrailsJson": {},
    "approvalRequired": true,
    "killSwitchActive": false
  }
  ```
  - `mode` enum: `OBSERVE`, `MANUAL_APPROVAL`, `AUTO_EXECUTE`
- **Response** `201`: `{ "success": true, "data": { binding object } }`
- **Errors**: `400 INVALID_BODY` (missing required fields or invalid mode)

### `PATCH /api/trading/accounts/:id/automation/bindings/:bindingId`

- **Auth**: Trading module + `requireTradingCapabilityForAccount(prisma, 'automation')`
- **Path params**: `id` (account), `bindingId`
- **Query params**: `userId`
- **Body**:
  ```json
  {
    "status": "ACTIVE",
    "killSwitchActive": false,
    "statusReason": "Approved after review"
  }
  ```
  - `status` enum: `PENDING_APPROVAL`, `ACTIVE`, `PAUSED`, `ARCHIVED`
- **Response** `200`: `{ "success": true, "data": { updated binding } }`
- **Errors**: `400 INVALID_BODY` (invalid status)

---

## 17. Trading Operations Routes

Source: `registerTradingOperationsRoutes.ts`

All routes are under `/api/trading/` and use the module-level trading guard.

### `GET /api/trading/operations/access`

- **Auth**: Trading module (no additional feature flag gate)
- **Query params**: `accountId`, `userId`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "flags": {
        "trading_read_enabled": true,
        "trading_write_enabled": false,
        "trading_automation_enabled": false
      },
      "capabilities": {
        "read": { "enabled": true },
        "write": { "enabled": false, "reason": "...", "blockedBy": ["trading_write_enabled"] },
        "automation": { "enabled": false, "reason": "...", "blockedBy": ["trading_automation_enabled"] }
      },
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Returns the current trading capability snapshot. If `accountId` is provided, includes account-mode overrides (paper accounts unlock write/automation even when global flags are off).

### `GET /api/trading/operations/signal-eligibility`

- **Auth**: Trading module + `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "items": [{ eligibility items }],
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Lists signal definitions eligible for live trading deployment.

### `GET /api/trading/operations/account-readiness`

- **Auth**: Trading module + `requireAuthenticatedRequest`
- **Query params**: `accountId`, `userId`
- **Response** `200`:
  ```json
  { "success": true, "data": { readiness snapshot } }
  ```
- **Business logic**: Evaluates whether the trading account is ready for execution (credential status, sync health, broker connectivity).

### `GET /api/trading/operations/signal-versions/:code/:version`

- **Auth**: Trading module + `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Path params**: `code` (signal code), `version` (positive integer)
- **Query params**: `backtestRunId` or `indicatorInstanceId` (mutually exclusive)
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "signalCode": "songTrap",
      "signalVersion": 1,
      "signalName": "Song Trap",
      "category": "Breakout",
      "parameterSchema": { ... },
      "originKind": "backtest-run",
      "originRecordId": "run-1",
      "parameterValuesJson": { "lookback": 20 },
      "executionConfigJson": { "orderTiming": "CLOSE" },
      "accountContext": null
    }
  }
  ```
- **Errors**: `400 INVALID_PARAMS`, `400 INVALID_CONTEXT` (both backtest and indicator supplied), `404 SIGNAL_VERSION_NOT_FOUND`

### `GET /api/trading/operations/failure-classification`

- **Auth**: Trading module + `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Response** `200`:
  ```json
  { "success": true, "data": { classification snapshot } }
  ```
- **Business logic**: Evaluates domain failure classification across signals and execution records.

### `GET /api/trading/operations/trade-history`

- **Auth**: Trading module + `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Query params**: `limit` (positive integer)
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "summary": {
        "totalRecords", "activeTrades", "wins", "losses", "breakEven",
        "recordsWithAudit", "recordsMissingAudit", "commandEvents", "decisionEvents"
      },
      "records": [{
        "recordId", "rowId", "signalId", "backtestRunId", "exitRuleId",
        "exitRuleCode", "exitRuleName", "runName", "runStatus",
        "signalCode", "signalVersion", "symbol", "timeframe",
        "side", "session", "entryTime", "exitTime",
        "entryPrice", "stopLoss", "exitPrice",
        "rMultiple", "pnlUsd", "result", "exitReason",
        "commandEventCount", "decisionEventCount",
        "auditCoverage", "latestAuditAt"
      }],
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Errors**: `400 INVALID_PARAMS` (invalid limit)

### `GET /api/trading/operations/trade-history/:recordId`

- **Auth**: Trading module + `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Path params**: `recordId`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "record": { ... },
      "traceability": {
        "historyRecordId", "rowId", "signalId", "backtestRunId",
        "runName", "signalKey", "exitRuleCode",
        "summaryLabel", "scopeLabel", "scopeDetail"
      },
      "timelineSummary": {
        "totalItems", "commandEvents", "decisionEvents",
        "firstOccurredAt", "lastOccurredAt"
      },
      "timeline": [{
        "id", "kind", "source", "eventType", "occurredAt", "createdAt",
        "label", "price", "signalEventId",
        "stateBefore", "stateAfter", "ruleId", "notes",
        "metaJson", "indicatorJson", "thresholdJson", "priceJson"
      }],
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Errors**: `400` (missing recordId), `404 TRADE_HISTORY_RECORD_NOT_FOUND`

### `GET /api/trading/operations/discrepancies/:code/:version`

- **Auth**: Trading module + `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Path params**: `code`, `version` (positive integer)
- **Query params**: `backtestRunId`, `indicatorInstanceId`, `tradeRecordId`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "investigationKind": "alert-driven",
      "signalCode", "signalVersion", "signalName",
      "linkedRecords": { ... },
      "backtest": { "runId", "runName", "reportSummary": { ... } },
      "live": { "primaryIndicatorInstanceId", "deployments", "timelineSummary", "recentTimeline" },
      "discrepancies": [{ ... }],
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Compares backtest expectations with live execution to surface discrepancies.
- **Errors**: `400 INVALID_PARAMS`, `404 DISCREPANCY_CONTEXT_NOT_FOUND`

### `GET /api/trading/operations/diagnosis/:code/:version`

- **Auth**: Trading module + `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Path params**: `code`, `version`
- **Query params**: `backtestRunId`, `indicatorInstanceId`, `tradeRecordId`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "signalCode", "signalVersion", "signalName",
      "investigationKind": "reported-issue",
      "primaryCategory": "broker-execution",
      "categories": [{
        "category": "broker-execution",
        "label": "Broker Execution",
        "score": 140,
        "confidence": "high",
        "severity": "critical",
        "summary": "...",
        "evidence": [{
          "id", "source", "severity", "title", "detail",
          "linkedRecordLabel", "linkedRecordId", "sectionKey", "href"
        }]
      }],
      "linkedRecords": { ... },
      "latestOutcome": null,
      "history": [],
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Root cause diagnosis using evidence from discrepancies. Categories: `data-quality`, `signal-logic`, `risk-settings`, `broker-execution`.
- **Errors**: `400 INVALID_PARAMS`, `404 DIAGNOSIS_CONTEXT_NOT_FOUND`

### `POST /api/trading/operations/diagnosis/:code/:version`

- **Auth**: Trading module + `requireAuthenticatedRequest` + `requireTradingCapability('write')` (feature flag gated)
- **Path params**: `code`, `version`
- **Body**:
  ```json
  {
    "backtestRunId": "run-1",
    "indicatorInstanceId": "inst-1",
    "tradeRecordId": "trade-1",
    "rootCauseCategory": "broker-execution",
    "outcome": "escalated",
    "summary": "Escalated after repeated broker rejection evidence."
  }
  ```
  - `rootCauseCategory` enum: `data-quality`, `signal-logic`, `risk-settings`, `broker-execution`
  - `outcome` enum: `resolved`, `mitigated`, `escalated`
- **Response** `201`:
  ```json
  {
    "success": true,
    "data": {
      "id": "diag-1",
      "signalCode", "signalVersion",
      "rootCauseCategory", "outcome",
      "backtestRunId", "indicatorInstanceId", "tradeRecordId",
      "summary", "decidedAt",
      "decisionContext": { ... }
    }
  }
  ```
- **Errors**: `400 INVALID_PARAMS`, `400 INVALID_BODY`, `404 DIAGNOSIS_CONTEXT_NOT_FOUND`

---

## 18. Trading Export Routes

Source: `registerTradingExportRoutes.ts`

### `GET /api/trading/exports/contracts`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "contracts": [{
        "kind": "signal-event",
        "version": 1,
        "label": "Signal Event",
        "description": "...",
        "fields": [{ "name", "type", "required", "description" }]
      }],
      "evaluatedAt": "<ISO>"
    }
  }
  ```

### `GET /api/trading/exports/contracts/:kind`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Path params**: `kind` -- must be a valid contract kind
- **Response** `200`: `{ "success": true, "data": { contract definition } }`
- **Errors**: `400 INVALID_CONTRACT_KIND`, `404 CONTRACT_NOT_FOUND`

### `GET /api/trading/exports/records`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Query params**:
  - `backtestRunId` -- string (mutually exclusive with indicatorInstanceId)
  - `indicatorInstanceId` -- string
  - `contractKind` -- valid contract kind
  - `limit` -- positive integer, default 200
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "records": [{ "contractKind", "recordId", "payload": {} }],
      "total": 1,
      "query": { ... },
      "exportedAt": "<ISO>"
    }
  }
  ```
- **Errors**: `400 INVALID_CONTEXT` (both backtest and indicator), `400 INVALID_CONTRACT_KIND`, `400 INVALID_PARAMS` (bad limit)
- **Note**: Only registered when Prisma client is available.

---

## 19. Trading External Action Routes

Source: `registerTradingExternalActionRoutes.ts`

Manages Telegram (and future webhook) deployments for live signal delivery.

### `GET /api/trading/external-actions/deployments`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Query params**: `indicatorInstanceId`, `status`, `limit` (default 100), `userId` (admin scope override)
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "deployments": [{
        "id", "ownerUserId", "indicatorInstanceId",
        "signalCode", "signalVersion", "sourceBacktestRunId",
        "status", "statusReason", "eligibilityStateSnapshot",
        "telegramBotLabel", "hasTelegramBotToken": true,
        "telegramChatId", "telegramChatLabel", "messageTemplateKind",
        "createdByUserId", "enabledByUserId",
        "enabledAt", "pausedAt", "archivedAt",
        "createdAt", "updatedAt"
      }],
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Non-admin users can only see their own deployments. `telegramBotTokenCiphertext` is masked as `hasTelegramBotToken` boolean.

### `POST /api/trading/external-actions/deployments`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('write')`
- **Query params**: `userId` (admin scope override)
- **Body**:
  ```json
  {
    "indicatorInstanceId": "inst-1",
    "telegramBotToken": "bot:token",
    "telegramBotLabel": "ops-bot",
    "telegramChatId": "-1001234567",
    "telegramChatLabel": "VIP Channel",
    "messageTemplateKind": "DEFAULT_V1"
  }
  ```
- **Response** `201`: `{ "success": true, "data": { deployment view } }`

### `POST /api/trading/external-actions/deployments/:id/enable`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('write')`
- **Path params**: `id`
- **Query params**: `userId`
- **Response** `200`: `{ "success": true, "data": { deployment view } }`

### `POST /api/trading/external-actions/deployments/:id/pause`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('write')`
- **Path params**: `id`
- **Query params**: `userId`
- **Body**: `{ "reason": "Maintenance window" }` (optional)
- **Response** `200`: `{ "success": true, "data": { deployment view } }`

### `POST /api/trading/external-actions/deployments/:id/archive`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('write')`
- **Path params**: `id`
- **Query params**: `userId`
- **Body**: `{ "reason": "Strategy retired" }` (optional)
- **Response** `200`: `{ "success": true, "data": { deployment view } }`

### `GET /api/trading/external-actions/events`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Query params**: `externalDeploymentId`, `indicatorInstanceId`, `status`, `limit` (default 100), `userId`
- **Response** `200`:
  ```json
  { "success": true, "data": { "events": [...], "evaluatedAt": "<ISO>" } }
  ```
- **Business logic**: Non-admin users are restricted to their own events (403 if `userId` differs from authenticated user).

### `GET /api/trading/external-actions/deliveries`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('read')`
- **Query params**: `externalActionEventId`, `externalDeploymentId`, `limit` (default 100), `userId`
- **Response** `200`:
  ```json
  { "success": true, "data": { "deliveries": [...], "evaluatedAt": "<ISO>" } }
  ```

### `POST /api/trading/external-actions/events/:id/replay`

- **Auth**: `requireAuthenticatedRequest` + `requireTradingCapability('write')`
- **Path params**: `id` -- event ID
- **Query params**: `userId`
- **Response** `202`:
  ```json
  {
    "success": true,
    "data": {
      "id": "replay-1",
      "externalActionEventId": "event-1",
      "replayKind": "MANUAL_RETRY",
      "status": "QUEUED",
      "queuedAt": "<ISO>",
      "createdByUserId": "user-1"
    }
  }
  ```
- **Business logic**: Re-queues a failed delivery for manual retry via BullMQ.

---

## 20. Trading Command Preflight

Source: `registerTradingAccountRoutes.ts` (inline) and `registerTradingCommandRoutes.ts`

### `POST /api/trading/commands/preflight`

- **Auth**: Trading module + `requireTradingCapability('write')`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "tier": "write",
      "title": "Write tier enabled",
      "message": "Runtime gating allows manual command preparation.",
      "nextAction": "manual-command-lane",
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Preflight check for the UI to confirm the write tier is enabled before showing command UI.

---

## 21. Trading Automation Preflight

Source: `registerTradingAccountRoutes.ts` (inline) and `registerTradingAutomationRoutes.ts`

### `POST /api/trading/automation/preflight`

- **Auth**: Trading module + `requireTradingCapability('automation')`
- **Response** `200`:
  ```json
  {
    "success": true,
    "data": {
      "tier": "automation",
      "title": "Automation tier enabled",
      "message": "Runtime gating allows automation controls to appear.",
      "nextAction": "automation-control-lane",
      "evaluatedAt": "<ISO>"
    }
  }
  ```
- **Business logic**: Preflight check for the UI to confirm the automation tier is enabled.

---

## Appendix: Route Registration Order

Routes are registered in `setupRoutes()` in this exact order:

1. `GET /health` (inline)
2. Auth routes (`registerAuthRoutes`)
3. Public routes (`registerPublicRoutes`)
4. `GET /api/symbols` (inline)
5. `GET /api/ohlcv/:symbol` (inline)
6. `GET /api/sync-status/:symbol` (inline)
7. `GET /api/market-summary` (inline)
8. `POST /api/ohlcv/batch` (inline, MUST be before `/:symbol`)
9. `POST /api/ohlcv/:symbol` (inline)
10. Engine routes (`registerEngineRoutes`)
11. Signal routes (`registerSignalRoutes`)
12. Indicator routes (`registerIndicatorRoutes`)
13. Monitoring routes (`registerMonitoringRoutes`)
14. `app.use('/api/trading', ...requireModule('trading'))` -- blanket trading auth
15. Trading account routes (`registerTradingAccountRoutes`)
16. Trading workspace routes (`registerTradingWorkspaceRoutes`)
17. Trading operations routes (`registerTradingOperationsRoutes`)
18. Trading integration routes (`registerTradingIntegrationRoutes`) -- wraps export + external action routes

## Appendix: Cookie Configuration

| Cookie | HttpOnly | SameSite | Secure (prod) | Path | Max Age |
|---|---|---|---|---|---|
| `tvgit.accessToken` | Yes | Lax | Yes | `/` | `ACCESS_TOKEN_TTL_SECONDS * 1000` |
| `tvgit.refreshToken` | Yes | Strict | Yes | `/` | 7 days |
