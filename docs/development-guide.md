# Development Guide

_Generated: 2026-04-16 | Deep Scan_

---

## Prerequisites

- **Node.js** — LTS version
- **Python 3.x** — For MT5 bridge (Windows or Wine required for MetaTrader5)
- **Docker & Docker Compose** — For databases and Redis
- **Git** — Version control

## Quick Start

### 1. Infrastructure

```bash
docker compose up -d    # TimescaleDB (:5433), External DB (:5434), Redis (:6379)
```

### 2. Backend

```bash
npm install
cp .env.example .env              # Configure DATABASE_URL, REDIS_URL, JWT_SECRET, etc.
npx prisma generate               # Generate Prisma client
npx prisma migrate deploy         # Apply migrations
npm run dev                       # Start API server on :3001
```

### 3. Frontend

```bash
npm --prefix web install
# web/.env.local should have NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SOCKET_URL → :3001
npm --prefix web run dev          # Start Next.js on :5001
```

### 4. Workers (separate terminals)

```bash
npm run dev:trading:auto-worker           # Trade intent execution
npm run dev:trading:reconciliation-worker # Broker position sync
npm run dev:external-action:worker        # Telegram/webhook delivery
npm run dev:backtest:worker               # Async backtest execution
```

### 5. MT5 Bridge (optional, Windows/Wine)

```bash
pip install -r mt5-service/requirements.txt
cp mt5-service/.env.example mt5-service/.env  # MT5 credentials
python mt5-service/main.py                     # Market data bridge (:8765)
python mt5-service/trade_exec_main.py          # Execution bridge (:8766)
```

## Environment Files

| File | Purpose |
|---|---|
| `.env` | Backend: DATABASE_URL, REDIS_URL, JWT_SECRET, ENCRYPTION_KEY, INGESTION_TOKEN, FEATURE_TRADING_* |
| `web/.env.local` | Frontend: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SOCKET_URL (both → :3001) |
| `mt5-service/.env` | MT5: MT5_LOGIN, MT5_PASSWORD, MT5_SERVER, MT5_TERMINAL_PATH |

## Port Map

| Service | Port | Description |
|---|---|---|
| Backend API | 3001 | Express.js + Socket.IO |
| Frontend | 5001 | Next.js dev server |
| TimescaleDB | 5433 | Main database |
| External Signal DB | 5434 | External deployments |
| Redis | 6379 | Cache, queues, pub/sub |
| MT5 Bridge (read) | 8765 | Market data + account info |
| MT5 Bridge (exec) | 8766 | Order execution |

## Build & Test Commands

```bash
# Build
npm run build                             # TypeScript → dist/
npm --prefix web run build                # Next.js production build

# Test
npm run test:trading:backend              # Backend test suite (node:test)
npm --prefix web run test:e2e             # Playwright E2E
npm --prefix web run test:unit            # Frontend unit tests

# Run single test
node -r ts-node/register -e "require('./src/path/to/file.test.ts')"

# Smoke tests
npm run smoke:signals-platform
npm run smoke:signals-batch

# Lint
npm --prefix web run lint                 # ESLint (frontend only)
```

## Database Operations

```bash
npx prisma migrate dev --name <name>      # Create new migration
npx prisma migrate deploy                 # Apply pending migrations
npx prisma studio                         # Visual DB browser
npx prisma generate                       # Regenerate client after schema changes
npm run audit:candles:htf                  # Audit higher-timeframe candle data
```

**Critical:** Always backup DB before any migration. See `docs/hourly-db-backup.md`.

## Seeding

```bash
npm run seed:engine                       # Seed engine configuration
npm run seed:signals                      # Seed signal definitions
```

## Backtest Scripts

Scripts in `src/scripts/` accept CLI flags: `--group`, `--out`, `--dir`, `--logic`, `--target`.

```bash
ts-node src/scripts/runBatchBacktest.ts
ts-node src/scripts/runArtifactBacktests.ts --list-targets
ts-node src/scripts/runArtifactBacktests.ts --target xau-new-base --logic all --out .artifacts/output.json
```

Artifacts written to `.artifacts/` directory.

## Feature Flags

| Flag | Values | Description |
|---|---|---|
| `FEATURE_TRADING_READ` | true/false | Enable trading read operations |
| `FEATURE_TRADING_WRITE` | true/false | Enable trading write operations |
| `FEATURE_TRADING_AUTO` | true/false | Enable auto-execution |

**Modes:** OBSERVE (read only) → MANUAL_APPROVAL (human gate) → AUTO_EXECUTE (full auto)

## Testing Conventions

- **Framework:** `node:test` (NOT Jest/Vitest)
- **Assertions:** `node:assert/strict`
- **Co-located:** Test files next to source (`Foo.ts` → `Foo.test.ts`)
- **Mocking:** Manual (no mocking library)
- **TDD:** Red → Green → Refactor
- **DB tests:** Use real database, no mocks
