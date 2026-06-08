# 09 — Infrastructure & Deployment

Disaster-recovery reference for rebuilding the entire TV-GIT trading platform from scratch.
Last reviewed: 2026-04-14.

---

## Table of Contents

1. [System Architecture Diagram](#1-system-architecture-diagram)
2. [Docker Compose Services](#2-docker-compose-services)
3. [Database Setup](#3-database-setup)
4. [Redis Setup](#4-redis-setup)
5. [Environment Variables](#5-environment-variables)
6. [Network Topology](#6-network-topology)
7. [NPM Scripts](#7-npm-scripts)
8. [TypeScript Configuration](#8-typescript-configuration)
9. [Build & Deploy Pipeline](#9-build--deploy-pipeline)
10. [Process Management](#10-process-management)
11. [SSL/TLS & Domain](#11-ssltls--domain)
12. [Monitoring](#12-monitoring)
13. [Backup & Recovery](#13-backup--recovery)
14. [Dependencies](#14-dependencies)

---

## 1. System Architecture Diagram

```
                          ┌──────────────────────────────────┐
                          │        Cloudflare Tunnel          │
                          │   tunnel: <TUNNEL_ID>...       │
                          └──────┬──────────────┬─────────────┘
                                 │              │
                   trade-api.your-domain.com    trade.your-domain.com
                                 │              │
                          ┌──────▼──────┐ ┌─────▼──────────┐
                          │  Backend    │ │   Frontend      │
                          │  Express.js │ │   Next.js 16    │
                          │  :3001      │ │   :5001 (dev)   │
                          │             │ │   :3000 (prod)  │
                          └──┬───┬───┬──┘ └────────────────┘
                             │   │   │
              ┌──────────────┤   │   ├──────────────────────┐
              │              │   │   │                      │
       ┌──────▼──────┐  ┌───▼───▼───▼──┐            ┌──────▼──────┐
       │ TimescaleDB  │  │    Redis     │            │External     │
       │ PostgreSQL16 │  │   7-alpine   │            │Signal DB    │
       │ :5433→5432   │  │   :6379      │            │ PG16-alpine │
       │              │  │              │            │ :5434→5432  │
       │ binance_trade│  │ BullMQ queues│            │external_    │
       │              │  │ Socket.IO    │            │signal       │
       │              │  │ pub/sub      │            │             │
       └──────────────┘  └──────────────┘            └─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
       ┌──────▼──────┐  ┌───────▼──────┐  ┌────────▼─────────┐
       │ Auto-Exec   │  │ Reconcile    │  │ External Action  │
       │ Worker      │  │ Worker       │  │ Delivery Worker  │
       │ (BullMQ)    │  │ (BullMQ)     │  │ (BullMQ)         │
       └──────┬──────┘  └──────┬───────┘  └──────────────────┘
              │                │
       ┌──────▼────────────────▼──────┐
       │  MT5 Bridge (Python)         │
       │  Read service  :8765         │
       │  Exec service  :8766         │
       │  (Windows only, MetaTrader5) │
       └──────────────────────────────┘

       ┌──────────────────────────────┐
       │ Backtest Execution Worker    │
       │ (BullMQ, connects to DB +   │
       │  Redis for progress pub/sub) │
       └──────────────────────────────┘
```

### Process Summary

| Process | Entry Point | Port | Role |
|---------|-------------|------|------|
| API Server | `src/main.ts` | 3001 | REST API + Socket.IO |
| Frontend | `web/` (Next.js) | 5001 (dev) / 3000 (prod) | Dashboard UI |
| Auto-Execution Worker | `src/workers/tradingAutoExecutionWorker.ts` | — | Execute trade intents via MT5 |
| Reconciliation Worker | `src/workers/tradingReconciliationWorker.ts` | — | Sync broker positions |
| External Action Worker | `src/workers/externalActionDeliveryWorker.ts` | — | Telegram/webhook delivery |
| Backtest Worker | `src/workers/backtestExecutionWorker.ts` | — | Async backtest execution |
| MT5 Bridge (data) | `mt5-service/` (Python) | 8765 | Market data collection |
| MT5 Bridge (exec) | `mt5-service/` (Python) | 8766 | Trade execution |

---

## 2. Docker Compose Services

File: `docker-compose.yml` (Compose v3.8)

### timescaledb

```yaml
image: timescale/timescaledb:latest-pg16
container_name: binance-timescaledb
restart: always
environment:
  - POSTGRES_USER=postgres
  - POSTGRES_PASSWORD=postgres
  - POSTGRES_DB=binance_trade
volumes:
  - timescaledb_data:/var/lib/postgresql/data
ports:
  - "5433:5432"
```

- **Named volume:** `timescaledb_data` (Docker-managed, persists across container restarts)
- **Host port:** 5433 maps to container port 5432
- **No health check defined** — add one for production:
  ```yaml
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 10s
    timeout: 5s
    retries: 5
  ```

### external-signal-db

```yaml
image: postgres:16-alpine
container_name: binance-external-signal-db
restart: always
environment:
  - POSTGRES_USER=postgres
  - POSTGRES_PASSWORD=postgres
  - POSTGRES_DB=external_signal
volumes:
  - external_signal_db_data:/var/lib/postgresql/data
ports:
  - "5434:5432"
```

- **Named volume:** `external_signal_db_data`
- **Purpose:** Stores external action deployments (Telegram signal output). Separate from main DB for isolation.

### redis

```yaml
image: redis:7-alpine
container_name: binance-redis
restart: always
ports:
  - "6379:6379"
```

- **No persistence configured** — data is ephemeral. BullMQ jobs and Socket.IO state survive only while container runs.
- **No volume mount** — intentional for local dev; consider adding `redis.conf` with AOF for production.

### Named Volumes

```yaml
volumes:
  timescaledb_data:
  external_signal_db_data:
```

Both use Docker's default local driver.

---

## 3. Database Setup

### TimescaleDB (Main Database)

- **Image:** `timescale/timescaledb:latest-pg16`
- **Database:** `binance_trade`
- **Schema management:** Prisma ORM (`prisma/schema.prisma`)
- **Connection string pattern:** `postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public`

#### Prisma Datasource

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
```

#### Required Extensions

TimescaleDB extension is included in the image. No manual `CREATE EXTENSION` needed for the `timescale/timescaledb` image.

#### Schema Bootstrap Procedure

```bash
# 1. Start the database
docker compose up -d timescaledb

# 2. Generate the Prisma client
npx prisma generate

# 3. Apply all migrations
npx prisma migrate deploy
```

The server validates required schema columns at startup via `src/database/requiredDatabaseSchema.ts`. If columns are missing, it logs the exact migration files that need to be applied and exits.

#### Key Tables (verified at startup)

- `price_candles` — OHLCV market data (TimescaleDB hypertable)
- `signal_definitions` — Signal logic definitions
- `signal_events` — Generated signal events
- `signal_logic_traces` — Backtest logic traces
- `indicator_instances` — Live indicator runtime state
- `indicator_alerts` — Alert configuration
- `tech_indicator_definitions` — Technical indicator catalog
- `users` — Auth users
- `trading_accounts` — MT5 trading accounts
- `trading_trade_intents` — Auto-execution trade intents
- `trading_execution_commands` — Sent execution commands

### External Signal Database

- **Image:** `postgres:16-alpine`
- **Database:** `external_signal`
- **Connection string pattern:** `postgresql://postgres:postgres@127.0.0.1:5434/external_signal`
- **Schema managed by:** `PostgresExternalActionStore` (auto-migration via `ensureReady()`)
- **Purpose:** Telegram/webhook deployment definitions, event log, delivery status

---

## 4. Redis Setup

- **Image:** `redis:7-alpine`
- **Port:** 6379
- **No authentication** configured
- **No persistence** (no AOF, no RDB snapshots in current config)
- **Connection:** `redis://localhost:6379` (default fallback in code)

### Redis Usage

| Feature | Details |
|---------|---------|
| BullMQ Queues | `trading-auto-execution`, `trading-reconciliation`, `external-action-delivery`, `backtest-execution` |
| Socket.IO Adapter | Real-time event distribution |
| Pub/Sub Channels | `SYMBOL:TIMEFRAME` candle confirmations, `backtest:progress:*`, `workspace:indicators`, `indicator:logs:*` |

### Production Recommendations

- Enable AOF persistence: `appendonly yes`
- Set `maxmemory` and `maxmemory-policy allkeys-lru`
- Add a Redis password and update `REDIS_URL` to `redis://:password@host:6379`

---

## 5. Environment Variables

### Backend `.env` (root directory)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string for main DB. Example: `postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public` |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `NODE_ENV` | No | — | Set to `production` to enable strict auth, secure cookies, and CORS enforcement |
| `JWT_SECRET` | Prod: Yes | Auto-generated in dev | JWT signing secret. Must be explicitly set in production |
| `AUTH_BOOTSTRAP_ADMIN_EMAIL` | No | `admin@tvgit.local` | Bootstrap admin email |
| `AUTH_BOOTSTRAP_ADMIN_USERNAME` | No | `admin` | Bootstrap admin username |
| `AUTH_BOOTSTRAP_ADMIN_DISPLAY_NAME` | No | `Bootstrap Admin` | Bootstrap admin display name |
| `AUTH_BOOTSTRAP_ADMIN_PASSWORD` | Prod: Yes | — | Bootstrap admin password. Must be set in production |
| `INGESTION_TOKEN` | Yes | — | Shared secret token for MT5 data ingestion endpoints |
| `ENCRYPTION_KEY` | For trading | — | Min 32 chars. AES key for encrypting MT5 credentials and webhook secrets |
| `TRUST_PROXY` | No | `loopback, linklocal, uniquelocal` | Express trust proxy setting. Accepts `true`, `false`, number, or CSV of ranges |
| `CORS_ORIGIN` | Prod: Yes | Hardcoded dev origins | Comma-separated list of allowed CORS origins in production |
| `FEATURE_TRADING_READ` | No | — | Feature flag: enable trading read endpoints (`true`/`false`) |
| `FEATURE_TRADING_WRITE` | No | — | Feature flag: enable trading write endpoints |
| `FEATURE_TRADING_AUTO` | No | — | Feature flag: enable auto-execution |
| `MT5_LOGIN` | For trading | — | MT5 account login number |
| `MT5_PASSWORD` | For trading | — | MT5 account password |
| `MT5_SERVER` | For trading | — | MT5 server name (e.g., `Exness-MT5Real36`) |
| `MT5_BRIDGE_PORT` | No | `8765` | MT5 data bridge HTTP port |
| `MT5_EXEC_BRIDGE_PORT` | No | Falls back to `MT5_BRIDGE_PORT` | MT5 execution bridge port (separate terminal) |
| `EXTERNAL_SIGNAL_DB_URL` | For external actions | — | PostgreSQL connection string for external signal database |
| `ALERT_TELEGRAM_BOT_TOKEN` | No | — | Telegram bot token for sync-stale alerts |
| `ALERT_TELEGRAM_CHAT_ID` | No | — | Telegram chat ID for sync-stale alerts |
| `TELEGRAM_API_BASE_URL` | No | `https://api.telegram.org` | Override Telegram API endpoint |
| `BINANCE_API_URL` | No | — | Binance REST API URL |
| `BINANCE_WS_URL` | No | — | Binance WebSocket stream URL |
| `XAU_PRIORITY_ARTIFACT_DIR` | No | `.artifacts/` | Custom output directory for XAU priority backtest scripts |

### Release-Cut Example (`.env.release-cut.example`)

A minimal production config template:

```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/binance_trade
REDIS_URL=redis://localhost:6379
JWT_SECRET=replace-with-a-long-random-secret
AUTH_BOOTSTRAP_ADMIN_EMAIL=admin@tvgit.local
AUTH_BOOTSTRAP_ADMIN_USERNAME=admin
AUTH_BOOTSTRAP_ADMIN_DISPLAY_NAME=Release Admin
AUTH_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-bootstrap-password
TRUST_PROXY=loopback, linklocal, uniquelocal
FEATURE_TRADING_READ=true
FEATURE_TRADING_WRITE=false
FEATURE_TRADING_AUTO=false
INGESTION_TOKEN=replace-with-a-long-random-token
```

### Production `.env.prod` (Docker/VPS)

Used when services run inside Docker or on a VPS. Note the internal Docker hostnames:

```env
DATABASE_URL="postgresql://postgres:postgres@lib-trade-db:5432/binance_trade?schema=public"
REDIS_URL="redis://lib-trade-redis:6379"
NODE_ENV="production"
BINANCE_API_URL="https://api.binance.us"
BINANCE_WS_URL="wss://stream.binance.us:9443/stream"
```

### Frontend `web/.env.local`

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API URL (e.g., `http://localhost:3001` or `https://trade-api.your-domain.com`) |
| `NEXT_PUBLIC_SOCKET_URL` | Socket.IO URL (same as API URL typically) |

### MT5 Service `mt5-service/.env`

| Variable | Description |
|----------|-------------|
| `MT5_LOGIN` | MT5 account login number |
| `MT5_PASSWORD` | MT5 account password |
| `MT5_SERVER` | Broker server name (e.g., `Exness-MT5Real36`) |
| `MT5_TERMINAL_PATH` | Full path to `terminal64.exe` |
| `MT5_TERMINAL_PORTABLE` | `true`/`false` — use portable mode |
| `MT5_BRIDGE_PORT` | HTTP bridge port (default: `8765`) |
| `MT5_ENABLE_BRIDGE` | `true`/`false` — enable the bridge HTTP server |
| `TVGIT_URL` | Backend API URL (e.g., `http://localhost:3001`) |
| `INGESTION_TOKEN` | Must match backend's `INGESTION_TOKEN` |

### MT5 Trade Execution `mt5-service/.trade-exec.env.example`

Separate MT5 terminal for trade execution (different from data collection):

| Variable | Description |
|----------|-------------|
| `MT5_LOGIN` | Execution account login |
| `MT5_PASSWORD` | Execution account password |
| `MT5_SERVER` | Execution server (e.g., `Exness-MT5Trial8`) |
| `MT5_TERMINAL_PATH` | Path to a separate `terminal64.exe` install |
| `MT5_TERMINAL_PORTABLE` | `true` recommended for isolation |
| `MT5_BRIDGE_PORT` | `8766` (different from data bridge) |

### MT5 Remote Ingestion `mt5-service/remote-ingestion/.env.example`

For Windows machines pushing data to the Mac via tunnel:

| Variable | Description |
|----------|-------------|
| `MT5_LOGIN` | MT5 login |
| `MT5_PASSWORD` | MT5 password |
| `MT5_SERVER` | Broker server |
| `API_URL` | Primary: `https://trade-api.your-domain.com` (via tunnel) |
| `API_URL_FALLBACK` | LAN fallback: `http://192.168.x.x:3001` |
| `INGESTION_TOKEN` | Must match backend |
| `BROKER_TIMEZONE` | `Etc/GMT-3` (Exness summer time) |
| `LIVE_INTERVAL_SECONDS` | `10` |
| `LIVE_FETCH_BARS` | `3` |
| `HISTORICAL_DAYS` | `30` |
| `FETCH_WORKERS` | `4` |
| `RETRY_MAX` | `3` |

---

## 6. Network Topology

### Port Map

| Service | Host Port | Container Port | Protocol |
|---------|-----------|----------------|----------|
| TimescaleDB | 5433 | 5432 | TCP (PostgreSQL) |
| External Signal DB | 5434 | 5432 | TCP (PostgreSQL) |
| Redis | 6379 | 6379 | TCP |
| Backend API | 3001 | — | HTTP + WebSocket |
| Frontend (dev) | 5001 | — | HTTP |
| Frontend (prod) | 3000 | 3000 | HTTP |
| MT5 Bridge (data) | 8765 | — | HTTP |
| MT5 Bridge (exec) | 8766 | — | HTTP |

### Inter-Service Communication

```
Backend API ──(PostgreSQL)──→ TimescaleDB :5433
Backend API ──(PostgreSQL)──→ External Signal DB :5434
Backend API ──(Redis)──────→ Redis :6379
Backend API ──(HTTP)───────→ MT5 Bridge :8765 / :8766

Workers ────(PostgreSQL)──→ TimescaleDB :5433
Workers ────(Redis)───────→ Redis :6379 (BullMQ)
Workers ────(HTTP)────────→ MT5 Bridge :8765 / :8766

MT5 Bridge ─(HTTP POST)──→ Backend API :3001 /api/ohlcv/batch
                           (authenticated via INGESTION_TOKEN)

Frontend ───(HTTP/WS)────→ Backend API :3001 /api/* + Socket.IO
```

### Cloudflare Tunnel

File: `cloudflared-config.yml`

```yaml
tunnel: <YOUR_TUNNEL_ID>
credentials-file: /Users/youruser/.cloudflared/<YOUR_TUNNEL_ID>.json

ingress:
  - hostname: trade-api.your-domain.com
    service: http://localhost:3001
    originRequest:
      noTLSVerify: true
      connectTimeout: 10s
  - hostname: trade.your-domain.com
    service: http://localhost:5001
    originRequest:
      noTLSVerify: true
      connectTimeout: 10s
  - service: http_status:404
```

| Hostname | Target | Purpose |
|----------|--------|---------|
| `trade-api.your-domain.com` | `localhost:3001` | Backend API (REST + Socket.IO) |
| `trade.your-domain.com` | `localhost:5001` | Frontend dashboard |

The tunnel provides:
- HTTPS termination (Cloudflare edge)
- No inbound port forwarding required on the host
- Remote MT5 machines (Windows) push data via `trade-api.your-domain.com`

To start the tunnel:
```bash
cloudflared tunnel --config cloudflared-config.yml run
```

Credentials file must exist at the path specified. To recreate:
```bash
cloudflared tunnel login
cloudflared tunnel create <tunnel-name>
```

---

## 7. NPM Scripts

### Backend (`package.json`)

#### Core

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `ts-node src/main.ts` | Start backend dev server on :3001 |
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/main.js` | Start compiled production server |

#### Workers

| Script | Command | Description |
|--------|---------|-------------|
| `dev:trading:auto-worker` | `ts-node src/workers/tradingAutoExecutionWorker.ts` | Trade intent execution worker (dev) |
| `dev:trading:reconciliation-worker` | `ts-node src/workers/tradingReconciliationWorker.ts` | Broker position sync worker (dev) |
| `dev:external-action:worker` | `ts-node src/workers/externalActionDeliveryWorker.ts` | Telegram/webhook delivery worker (dev) |
| `dev:backtest:worker` | `ts-node src/workers/backtestExecutionWorker.ts` | Backtest execution worker (dev) |
| `start:trading:auto-worker` | `node dist/workers/tradingAutoExecutionWorker.js` | Auto-execution worker (production) |
| `start:trading:reconciliation-worker` | `node dist/workers/tradingReconciliationWorker.js` | Reconciliation worker (production) |
| `start:external-action:worker` | `node dist/workers/externalActionDeliveryWorker.js` | External action worker (production) |
| `start:backtest:worker` | `node dist/workers/backtestExecutionWorker.js` | Backtest worker (production) |

#### Testing

| Script | Command | Description |
|--------|---------|-------------|
| `test:trading:backend` | `node -r ts-node/register -e "require(...)"` | Run all trading backend tests (node:test runner) |
| `test` | `echo "Error..."` | Placeholder — not configured |
| `smoke:signals-platform` | `ts-node src/scripts/runSignalPlatformSmoke.ts` | Signal platform smoke test |
| `smoke:signals-batch` | `ts-node src/scripts/runSignalBatchPreviewSmoke.ts` | Signal batch preview smoke test |

#### Seeding

| Script | Command | Description |
|--------|---------|-------------|
| `seed:engine` | `ts-node src/scripts/seedEngineDemo.ts` | Seed engine demo data |
| `seed:signals` | `ts-node src/scripts/seedSignalDefinitions.ts` | Seed signal definitions |

#### Backtesting (XAU optimization matrices)

| Script | Description |
|--------|-------------|
| `xau:abc:b1` through `xau:abc:b6` | Individual XAU ABC optimization batches |
| `xau:abc:all` | Run all XAU ABC batches |
| `xau:abc:report` | Render optimization report |
| `xau:m5:roadmap` | M5 roadmap preview |
| `xag:m5:bootstrap` | XAG M5 bootstrap preview |
| `xau:new:l1` through `xau:new:l5` | New logic layer backtests |
| `xau:new:persist:base` | Persist base backtest runs |
| `backtest:artifact:list` | List available backtest targets |
| `backtest:xau:new:persist` | Run and persist XAU artifact backtests |

#### Utilities

| Script | Command | Description |
|--------|---------|-------------|
| `audit:candles:htf` | `ts-node src/scripts/auditHigherTimeframeCandles.ts` | Audit higher-timeframe candle data |
| `mt5:export-trade-exec-env` | `node -r ts-node/register src/scripts/exportMt5TradeExecEnv.ts` | Export MT5 trade execution env file |

### Frontend (`web/package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev -p 5001` | Start Next.js dev server on :5001 |
| `build` | `next build` | Production build |
| `start` | `next start` | Start production server (:3000) |
| `lint` | `eslint` | Run ESLint |
| `test:unit` | compile + `run-unit-tests.cjs` | Run frontend unit tests |
| `test:e2e` | `playwright test` | Playwright E2E tests |

---

## 8. TypeScript Configuration

File: `tsconfig.json`

```json
{
    "compilerOptions": {
        "target": "ES2020",
        "module": "CommonJS",
        "outDir": "./dist",
        "rootDir": "./src",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules"]
}
```

| Option | Value | Rationale |
|--------|-------|-----------|
| `target` | `ES2020` | Supports optional chaining, nullish coalescing, BigInt. Compatible with Node 14+ |
| `module` | `CommonJS` | Required for `ts-node` and Node.js native `require()`. `package.json` type is `commonjs` |
| `strict` | `true` | Enables all strict type-checking options |
| `outDir` | `./dist` | Production build output |
| `rootDir` | `./src` | Source files only from `src/` |
| `esModuleInterop` | `true` | Allows `import express from 'express'` syntax for CJS modules |
| `skipLibCheck` | `true` | Speeds up compilation by skipping `.d.ts` validation |
| `forceConsistentCasingInFileNames` | `true` | Prevents cross-platform issues with file casing |

---

## 9. Build & Deploy Pipeline

### No CI/CD Pipeline

There are no GitHub Actions workflows, Procfile, fly.toml, render.yaml, or similar CI/CD configuration files in the project. Deployment is manual.

### Build for Production

```bash
# Backend
npm install
npx prisma generate
npm run build                  # outputs to dist/

# Frontend
npm --prefix web install
npm --prefix web run build     # outputs to web/.next/
```

### Dockerfiles

#### `Dockerfile.backend`

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

#### `Dockerfile.web`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app/web
ENV NODE_ENV production
COPY --from=builder /app/web/public ./public
COPY --from=builder /app/web/.next ./.next
COPY --from=builder /app/web/node_modules ./node_modules
COPY --from=builder /app/web/package.json ./package.json
COPY --from=builder /app/web/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "start"]
```

### Manual Deploy Steps

1. Build backend and frontend Docker images (or compile locally)
2. Start infrastructure: `docker compose up -d`
3. Apply database migrations: `npx prisma migrate deploy`
4. Start API server: `npm start`
5. Start workers (each in a separate process):
   - `npm run start:trading:auto-worker`
   - `npm run start:trading:reconciliation-worker`
   - `npm run start:external-action:worker`
   - `npm run start:backtest:worker`
6. Start frontend: `npm --prefix web start`
7. Start Cloudflare tunnel: `cloudflared tunnel --config cloudflared-config.yml run`
8. Start MT5 bridge on Windows machine(s)

---

## 10. Process Management

### Current Setup (Local-first)

No process manager (PM2, systemd) is currently configured. Each process runs in a separate terminal window.

### Required Processes for Full Operation

| # | Process | Command |
|---|---------|---------|
| 1 | Docker (infra) | `docker compose up -d` |
| 2 | API Server | `npm run dev` (dev) or `npm start` (prod) |
| 3 | Auto-Execution Worker | `npm run dev:trading:auto-worker` / `npm run start:trading:auto-worker` |
| 4 | Reconciliation Worker | `npm run dev:trading:reconciliation-worker` / `npm run start:trading:reconciliation-worker` |
| 5 | External Action Worker | `npm run dev:external-action:worker` / `npm run start:external-action:worker` |
| 6 | Backtest Worker | `npm run dev:backtest:worker` / `npm run start:backtest:worker` |
| 7 | Frontend | `npm --prefix web run dev` / `npm --prefix web start` |
| 8 | Cloudflare Tunnel | `cloudflared tunnel --config cloudflared-config.yml run` |

### Worker Shutdown Behavior

All workers implement graceful shutdown with a 30-second timeout:
- Listen for `SIGINT` and `SIGTERM`
- Call `worker.close()` to stop accepting new jobs
- Wait for in-flight jobs to complete (up to 30s)
- Force exit if timeout exceeded
- Disconnect Prisma and Redis connections

### Production Recommendations

For production, use PM2 or systemd:

```javascript
// ecosystem.config.js (example, not yet in repo)
module.exports = {
  apps: [
    { name: 'api', script: 'dist/main.js', instances: 1 },
    { name: 'worker-auto-exec', script: 'dist/workers/tradingAutoExecutionWorker.js' },
    { name: 'worker-reconciliation', script: 'dist/workers/tradingReconciliationWorker.js' },
    { name: 'worker-external', script: 'dist/workers/externalActionDeliveryWorker.js' },
    { name: 'worker-backtest', script: 'dist/workers/backtestExecutionWorker.js' },
  ]
};
```

### Legacy Infrastructure References

The docs reference legacy VPS files that are not part of the current workflow:
- `infrastructure/scripts/backup_db.sh`
- `infrastructure/backup.env.example`
- `infrastructure/systemd/lib-trade-db-backup.service`
- `infrastructure/systemd/lib-trade-db-backup.timer`
- `deploy.sh`

These target an older VPS setup with container name `lib-trade-db` and backup root `/opt/lib-trade/backups/postgres`.

---

## 11. SSL/TLS & Domain

### Domain Setup

| Domain | Service | Port |
|--------|---------|------|
| `trade-api.your-domain.com` | Backend API + Socket.IO | 3001 |
| `trade.your-domain.com` | Frontend dashboard | 5001 (dev) |

### TLS Termination

TLS is terminated at the Cloudflare edge. The tunnel carries plaintext HTTP between the local machine and Cloudflare's network. `noTLSVerify: true` is set in the tunnel config since the origin services are HTTP-only.

### Cookie Security

In production (`NODE_ENV=production`), auth cookies use the `Secure` flag, requiring HTTPS. This works correctly because the Cloudflare tunnel provides the HTTPS layer to the browser.

### CORS Configuration

- **Development:** Hardcoded allowlist includes `localhost:3000`, `localhost:3001`, `localhost:5001`, `127.0.0.1` variants, `<LAN_IP>:5001`, and `trade.your-domain.com`
- **Production:** Reads from `CORS_ORIGIN` environment variable (comma-separated)
- Requests without an `Origin` header are allowed in development only

---

## 12. Monitoring

### Admin Monitoring Dashboard

Endpoint: `GET /api/admin/monitoring` (admin-only)

The `MonitoringService` provides a cached snapshot (60s TTL) with:

| Check | Description |
|-------|-------------|
| **API Health** | Server responsiveness |
| **Database Health** | Prisma connection + latency |
| **MT5 Sync Freshness** | Data staleness per symbol/timeframe |
| **Candle Distribution** | Row counts by timeframe |
| **Active Symbol Freshness** | Per-symbol/timeframe last sync time and staleness |
| **Alerts** | Recent failed backtests and trade intents |

Health statuses: `healthy`, `degraded`, `failed`.
Freshness statuses: `fresh`, `stale` (> 10 min), `missing`.

### Sync Stale Alerts (Telegram)

The `SyncAlertService` runs an internal poller:

- **Check interval:** every 5 minutes
- **Stale threshold:** data older than 15 minutes triggers an alert
- **Cooldown:** no repeat alerts within 30 minutes
- **Weekend skip:** alerts suppressed on Saturday/Sunday (UTC)
- **Watched pairs:** `XAUUSD/5m`, `XAGUSD/5m`, `BTCUSD/5m`
- **Requires:** `ALERT_TELEGRAM_BOT_TOKEN` and `ALERT_TELEGRAM_CHAT_ID` in `.env`

### Request Body Limits

| Path | Limit |
|------|-------|
| `/api/ohlcv/batch` | 50 MB |
| `/api/ohlcv/:symbol` | 10 MB |
| All other routes | 1 MB |

### Security Middleware

- **Helmet** — HTTP security headers
- **Rate limiting** — via `express-rate-limit`
- **CORS** — Origin-based access control
- **JWT authentication** — All API routes except public endpoints
- **RBAC** — Role-based (ADMIN/USER) with module-level permissions (CHART, SIGNAL, REPORT, TRADING, ENGINE)

---

## 13. Backup & Recovery

### Current Strategy: Manual Local Backups

Full documentation: `docs/hourly-db-backup.md`

#### Quick Backup

```bash
docker exec binance-timescaledb sh -c \
  "pg_dump -U postgres -d binance_trade -Fc -f /tmp/binance_trade.dump"
docker cp binance-timescaledb:/tmp/binance_trade.dump \
  ./backups/postgres/binance_trade_$(date -u +%Y%m%dT%H%M%SZ).dump
```

#### Quick Restore

```bash
docker cp ./backups/postgres/binance_trade.dump binance-timescaledb:/tmp/binance_trade.dump
docker exec binance-timescaledb sh -c "dropdb -U postgres --if-exists binance_trade"
docker exec binance-timescaledb sh -c "createdb -U postgres binance_trade"
docker exec binance-timescaledb sh -c \
  "pg_restore -U postgres -d binance_trade --clean --if-exists /tmp/binance_trade.dump"

# Post-restore
npx prisma generate
npx prisma migrate deploy
```

#### Schema-Only Snapshot

```bash
docker exec binance-timescaledb sh -c \
  "pg_dump -U postgres -d binance_trade --schema-only -f /tmp/binance_trade_schema.sql"
docker cp binance-timescaledb:/tmp/binance_trade_schema.sql ./backups/postgres/
```

#### Validation

```bash
docker exec binance-timescaledb sh -c "pg_restore --list /tmp/binance_trade.dump > /dev/null"
```

### Volume Backup (Alternative)

Since data lives in Docker named volumes, you can also back up volumes directly:

```bash
docker run --rm -v timescaledb_data:/data -v $(pwd)/backups:/backup \
  alpine tar czf /backup/timescaledb_data.tar.gz -C /data .
```

### External Signal DB Backup

Same approach, using `binance-external-signal-db` container and `external_signal` database:

```bash
docker exec binance-external-signal-db sh -c \
  "pg_dump -U postgres -d external_signal -Fc -f /tmp/external_signal.dump"
docker cp binance-external-signal-db:/tmp/external_signal.dump ./backups/postgres/
```

### No Automated Backup System

There is no active cron job, systemd timer, or CI-based backup. Backups are manual.

---

## 14. Dependencies

### Backend — Key Runtime Dependencies

| Package | Version | Role |
|---------|---------|------|
| `express` | ^5.2.1 | HTTP server framework (Express 5) |
| `@prisma/client` | ^6.19.2 | Database ORM client |
| `bullmq` | ^5.1.9 | Redis-backed job queues for async workers |
| `ioredis` | ^5.3.2 | Redis client (BullMQ, pub/sub, Socket.IO) |
| `socket.io` | ^4.8.3 | Real-time WebSocket server |
| `socket.io-client` | ^4.8.3 | Socket.IO client (internal connections) |
| `helmet` | ^8.1.0 | HTTP security headers |
| `express-rate-limit` | ^8.3.1 | API rate limiting |
| `cors` | ^2.8.6 | Cross-origin resource sharing |
| `dotenv` | ^16.3.1 | Environment variable loading |
| `axios` | ^1.6.5 | HTTP client (MT5 bridge communication) |
| `ws` | ^8.16.0 | WebSocket library |

### Backend — Key Dev Dependencies

| Package | Version | Role |
|---------|---------|------|
| `typescript` | ^5.3.3 | TypeScript compiler |
| `ts-node` | ^10.9.2 | TypeScript execution for development |
| `prisma` | ^6.19.2 | Prisma CLI (migrations, generate) |
| `@types/node` | ^20.11.0 | Node.js type definitions |

### Frontend — Key Dependencies

| Package | Role |
|---------|------|
| `next` | Next.js 16 framework |
| `react` / `react-dom` | React 19 |
| `@tanstack/react-query` | Server state management |
| `@radix-ui/*` | UI primitives (dialog, dropdown, popover, select, tabs, tooltip, scroll-area) |
| `lightweight-charts` | TradingView-style price charts |
| `framer-motion` | Animations |
| `axios` | HTTP client |
| `clsx` | Conditional CSS class names |
| `lucide-react` | Icon set |
| `luxon` | Date/time handling |
| `geist` | Font family |

### MT5 Service — Python Dependencies

File: `mt5-service/requirements.txt`

| Package | Version | Role |
|---------|---------|------|
| `MetaTrader5` | >=5.0.45 | MT5 terminal API bindings (Windows only) |
| `requests` | >=2.31.0 | HTTP client for pushing data to backend |
| `APScheduler` | >=3.10.4 | Scheduled job execution |
| `python-dotenv` | >=1.0.0 | Environment variable loading |
| `pandas` | >=2.0.0 | Data manipulation for OHLCV |
| `pytz` | >=2024.1 | Timezone handling |
| `PyYAML` | >=6.0.1 | Configuration file parsing |

### MT5 Service Configuration

File: `mt5-service/config.yaml`

```yaml
broker_timezone: "Etc/GMT-3"       # Exness summer: GMT+3
fetch_workers: 4                    # Parallel MT5 fetch workers
live_interval_seconds: 10           # Live poll interval
live_fetch_bars_per_timeframe: 3    # Bars fetched per poll
historical_days: 30                 # Full sync lookback
retry_max_attempts: 3
retry_buffer_size: 1000

timeframes: [M1, M5, M15, M30, H1, H2, H3, H4, H12, D1, W1, MN1]

symbols:
  - mt5: "XAUUSDc"   tv: "XAUUSD"   market: "metal"    enabled: true
  - mt5: "XAGUSDc"   tv: "XAGUSD"   market: "metal"    enabled: true
  - mt5: "BTCUSDc"   tv: "BTCUSD"   market: "crypto"   enabled: true
```

---

## Appendix: Full Disaster Recovery Checklist

### From-Scratch Rebuild

1. **Install prerequisites:** Node.js 20+, Docker, Python 3.10+ (on Windows for MT5)
2. **Clone the repository**
3. **Start infrastructure:**
   ```bash
   docker compose up -d
   ```
4. **Install dependencies:**
   ```bash
   npm install
   npm --prefix web install
   ```
5. **Configure environment:**
   - Copy `.env.release-cut.example` to `.env`
   - Set `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `AUTH_BOOTSTRAP_ADMIN_PASSWORD`, `INGESTION_TOKEN`
   - Set `ENCRYPTION_KEY` (32+ chars) if trading features needed
   - Set `EXTERNAL_SIGNAL_DB_URL` if Telegram output needed
   - Configure `web/.env.local` with API/Socket URLs
6. **Apply database migrations:**
   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```
7. **Restore database backup** (if available):
   ```bash
   docker cp backup.dump binance-timescaledb:/tmp/
   docker exec binance-timescaledb sh -c \
     "pg_restore -U postgres -d binance_trade --clean --if-exists /tmp/backup.dump"
   npx prisma migrate deploy   # apply any newer migrations
   ```
8. **Start all processes** (see section 10)
9. **Configure Cloudflare tunnel** (if remote access needed)
10. **Set up MT5 bridge** on Windows machine(s)
11. **Verify:**
    - API responds at `:3001`
    - Frontend loads at `:5001`
    - Admin monitoring dashboard shows healthy status
    - Data ingestion flowing from MT5
