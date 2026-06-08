# 05 - Authentication & Security (Disaster Recovery Reference)

This document describes every authentication, authorization, encryption, and security mechanism in the trading platform. It contains enough detail to rebuild the auth stack from scratch.

---

## 1. Authentication System (JWT)

### Algorithm & Format

- **Algorithm**: HS256 (HMAC-SHA256)
- **Token format**: Standard 3-segment JWT (`header.payload.signature`)
- **Header**: `{ "alg": "HS256", "typ": "JWT" }`
- **Signing secret**: Environment variable `JWT_SECRET`
- **Encoding**: Base64URL (no padding) for all three segments

### JWT Implementation

The platform uses a **custom JWT implementation** (no third-party JWT library). Signing and verification are in `src/middleware/auth.ts`.

**Signing** (`signJwtToken`):
1. Encode header as Base64URL JSON
2. Encode payload as Base64URL JSON
3. Compute HMAC-SHA256 of `header.payload` using `JWT_SECRET`
4. Encode signature as Base64URL
5. Return `header.payload.signature`

**Verification** (`verifyJwtToken`):
1. Split token into 3 segments
2. Parse header; reject if `alg !== 'HS256'`
3. Recompute expected HMAC-SHA256 signature
4. Compare using `crypto.timingSafeEqual` (constant-time comparison to prevent timing attacks)
5. Check `nbf` (not-before) claim if present
6. Check `exp` (expiration) claim; reject if `exp <= now`

### Token Payload (Claims)

```typescript
interface AuthSessionTokenPayload {
    sub: string;         // User ID (UUID)
    role: AuthRoleKey;   // 'ADMIN' | 'USER'
    modules: AuthModuleKey[]; // ['chart', 'signal', 'report', 'trading', 'engine']
    iat: number;         // Issued-at (Unix seconds)
    exp: number;         // Expiration (Unix seconds)
}
```

### Token TTLs

| Token | TTL | Constant |
|---|---|---|
| Access token | **15 minutes** (900 seconds) | `ACCESS_TOKEN_TTL_SECONDS = 60 * 15` |
| Refresh token | **7 days** (604800 seconds) | `REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7` |

### JWT Secret Resolution (`resolveJwtSecret`)

- If `JWT_SECRET` env var is set and non-empty: use it
- If `NODE_ENV` is `production` or `prod`: **throw** (secret is mandatory)
- Otherwise (dev mode): generate an ephemeral 48-byte `crypto.randomBytes` secret (Base64URL-encoded), log a warning once. This secret is process-scoped and lost on restart.

### Production Config Assertion (`assertAuthReleaseCutConfig`)

In production, both `JWT_SECRET` and `AUTH_BOOTSTRAP_ADMIN_PASSWORD` must be set, or the process throws at startup.

### Source Files

- `src/services/auth/config.ts` -- TTL constants, secret resolution
- `src/middleware/auth.ts` -- `signJwtToken`, `verifyJwtToken`

---

## 2. User Management

### User Model (`StoredAuthUser`)

```typescript
interface StoredAuthUser {
    id: string;             // UUID (Prisma-generated)
    email: string;          // Lowercase, trimmed
    username: string;       // Lowercase, trimmed, 3-60 chars
    displayName: string | null;
    passwordHash: string;   // Hex-encoded
    passwordSalt: string;   // Hex-encoded
    role: 'ADMIN' | 'USER';
    isActive: boolean;
    modules: AuthModuleKey[];
}
```

### Validation Rules

| Field | Rule |
|---|---|
| Email | Must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, normalized to lowercase |
| Username | Must match `/^[a-z0-9._-]{3,60}$/` (lowercase letters, digits, dots, underscores, hyphens) |
| Password | Minimum 8 characters, Unicode-normalized (NFKC) before hashing |
| Display name | Max 120 characters, trimmed; null/empty becomes `null` |
| Modules (USER role) | At least one module grant required |

### Password Hashing

**Algorithm**: scrypt + SHA-512

**Process** (`src/services/auth/passwords.ts`):

1. Normalize password with Unicode NFKC normalization
2. Generate a 16-byte random salt (`crypto.randomBytes(16)`) encoded as hex (32 hex chars)
3. Derive a 64-byte key using `crypto.scrypt(password, salt, 64)` (Node.js default scrypt parameters: N=16384, r=8, p=1)
4. Hash the derived key with SHA-512: `crypto.createHash('sha512').update(derivedKey).digest('hex')`
5. Store both `hash` (128 hex chars) and `salt` (32 hex chars) in the database

**Verification**:
1. Re-derive using the same salt
2. Compare using `crypto.timingSafeEqual` (constant-time) on the hex-decoded buffers
3. Also checks buffer length equality before `timingSafeEqual`

**Constants**:
- `HASH_KEYLEN = 64` (scrypt output length in bytes)
- `HASH_ALGORITHM = 'sha512'` (post-scrypt hash)
- Salt: 16 bytes random

### Bootstrap Admin

On first login (when `countUsers() === 0`), the system auto-creates an admin account:

| Config | Env Var | Default |
|---|---|---|
| Email | `AUTH_BOOTSTRAP_ADMIN_EMAIL` | `admin@tvgit.local` |
| Username | `AUTH_BOOTSTRAP_ADMIN_USERNAME` | `admin` |
| Display name | `AUTH_BOOTSTRAP_ADMIN_DISPLAY_NAME` | `Bootstrap Admin` |
| Password | `AUTH_BOOTSTRAP_ADMIN_PASSWORD` | **Required** (no default, throws `AUTH_BOOTSTRAP_REQUIRED` if missing) |

The bootstrap admin gets role `ADMIN` with all modules.

### Last Admin Protection

The system prevents disabling or demoting the last active admin. Before any update that would change a user's role away from ADMIN or set `isActive: false`, it counts active admins. If only 1 remains and the update would remove them, it throws `AUTH_LAST_ADMIN_REQUIRED` (HTTP 409).

### Database Layer

`PrismaAuthUserRepository` wraps Prisma calls against the `User` and `UserPermission` tables. Permissions are stored as separate rows in a join table with `module` column (uppercase: `CHART`, `SIGNAL`, `REPORT`, `TRADING`, `ENGINE`).

Unique constraint violations (Prisma `P2002`) are mapped to:
- Email conflict: `AUTH_USER_EMAIL_CONFLICT` (409)
- Username conflict: `AUTH_USER_USERNAME_CONFLICT` (409)

### Source Files

- `src/services/auth/AuthUserService.ts`
- `src/services/auth/passwords.ts`
- `src/services/auth/types.ts`

---

## 3. Authorization (RBAC)

### Roles

| Role | Behavior |
|---|---|
| `ADMIN` | Full access to all modules. Automatically gets `['chart', 'signal', 'report', 'trading', 'engine']`. Can manage users. |
| `USER` | Access restricted to explicitly granted modules. Must have at least one module. |

### Module Permissions

| Module Key | DB Value | Frontend Path |
|---|---|---|
| `chart` | `CHART` | `/` |
| `signal` | `SIGNAL` | `/signals` |
| `report` | `REPORT` | `/reports` |
| `trading` | `TRADING` | `/trading` |
| `engine` | `ENGINE` | `/engine` |

### How Permissions Are Checked

**Middleware chain** (applied per-route group):

1. **`requireAppAuthentication`** -- Verifies JWT, extracts claims, sets `res.locals.auth`
2. **`hydrateAuthorizedUser`** -- Loads full user from DB by `auth.subject` (the `sub` claim), checks `isActive`, resolves modules, sets `res.locals.authorizedUser`
3. **`requireModuleAccess(prisma, ['trading'])`** -- Checks if user's role is ADMIN (always passes) or if any of the user's modules overlap with the required modules. Returns 403 with `AUTH_FORBIDDEN` if not.
4. **`requireAdminAccess(prisma)`** -- Checks if user's role is ADMIN. Returns 403 with `AUTH_ADMIN_REQUIRED` if not.

**Service-level checks**: `AuthUserService.requireAdmin()` also verifies admin status for user management operations (double-gated at both middleware and service layers).

### First Allowed Path

`buildFirstAllowedPath(role, modules)` determines the first accessible frontend route for a user:
- ADMIN: always `/`
- USER: iterates modules in order `chart -> signal -> report -> trading -> engine` and returns the first match's path
- If no modules: returns `null`

### Source Files

- `src/middleware/auth.ts` -- `requireModuleAccess`, `requireAdminAccess`, `hydrateAuthorizedUser`
- `src/services/auth/types.ts` -- `buildFirstAllowedPath`, module/role constants

---

## 4. Auth Middleware

### Middleware Stack (`src/middleware/auth.ts`)

#### `requireAuthenticatedRequest`
- **Used by**: Legacy trading routes
- Extracts token from `Authorization: Bearer <token>` header or `tvgit.accessToken` cookie
- If JWT-like (3 dot-separated segments): verifies JWT, sets `res.locals.auth` with mode `'jwt'`
- If not JWT-like: passes through as `mode: 'session-token'` (brownfield fallback for pre-auth legacy code)
- No token: returns 401 `TRADING_AUTH_REQUIRED`

#### `requireAppAuthentication`
- **Used by**: Auth routes, modern app routes
- Extracts token; requires it to be JWT-like (rejects non-JWT tokens)
- Verifies JWT, sets `res.locals.auth`
- No token or invalid: returns 401 `AUTH_REQUIRED` or `AUTH_INVALID`

#### `hydrateAuthorizedUser(prisma)`
- Loads user from DB using `auth.subject` (JWT `sub` claim)
- Checks user exists and `isActive`
- Resolves module permissions (ADMIN gets all; USER gets DB-stored permissions)
- Sets `res.locals.authorizedUser` with full user context
- Caches result in `res.locals` to avoid duplicate DB queries per request

#### `requireModuleAccess(prisma, modules)`
- Calls `loadAuthorizedUser` (same as hydrate, with caching)
- ADMIN role: always passes
- USER role: checks if any granted module is in `allowedModules`
- Returns 403 `AUTH_FORBIDDEN` with `meta.requiredModules`, `meta.grantedModules`, `meta.firstAllowedPath`

#### `requireAdminAccess(prisma)`
- Calls `loadAuthorizedUser`
- Only ADMIN role passes
- Returns 403 `AUTH_ADMIN_REQUIRED`

### Token Extraction Priority

1. `Authorization: Bearer <token>` header (checked first)
2. `tvgit.accessToken` cookie (fallback)

### `res.locals` Shape After Auth Middleware

```typescript
res.locals.auth = {
    token: string;                    // Raw token string
    subject: string | null;           // JWT sub claim (user ID)
    claims: JwtClaims | null;         // Full decoded JWT payload
    mode: 'jwt' | 'session-token';   // Auth mode
};

res.locals.authorizedUser = {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    role: 'ADMIN' | 'USER';
    isActive: boolean;
    modules: AuthModuleKey[];
    firstAllowedPath: string | null;
};
```

---

## 5. Ingestion Token Auth

A separate auth path for machine-to-machine data ingestion (candle data, tick data).

### How It Works

- **Token source**: `INGESTION_TOKEN` environment variable
- **Validation**: Exact string match of `Authorization: Bearer <token>` against `INGESTION_TOKEN`
- **No JWT involved**: Plain bearer token comparison

### Middleware

#### `requireAppAuthenticationOrIngestion(env)`
1. If the bearer token matches `INGESTION_TOKEN`: sets `res.locals.internalServiceAuth = { kind: 'ingestion-token' }` and passes through (no JWT or user hydration needed)
2. Otherwise: falls through to `requireAppAuthentication` (standard JWT flow)

#### `hydrateAuthorizedUserUnlessIngestion(prisma)`
- If `res.locals.internalServiceAuth.kind === 'ingestion-token'`: skips user hydration entirely
- Otherwise: runs standard `hydrateAuthorizedUser`

### Security Notes

- Ingestion tokens bypass all user/role/module checks
- They are intended for internal service communication only
- The token is a static secret; rotation requires env var update and restart

### Source Files

- `src/middleware/auth.ts` -- `isIngestionTokenRequest`, `requireAppAuthenticationOrIngestion`, `hydrateAuthorizedUserUnlessIngestion`
- `src/middleware/auth.ingestion.test.ts` -- Unit tests

---

## 6. Feature Flag System

### Trading Feature Flags

Three environment-variable-driven flags control trading capabilities in a tiered hierarchy:

| Flag | Env Var | Controls |
|---|---|---|
| `trading_read_enabled` | `FEATURE_TRADING_READ` | Read-only trading views (accounts, positions, history) |
| `trading_write_enabled` | `FEATURE_TRADING_WRITE` | Manual trade execution (open, close, modify positions) |
| `trading_automation_enabled` | `FEATURE_TRADING_AUTO` | Automated signal-to-trade execution |

**Tier hierarchy** (each tier requires all lower tiers):
- `automation` requires `write` requires `read`
- If `read` is off, both `write` and `automation` are blocked regardless of their own flags

**Paper account override**: When `accountMode === 'PAPER'`, the `write` and `automation` flags are treated as enabled even if their env vars are off. This allows paper trading while live trading remains locked.

**Boolean parsing**: Env var values `true`, `1`, `yes`, `on` (case-insensitive, trimmed) are truthy. Everything else is falsy.

### Feature Flag Middleware (`src/middleware/featureFlag.ts`)

#### `requireTradingCapability(tier)`
- Evaluates the flag snapshot
- If the requested tier is enabled: sets `res.locals.tradingFeatureFlags` and passes through
- If blocked: returns 403 `TRADING_FEATURE_DISABLED` with `meta.tier`, `meta.blockedBy`, `meta.flags`, `meta.evaluatedAt`
- Write-tier blocks are logged via `tradingExecutionLogger`

#### `requireTradingCapabilityForAccount(prisma, tier)`
- Same as above but also resolves the specific trading account's `accountMode` to enable paper overrides
- Loads account via `TradingAccountService.getBrokerContext`

### Feature Flag Snapshot Shape

```typescript
interface TradingFeatureFlagSnapshot {
    evaluatedAt: string;           // ISO timestamp
    flags: TradingFeatureFlags;    // Raw flag values
    capabilities: {
        read: TradingCapabilitySnapshot;
        write: TradingCapabilitySnapshot;
        automation: TradingCapabilitySnapshot;
    };
    highestEnabledTier: 'automation' | 'write' | 'read' | 'none';
}
```

### Source Files

- `src/services/trading/tradingFeatureFlags.ts` -- Flag reading, snapshot building
- `src/middleware/featureFlag.ts` -- Express middleware

---

## 7. Credential Encryption (MT5CredentialCipher)

Encrypts MT5 broker credentials (login, password, server) at rest in the database.

### Algorithm Details

| Parameter | Value |
|---|---|
| Algorithm | **AES-256-GCM** (authenticated encryption) |
| Key derivation | SHA-256 hash of `ENCRYPTION_KEY` env var |
| Key size | 256 bits (32 bytes, from SHA-256 output) |
| IV (nonce) | 12 bytes, randomly generated per encryption (`crypto.randomBytes(12)`) |
| Auth tag | 16 bytes (GCM default) |
| Minimum key input | `ENCRYPTION_KEY` must be at least 32 characters |

### Ciphertext Format

Stored as a single string:
```
<iv_hex>:<auth_tag_hex>:<encrypted_hex>
```

- `iv_hex`: 24 hex characters (12 bytes)
- `auth_tag_hex`: 32 hex characters (16 bytes)
- `encrypted_hex`: Variable length

### Encryption Process

1. Validate all three credential fields (`mt5Login`, `mt5Password`, `mt5Server`) are non-empty strings
2. Derive key: `SHA-256(ENCRYPTION_KEY)` => 32-byte key
3. Generate random 12-byte IV
4. Create AES-256-GCM cipher with key and IV
5. Encrypt `JSON.stringify({ mt5Login, mt5Password, mt5Server })`
6. Extract GCM auth tag
7. Concatenate as `iv:authTag:encrypted` (all hex-encoded)

### Decryption Process

1. Split ciphertext on `:`
2. Derive same key from `ENCRYPTION_KEY`
3. Create decipher with key and IV
4. Set auth tag
5. Decrypt and parse JSON
6. Validate all three fields again

### Plaintext Payload

```typescript
interface MT5CredentialPayload {
    mt5Login: string;
    mt5Password: string;
    mt5Server: string;
}
```

### Error Codes

- `ENCRYPTION_KEY_REQUIRED`: Key is missing or shorter than 32 chars
- `INVALID_CREDENTIAL_PAYLOAD`: A credential field is missing or empty
- `INVALID_CIPHERTEXT`: Stored ciphertext cannot be split into 3 parts

### Source Files

- `src/services/trading/MT5CredentialCipher.ts`

---

## 8. Session Management

### Refresh Token Storage

Refresh tokens are stored in **Redis** with a key pattern:
```
auth:refresh:<token_value>
```

- **Token format**: 32 random bytes, hex-encoded (64 hex characters), generated via `crypto.randomBytes(32)`
- **Value**: JSON `{ "userId": "<uuid>" }`
- **TTL**: 7 days (`EX 604800`)
- **Implementation**: `RedisRefreshTokenStore` in `src/routes/registerAuthRoutes.ts`

### Refresh Flow (Token Rotation)

1. Client sends refresh request (token read from `tvgit.refreshToken` cookie)
2. Server reads the refresh token record from Redis
3. If missing/expired: return 401 `AUTH_REFRESH_INVALID`
4. Load user from DB; verify user exists and `isActive`
5. **Delete the old refresh token** from Redis (single-use)
6. Issue a brand-new access token + refresh token pair
7. Set both cookies in the response

This is a **rotating refresh token** pattern -- each refresh token is single-use and replaced on every refresh.

### Cookie Configuration

| Cookie | Name | httpOnly | sameSite | secure | path | maxAge |
|---|---|---|---|---|---|---|
| Access token | `tvgit.accessToken` | true | `lax` | production only | `/` | 15 min (900000 ms) |
| Refresh token | `tvgit.refreshToken` | true | `strict` | production only | `/` | 7 days (604800000 ms) |

- `secure` flag is set when `NODE_ENV === 'production'`
- Both cookies are `httpOnly` (not accessible via JavaScript)
- Refresh cookie uses `sameSite: 'strict'` (stricter CSRF protection)
- Access cookie uses `sameSite: 'lax'` (allows top-level navigations)

### Logout

1. Read refresh token from cookie
2. Delete from Redis (revoke)
3. Clear both cookies from the response

### Cache-Control

All session-related responses set `Cache-Control: no-store` to prevent caching of auth state.

### Source Files

- `src/services/auth/AuthSessionService.ts` -- Session issuance, refresh, revoke
- `src/routes/registerAuthRoutes.ts` -- Cookie handling, Redis store, route handlers

---

## 9. CORS Configuration

### Development Origins (hardcoded)

```
http://localhost:3000
http://localhost:3001
http://localhost:5001
http://127.0.0.1:3000
http://127.0.0.1:3001
http://127.0.0.1:5001
http://<LAN_IP>:5001
https://trade.your-domain.com
```

In dev mode, requests with **no origin** (curl, mobile apps) are also allowed.

### Production Origins

Read from `CORS_ORIGIN` env var as a comma-separated list.

### CORS Options

| Setting | Value |
|---|---|
| `credentials` | `true` |
| `methods` | `GET, POST, PUT, PATCH, DELETE, OPTIONS` |
| `allowedHeaders` | `Content-Type, Authorization, X-Requested-With` |

### Source Files

- `src/utils/corsConfig.ts`

---

## 10. Trust Proxy

Configures Express `trust proxy` setting for correct client IP resolution behind reverse proxies.

### Configuration

- **Env var**: `TRUST_PROXY`
- **Default** (when unset): `'loopback, linklocal, uniquelocal'`

### Parsing Rules

| Input | Result |
|---|---|
| (not set) | `'loopback, linklocal, uniquelocal'` |
| `true` | `true` (trust all proxies) |
| `false` | `false` (trust none) |
| Integer (e.g. `2`) | `2` (trust N hops) |
| Comma-separated | Array of strings (e.g. `['10.0.0.0/8', '172.16.0.0/12']`) |
| Other string | Used as-is |

### Source Files

- `src/utils/trustProxy.ts`

---

## 11. Auth Routes

All routes are under `/api/auth/`. Registered in `src/routes/registerAuthRoutes.ts`.

### POST `/api/auth/login`

**Rate limited**: 10 requests per 15-minute window per IP.

**Request body**:
```json
{
    "identifier": "admin@tvgit.local",  // email or username
    "password": "secret"
}
```

**Success response** (200):
```json
{
    "success": true,
    "data": {
        "session": {
            "user": {
                "id": "uuid",
                "email": "admin@tvgit.local",
                "username": "admin",
                "displayName": "Bootstrap Admin",
                "role": "ADMIN",
                "isActive": true,
                "modules": ["chart", "signal", "report", "trading", "engine"]
            },
            "firstAllowedPath": "/",
            "accessTokenExpiresAt": "2026-04-14T12:15:00.000Z"
        }
    }
}
```

**Sets cookies**: `tvgit.accessToken`, `tvgit.refreshToken`

**Error responses**:
- 400 `AUTH_LOGIN_INVALID` -- missing identifier or password
- 401 `AUTH_LOGIN_FAILED` -- invalid credentials or disabled account
- 429 `AUTH_RATE_LIMITED` -- rate limit exceeded
- 503 `AUTH_BOOTSTRAP_REQUIRED` -- no users exist and bootstrap password not configured

**Audit log**: Successful logins logged to stdout with IP address.

### POST `/api/auth/refresh`

**Rate limited**: 30 requests per 15-minute window per IP.

**Request**: No body. Reads `tvgit.refreshToken` cookie.

**Success response** (200): Same shape as login response. Sets new cookies (token rotation).

**Error responses**:
- 401 `AUTH_REFRESH_INVALID` -- missing, expired, or revoked refresh token

On error, both cookies are cleared.

### POST `/api/auth/logout`

**Request**: No body. Reads `tvgit.refreshToken` cookie.

**Success response** (200):
```json
{
    "success": true,
    "data": {
        "loggedOut": true
    }
}
```

Deletes refresh token from Redis and clears both cookies.

### GET `/api/auth/session`

**Middleware**: `requireAppAuthentication` + `hydrateAuthorizedUser`

**Request**: No body. Uses access token from header or cookie.

**Success response** (200): Same session shape as login. Re-sets the access token cookie.

### GET `/api/auth/users`

**Middleware**: `requireAppAuthentication` + `hydrateAuthorizedUser` + `requireAdminAccess`

**Response** (200):
```json
{
    "success": true,
    "data": {
        "users": [
            {
                "id": "uuid",
                "email": "admin@tvgit.local",
                "username": "admin",
                "displayName": "Bootstrap Admin",
                "role": "ADMIN",
                "isActive": true,
                "modules": ["chart", "signal", "report", "trading", "engine"]
            }
        ]
    }
}
```

### POST `/api/auth/users`

**Middleware**: `requireAppAuthentication` + `hydrateAuthorizedUser` + `requireAdminAccess`

**Request body**:
```json
{
    "email": "trader@example.com",
    "username": "trader1",
    "displayName": "Trader One",
    "password": "at-least-8-chars",
    "role": "USER",
    "isActive": true,
    "modules": ["trading", "chart"]
}
```

**Success response** (201): `{ success: true, data: { user: { ... } } }`

**Error responses**:
- 400 `AUTH_USER_EMAIL_INVALID`, `AUTH_USER_USERNAME_INVALID`, `AUTH_USER_PASSWORD_INVALID`, `AUTH_USER_DISPLAY_NAME_INVALID`, `AUTH_USER_MODULES_REQUIRED`
- 409 `AUTH_USER_EMAIL_CONFLICT`, `AUTH_USER_USERNAME_CONFLICT`

**Audit log**: User creation logged to stdout with creator's user ID.

### PATCH `/api/auth/users/:id`

**Middleware**: `requireAppAuthentication` + `hydrateAuthorizedUser` + `requireAdminAccess`

**Request body** (all fields optional):
```json
{
    "email": "new-email@example.com",
    "username": "new-username",
    "displayName": "New Name",
    "password": "new-password",
    "role": "ADMIN",
    "isActive": false,
    "modules": ["trading", "signal"]
}
```

**Success response** (200): `{ success: true, data: { user: { ... } } }`

**Error responses**: Same validation errors as create, plus:
- 404 `AUTH_USER_NOT_FOUND`
- 409 `AUTH_LAST_ADMIN_REQUIRED` -- cannot demote/disable last admin

---

## 12. Security Patterns

### Rate Limiting

| Endpoint | Window | Max Requests | Implementation |
|---|---|---|---|
| `POST /api/auth/login` | 15 minutes | 10 | `express-rate-limit` |
| `POST /api/auth/refresh` | 15 minutes | 30 | `express-rate-limit` |

- Uses standard headers (`RateLimit-*`)
- Legacy `X-RateLimit-*` headers disabled
- Rate limit response: 429 with `AUTH_RATE_LIMITED` error code

### Password Security

- Minimum 8 characters
- No maximum length constraint
- Unicode NFKC normalization before hashing
- scrypt key derivation (CPU+memory-hard)
- Timing-safe comparison for both password verification and JWT signature verification

### Credential Error Messages

Login errors use **generic messages** that do not reveal whether the account exists:
> "The provided credentials are invalid or the account is disabled."

### Cookie Security

- `httpOnly`: Prevents XSS-based token theft
- `sameSite`: Prevents CSRF (`strict` for refresh, `lax` for access)
- `secure`: Enforced in production (HTTPS only)

### HMAC Signature Verification

JWT signature comparison uses `crypto.timingSafeEqual` to prevent timing-based side-channel attacks.

### Refresh Token Single-Use

Each refresh token is deleted from Redis immediately upon use, preventing replay attacks. A new token is issued on every refresh.

### No Brute Force Protection Beyond Rate Limiting

There is no account lockout mechanism. Brute force protection relies solely on rate limiting (10 attempts per 15 min per IP).

### Audit Logging

- Login success: `[AUDIT] User login successful: <identifier> (IP: <ip>)`
- User creation: `[AUDIT] User created: <email> (Role: <role>) by admin <userId>`
- Write-tier capability blocks are logged via `tradingExecutionLogger`

### Error Response Format

All auth errors follow a consistent shape:
```json
{
    "success": false,
    "error": {
        "code": "AUTH_ERROR_CODE",
        "message": "Human-readable description",
        "domain": "auth.session"
    }
}
```

Domains: `auth.session`, `auth.access`, `trading.auth`, `trading.sync`, `trading.execution`, `trading.automation`

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Production: yes | HMAC-SHA256 signing key for JWTs |
| `ENCRYPTION_KEY` | When using MT5 | AES-256-GCM key source (min 32 chars, SHA-256 hashed to 32 bytes) |
| `INGESTION_TOKEN` | For data ingestion | Static bearer token for machine-to-machine auth |
| `AUTH_BOOTSTRAP_ADMIN_PASSWORD` | First run | Password for the auto-created admin account |
| `AUTH_BOOTSTRAP_ADMIN_EMAIL` | No (default: `admin@tvgit.local`) | Bootstrap admin email |
| `AUTH_BOOTSTRAP_ADMIN_USERNAME` | No (default: `admin`) | Bootstrap admin username |
| `AUTH_BOOTSTRAP_ADMIN_DISPLAY_NAME` | No (default: `Bootstrap Admin`) | Bootstrap admin display name |
| `FEATURE_TRADING_READ` | No | Enable trading read tier |
| `FEATURE_TRADING_WRITE` | No | Enable trading write tier |
| `FEATURE_TRADING_AUTO` | No | Enable trading automation tier |
| `CORS_ORIGIN` | Production: yes | Comma-separated allowed origins |
| `TRUST_PROXY` | No (default: loopback/linklocal/uniquelocal) | Express trust proxy setting |
| `NODE_ENV` | No | `production`/`prod` enables secure cookies and strict config checks |
