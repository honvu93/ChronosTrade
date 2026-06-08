# Local Run Guide

## Services Overview

| Service | URL | Container |
|---------|-----|-----------|
| Backend API | http://localhost:3001 | — |
| Frontend | http://localhost:5001 | — |
| TimescaleDB | 127.0.0.1:5433 | `binance-timescaledb` |
| External Signal DB | 127.0.0.1:5434 | `binance-external-signal-db` |
| Redis | 127.0.0.1:6379 | `binance-redis` |
| MT5 Bridge (read) | localhost:8765 | — |
| MT5 Bridge (exec) | localhost:8766 | — |

Public access (via Cloudflare tunnel):

| Hostname | Target |
|----------|--------|
| https://trade.your-domain.com | Frontend :5001 |
| https://trade-api.your-domain.com | Backend :3001 |

## Quick Start — `trade-dev`

One command to start the entire stack. Add this alias to your shell profile (e.g., `~/.zshrc`):

```bash
alias trade-dev='./trade-dev'
```

```bash
trade-dev                 # BE + FE only
trade-dev --with-tunnel   # BE + FE + Cloudflare tunnel
trade-dev --skip-infra    # skip docker compose (DB/Redis already running)
```

Stops existing BE/FE/tunnel processes before starting new ones. `Ctrl+C` kills all.

## Manual Setup

### 1. Infrastructure

```bash
docker compose up -d
```

Docker Compose starts 3 containers:

- **binance-timescaledb** — TimescaleDB (main DB: candles, signals, backtests, trading, users)
- **binance-external-signal-db** — PostgreSQL (external signal deployments: Telegram, webhooks)
- **binance-redis** — Redis (BullMQ queues, Socket.IO adapter, pub/sub)

Verify:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

### 2. Environment

Backend `.env` (key variables):

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
EXTERNAL_SIGNAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:5434/external_signal?schema=public"
REDIS_URL="redis://localhost:6379"
NODE_ENV="development"
MT5_BRIDGE_PORT="8765"
MT5_EXEC_BRIDGE_PORT="8766"
# + JWT_SECRET, ENCRYPTION_KEY, INGESTION_TOKEN, AUTH_BOOTSTRAP_ADMIN_PASSWORD
# + ALERT_TELEGRAM_BOT_TOKEN, ALERT_TELEGRAM_CHAT_ID
# + BINANCE_API_URL, BINANCE_WS_URL
# + TRADING_WEBHOOK_ALLOWED_HOSTS
# + FEATURE_TRADING_READ
```

Frontend `web/.env.local`:

```env
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_SOCKET_URL=
```

Empty values = browser uses same origin (required for Cloudflare tunnel). For local-only dev, set both to `http://localhost:3001`.

### 3. Install & Prepare

```bash
npm install
npm --prefix web install
npx prisma generate
npx prisma migrate deploy
```

### 4. Start Backend

```bash
npm run dev                           # API server on :3001
```

Health check:

```bash
curl http://localhost:3001/health
```

### 5. Start Frontend

```bash
npm --prefix web run dev              # Next.js on :5001
```

### 6. Workers (separate terminals)

```bash
npm run dev:trading:auto-worker           # Trade intent auto-execution (BullMQ)
npm run dev:trading:reconciliation-worker # Broker position sync
npm run dev:external-action:worker        # Telegram/webhook delivery
npm run dev:backtest:worker               # Backtest execution queue
```

Telegram signal delivery worker:

```bash
npm run dev:external-action:worker
```

### 7. MT5 Bridge (optional)

Only needed for live trading or MT5 data ingestion:

```bash
cd mt5-service
pip install -r requirements.txt
python main.py            # Data bridge on :8765
python trade_exec_main.py # Execution bridge on :8766
```

Configured symbols (`mt5-service/config.yaml`):
- XAUUSDc (Gold)
- XAGUSDc (Silver)
- BTCUSDc (Bitcoin)

Supported timeframes: M1, M5, M15, M30, H1, H2, H3, H4, H12, D1, W1, MN1

## Useful Scripts

### Smoke Tests

```bash
npm run smoke:signals-platform         # Signal platform smoke test
npm run smoke:signals-batch            # Signal batch preview smoke test
npm run test:trading:backend           # Trading backend unit tests
npm --prefix web run test:e2e          # Playwright E2E tests
```

### Data & Sync

```bash
npm run audit:candles:htf              # Audit higher-timeframe candle gaps
npx ts-node src/scripts/checkSyncStatus.ts   # Check MT5 data sync status
npx ts-node src/scripts/checkLastCandle.ts   # Check latest candle timestamps
```

### Backtesting

```bash
npm run backtest:artifact:list         # List available backtest targets
npx ts-node src/scripts/runBatchBacktest.ts  # Batch backtest runner
```

XAU optimization batches:

```bash
npm run xau:abc:all                    # Run all XAU ABC optimization batches
npm run xau:abc:b1                     # B1: ATR sweep
npm run xau:abc:b2                     # B2: RSI sweep
npm run xau:abc:b3                     # B3: Session slices
npm run xau:abc:b4                     # B4: Stop geometry
npm run xau:abc:b5                     # B5: Regime gate
npm run xau:abc:b6                     # B6: Exit sweep
npm run xau:abc:report                 # Render optimization report
```

XAU new logic strategies:

```bash
npm run xau:new:l1                     # L1: Asian retest
npm run xau:new:l2                     # L2: NY BOS
npm run xau:new:l3                     # L3: PDM break
npm run xau:new:l4                     # L4: PDH break
npm run xau:new:l5                     # L5: Smart trail M5
```

### Seeding

```bash
npm run seed:engine                    # Seed engine demo data
npm run seed:signals                   # Seed signal definitions (via package.json alias)
npx ts-node src/scripts/seedTier1ComposedSignals.ts  # Seed tier-1 composed signals
```

### Paper Trading Setup

```bash
npx ts-node src/scripts/setupGoLivePaper.ts
npx ts-node src/scripts/setupPaperTradeAsianBreak2H.ts
npx ts-node src/scripts/setupPaperTradePdLevel4H.ts
```

### Build

```bash
npm run build                          # TypeScript compile to dist/
npm --prefix web run build             # Next.js production build
npm --prefix web run lint              # ESLint
```

## Database

```bash
# DB shell
docker exec -it binance-timescaledb psql -U postgres -d binance_trade

# External signal DB shell
docker exec -it binance-external-signal-db psql -U postgres -d external_signal

# Visual browser
npx prisma studio

# Create migration
npx prisma migrate dev --name <name>
```

## Project Layout

```
ChronosTrade/
  src/
    main.ts                  backend entry point
    server.ts                ApiServer class (Express + Socket.IO)
    routes/                  REST endpoint registrations
    services/
      signals/               signal definitions, backtesting, blocks, optimization
      trading/               accounts, automation, execution, MT5 bridge, reconciliation
      trading/externalAction/ Telegram/webhook signal deployments
      auth/                  JWT auth, RBAC, passwords
      admin/                 monitoring, sync alerts
    workers/                 BullMQ worker entry points (4 workers)
    scripts/                 CLI scripts (~148 files: backtests, optimization, seeding, etc.)
    middleware/              auth, feature flags
    utils/                   symbol normalization, CORS, timeframes
    queues/                  BullMQ queue definitions
  web/
    src/app/                 Next.js 16 app router pages
    src/components/          React components (Radix + Tailwind CSS 4)
    src/store/               Zustand stores
    src/lib/                 utilities, translations, view models
    src/hooks/               custom React hooks
    src/types/               TypeScript type definitions
  prisma/                    schema and migrations
  mt5-service/               Python MT5 bridge (data + execution)
  dist/                      compiled backend output
  .artifacts/                backtest results and optimization artifacts
  docs/                      project documentation
  trade-dev                  dev startup script
  cloudflared-config.yml     Cloudflare tunnel routing
```

## Troubleshooting

### Database connection error

```bash
rm -rf node_modules/.prisma
npx prisma generate
```

Check that Docker is running and `DATABASE_URL` points to `127.0.0.1:5433`.

### Frontend cannot reach API

- Backend must be running on `:3001`
- For local dev: set `NEXT_PUBLIC_API_URL=http://localhost:3001` in `web/.env.local`
- For tunnel: leave both `NEXT_PUBLIC_*` values empty

### Cloudflare tunnel fails

- Confirm `cloudflared` is installed
- Verify credentials file exists: `~/.cloudflared/<YOUR_TUNNEL_ID>.json`
- Config: `cloudflared-config.yml` in repo root

### Docker logs

```bash
docker compose logs -f
docker compose down               # stop all containers
```
