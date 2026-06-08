# TV-GIT — Project Overview

_Generated: 2026-04-16 | Deep Scan_

---

## Executive Summary

TV-GIT is a trading automation platform that spans the full lifecycle from market data collection through signal generation, backtesting, and live broker execution via MetaTrader 5. The system supports real-time monitoring, paper trading, and external delivery (Telegram/webhooks).

## Repository Structure

**Type:** Multi-part (3 parts in 1 repository)

| Part | Root | Type | Primary Tech |
|---|---|---|---|
| Backend API + Workers | `/` (root) | Web + Backend hybrid | Express.js 5, TypeScript 5.3, Prisma 6 |
| Frontend Dashboard | `web/` | Web | Next.js 16, React 19, Zustand 5 |
| MT5 Bridge | `mt5-service/` | Backend (Python) | MetaTrader5, APScheduler |

## Technology Stack Summary

### Backend
- **Express.js 5.2.1** — REST API + middleware pipeline
- **TypeScript 5.3.3** — Strict mode, ES2020, CommonJS
- **Prisma 6.19.2** — ORM, PostgreSQL provider, 29 models
- **BullMQ 5.1.9** — 4 async worker types
- **Socket.IO 4.8.3** — Real-time with Redis adapter
- **Helmet 8.1.0 + express-rate-limit 8.3.1** — Security

### Frontend
- **Next.js 16.1.6** — App Router, Turbopack
- **React 19.2.3** — Server + Client components
- **Zustand 5.0.11** — 6 stores
- **TanStack React Query 5.90.21** — Server state
- **Radix UI + Tailwind CSS 4** — Component library
- **Lightweight Charts 5.1.0** — Price charts
- **Playwright 1.50.0** — E2E testing

### MT5 Bridge
- **Python 3.x** — MetaTrader5 ≥5.0.45
- **APScheduler** — Recurring jobs
- **Thread-safe** — Lock-serialized MT5 calls
- **Dual process** — Market data (:8765) + Execution (:8766)

### Infrastructure
- **TimescaleDB** (PostgreSQL 16) — Main DB on :5433
- **PostgreSQL 16 Alpine** — External signal DB on :5434
- **Redis 7 Alpine** — Cache, queues, pub/sub on :6379
- **Docker Compose 3.8** — Local orchestration

## Architecture Classification

**Pattern:** Service-oriented + event-driven workers

**Signal Lifecycle:**
```
SignalDefinition → BacktestRun → IndicatorInstance (live)
→ SignalEvent → TradingTradeIntent → TradingExecutionCommand
→ MT5 Bridge → TradingReconciliation
```

**Trading Modes:**
- OBSERVE — Signal monitoring only
- MANUAL_APPROVAL — Human gate before execution
- AUTO_EXECUTE — Full automation

## Links to Detailed Documentation

- [Architecture — Backend](./architecture-backend.md)
- [Architecture — Frontend](./architecture-frontend.md)
- [Architecture — MT5 Bridge](./architecture-mt5-bridge.md)
- [API Contracts — Backend](./api-contracts-backend.md)
- [Data Models — Backend](./data-models-backend.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Development Guide](./development-guide.md)
- [Integration Architecture](./integration-architecture.md)
- [Component Inventory — Frontend](./component-inventory-frontend.md)
