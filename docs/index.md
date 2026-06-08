# Project Documentation Index — TV-GIT

_Generated: 2026-04-16 | Deep Scan | Multi-part (3 parts)_

---

## Project Overview

- **Type:** Multi-part (Backend + Frontend + MT5 Bridge)
- **Primary Language:** TypeScript (Backend/Frontend), Python (MT5 Bridge)
- **Architecture:** Service-oriented + event-driven workers + real-time WebSocket
- **Domain:** Trading automation — signal generation, backtesting, live MT5 execution

## Quick Reference

### Backend API (root/)
- **Tech Stack:** Express.js 5.2.1, TypeScript 5.3.3, Prisma 6.19.2, BullMQ 5.1.9, Socket.IO 4.8.3
- **Entry Point:** `src/main.ts` → `src/server.ts` (ApiServer class)
- **Architecture:** Route → Handler Factory → Service (constructor-injected Prisma)
- **Port:** :3001

### Frontend Dashboard (web/)
- **Tech Stack:** Next.js 16.1.6, React 19.2.3, Zustand 5.0.11, Radix UI, Tailwind CSS 4
- **Entry Point:** `web/src/app/layout.tsx` → Providers → AppChrome
- **Architecture:** App Router, 21 pages, 78 components, 6 Zustand stores
- **Port:** :5001

### MT5 Bridge (mt5-service/)
- **Tech Stack:** Python 3.x, MetaTrader5 ≥5.0.45, APScheduler
- **Entry Points:** `main.py` (market data :8765), `trade_exec_main.py` (execution :8766)
- **Architecture:** Thread-safe HTTP bridge, scheduled sync + live collection

---

## Generated Documentation

- [Project Overview](./project-overview.md) — Executive summary, tech stack, architecture
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory structure
- [API Contracts — Backend](./api-contracts-backend.md) — All REST + Bridge endpoints
- [Data Models — Backend](./data-models-backend.md) — 29 Prisma models, enums, relationships
- [Integration Architecture](./integration-architecture.md) — How parts communicate, data flow
- [Component Inventory — Frontend](./component-inventory-frontend.md) — 78 components, 22 hooks, 6 stores
- [Development Guide](./development-guide.md) — Setup, commands, testing, feature flags
- [Architecture — Backend](./architecture-backend.md) _(To be generated)_
- [Architecture — Frontend](./architecture-frontend.md) _(To be generated)_
- [Architecture — MT5 Bridge](./architecture-mt5-bridge.md) _(To be generated)_

---

## Existing Documentation

### Architecture Series (docs/)
- [01 — Database Schema](./01-database-schema.md) — Table definitions and relationships
- [02 — Signal System](./02-signal-system.md) — Signal lifecycle and definitions
- [03 — Trading System](./03-trading-system.md) — Trading automation architecture
- [04 — API Routes](./04-api-routes.md) — Endpoint documentation
- [05 — Auth & Security](./05-auth-security.md) — JWT, RBAC, encryption
- [06 — Realtime & Workers](./06-realtime-workers.md) — Socket.IO, BullMQ workers
- [07 — MT5 Bridge](./07-mt5-bridge.md) — Python bridge architecture
- [08 — Frontend Dashboard](./08-frontend-dashboard.md) — Next.js frontend
- [09 — Infrastructure](./09-infrastructure.md) — Docker, TimescaleDB, Redis
- [10 — Scripts & Tools](./10-scripts-tools.md) — CLI scripts and utilities

### Operational Guides
- [Database Schema Inventory](./database-schema-inventory.md) — Live schema reference
- [New Dev Setup](./new-dev-setup.md) — Onboarding guide
- [User Guide](./user-guide.md) — End-user documentation
- [Hourly DB Backup](./hourly-db-backup.md) — Backup procedures
- [Trading Execution Logging](./trading-execution-logging.md) — Execution log format
- [MT5 Execution Troubleshooting](./mt5-execution-troubleshooting.md) — Debug guide
- [API Security Hardening (2026-03-11)](./api-security-hardening-2026-03-11.md) — Security audit

### Feature Specs
- [External Action Signal Architecture](./external-action-signal-architecture.md)
- [Actionable Live Signal Event Brief](./actionable-live-signal-event-feature-brief.md)
- [UI Gap Map: Signal to Telegram](./ui-gap-map-signal-to-telegram.md)
- [Backtest Logic — XAU](./logic-backtest-xau.md)

### Design Specs (docs/superpowers/specs/)
- Timeframe Optimization Design (2026-03-20)
- XAU M5 Portfolio Improvement Design (2026-03-20)
- XAU Portfolio Optimization Pipeline (2026-03-20)

### Disaster Recovery (docs-disaster-recovery/)
- Complete DR documentation series (01-10 + README)

### Migration Guide
- [Chuyển sang máy mới an toàn](./chuyen-sang-may-moi-an-toan.md)

---

## Getting Started

1. `docker compose up -d` — Start TimescaleDB + Redis
2. `npm install && npx prisma generate && npx prisma migrate deploy`
3. `npm run dev` — Backend on :3001
4. `npm --prefix web install && npm --prefix web run dev` — Frontend on :5001
5. Start workers in separate terminals (see [Development Guide](./development-guide.md))

For MT5 bridge setup, see [07 — MT5 Bridge](./07-mt5-bridge.md).
