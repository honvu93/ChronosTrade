# New Developer Setup

## Purpose

This guide is for a developer joining the project or setting it up on a new machine from scratch.

It reflects the current active workflow of this repository:

- local-first development
- Docker only for PostgreSQL/TimescaleDB and Redis
- backend started directly with `npm run dev`
- frontend started from `web/` with `npm run dev`
- optional MT5 Python services for trading integration

If you are moving an existing working machine with database state, env files, MT5 state, or uncommitted changes, use [docs/chuyen-sang-may-moi-an-toan.md](./chuyen-sang-may-moi-an-toan.md) instead.

Use this document only when you want a fresh setup.

Quick decision guide:

- Fresh setup with empty or known snapshot DB: stay in this document
- Migrate your current working machine to another machine: use [docs/chuyen-sang-may-moi-an-toan.md](./chuyen-sang-may-moi-an-toan.md)
- Need to preserve current local data exactly as-is: use [docs/chuyen-sang-may-moi-an-toan.md](./chuyen-sang-may-moi-an-toan.md)

## 1. Prerequisites

Install these tools first:

| Tool | Recommended Version | Notes |
| --- | --- | --- |
| Node.js | 20+ | The current machine is using Node 24, but Node 20+ is the safe project baseline. |
| Docker Desktop | Recent stable | Needed for local PostgreSQL/TimescaleDB and Redis. |
| Git | Any recent version | Required for cloning and branch work. |
| Python | 3.11+ | Only required if you need `mt5-service`. |

Verify:

```bash
node --version
docker --version
git --version
python --version
```

## 2. Clone the Repository

```bash
git clone https://github.com/honvu93/ChronosTrade.git new-tv-trade
cd new-tv-trade
```

Check out the branch you actually need for development.

Do not assume an older onboarding branch is still the correct one.

## 3. Prepare Environment Files

Some runtime values are stored in untracked local files.

### Required local files

| File | Location |
| --- | --- |
| `.env` | repo root |
| `web/.env.local` | `web/` |
| `mt5-service/.env` | `mt5-service/` if MT5 integration is needed |
| `mt5-service/config.yaml` | `mt5-service/` if MT5 integration is needed |

### Backend `.env`

Minimum local values:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
REDIS_URL="redis://localhost:6379"
NODE_ENV="development"
FEATURE_TRADING_READ=true
MT5_BRIDGE_PORT="8765"
MT5_EXEC_BRIDGE_PORT="8766"
BINANCE_API_URL="https://api.binance.us"
BINANCE_WS_URL="wss://stream.binance.us:9443/stream"
INGESTION_TOKEN="..."
ENCRYPTION_KEY="..."
JWT_SECRET="..."
AUTH_BOOTSTRAP_ADMIN_PASSWORD="..."
```

Use the real secret values supplied by the project owner or copied from your existing working machine.

### Frontend `web/.env.local`

Recommended local values:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

Important:

- The frontend dev server itself runs on `http://localhost:5001`.
- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` must point to the backend, not to the frontend.

### MT5 service environment

Only needed if you use MT5 integration:

```env
MT5_LOGIN=...
MT5_PASSWORD=...
MT5_SERVER=...
TVGIT_URL=http://localhost:3001
INGESTION_TOKEN=...
```

## 4. Start Local Infrastructure

From the repo root:

```bash
docker compose up -d
```

Verify:

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
```

Expected containers:

- `binance-timescaledb`
- `binance-redis`

Ports:

- PostgreSQL/TimescaleDB: `127.0.0.1:5433`
- Redis: `127.0.0.1:6379`

## 5. Install Dependencies

Backend:

```bash
npm install
```

Frontend:

```bash
npm --prefix web install
```

## 6. Prepare the Database

Generate Prisma client first:

```bash
npx prisma generate
```

### Option A: Start from the current local DB state

If the running Docker volume already contains the expected local data, apply migrations safely:

```bash
npx prisma migrate deploy
```

### Option B: Restore from the repository dump

If you need the known snapshot stored in the repo:

```bash
docker cp db/binance_trade.dump binance-timescaledb:/tmp/binance_trade.dump
docker exec binance-timescaledb sh -c "dropdb -U postgres --if-exists binance_trade"
docker exec binance-timescaledb sh -c "createdb -U postgres binance_trade"
docker exec binance-timescaledb sh -c "pg_restore -U postgres -d binance_trade --clean --if-exists /tmp/binance_trade.dump"
npx prisma generate
npx prisma migrate deploy
```

Quick data check:

```bash
docker exec binance-timescaledb psql -U postgres -d binance_trade -c "select count(*) from price_candles;"
```

## 7. Start the Backend

```bash
npm run dev
```

The backend listens on:

- `http://localhost:3001`

Useful checks:

```bash
curl http://localhost:3001/health
```

## 8. Start the Frontend

In a separate terminal:

```bash
npm --prefix web run dev
```

The frontend dev server listens on:

- `http://localhost:5001`

The frontend also includes local rewrites in `web/next.config.ts` so `/api/*` and `/socket.io/*` resolve to `http://127.0.0.1:3001`.

## 9. Optional Trading Workers

If you are working on trading automation, start the workers in separate terminals:

```bash
npm run dev:trading:auto-worker
```

```bash
npm run dev:trading:reconciliation-worker
```

## 10. Optional MT5 Services

`mt5-service` is only needed for MT5 bridge and execution work.

Install Python dependencies:

```bash
cd mt5-service
pip install -r requirements.txt
```

The recommended split is:

- `main.py` for market data bridge
- `trade_exec_main.py` for execution bridge

Expected local backend ports:

- market-data bridge: `8765`
- execution bridge: `8766`

## 11. Verification Checklist

Backend:

```bash
curl http://localhost:3001/health
```

Frontend:

- open `http://localhost:5001`

Database:

```bash
docker exec binance-timescaledb psql -U postgres -d binance_trade -c "\dt"
```

Workers:

- check terminal logs if you started any trading workers

## 12. Common Problems

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `prisma: Can't reach database` | Docker is not running or `DATABASE_URL` is wrong | Start Docker and confirm `127.0.0.1:5433` |
| Frontend cannot call the API | `NEXT_PUBLIC_API_URL` points to the wrong port | Use `http://localhost:3001` |
| Frontend loads but realtime features do not connect | `NEXT_PUBLIC_SOCKET_URL` points to the wrong port | Use `http://localhost:3001` |
| Prisma protocol mismatch mentions `prisma://` | Stale generated Prisma client | Delete `node_modules/.prisma` and run `npx prisma generate` |
| MT5 readiness fails | MT5 bridge is not running or wrong bridge port is configured | Check ports `8765` and `8766` |

## 13. Important Paths

```text
new-tv-trade/
  src/                  backend TypeScript source
  web/                  Next.js frontend
  prisma/               schema and migrations
  db/                   repository dump snapshot
  mt5-service/          Python MT5 bridge services
  docs/                 active project documentation
  infrastructure/       legacy and deployment-oriented scripts
```

## Summary

The current setup order is:

1. create local env files
2. `docker compose up -d`
3. `npm install`
4. `npm --prefix web install`
5. `npx prisma generate`
6. `npx prisma migrate deploy`
7. `npm run dev`
8. `npm --prefix web run dev`
9. optionally start trading workers and MT5 services
