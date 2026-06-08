# Project Documentation — Disaster Recovery Reference

This documentation set is designed to be **comprehensive enough to rebuild the entire trading platform from scratch** in case of complete code loss. Each module document covers architecture, data models, business rules, constants, and implementation details.

**Total: ~10,500 lines across 10 modules.**

Generated: 2026-04-14

---

## System Architecture Overview

```
                         ┌─────────────────────────────────┐
                         │        Cloudflare Tunnel         │
                         └──────────┬──────────────────────┘
                                    │
                         ┌──────────▼──────────────────────┐
                         │   API Server (Express :3001)     │
                         │   REST + Socket.IO real-time     │
                         │   JWT Auth + RBAC + Feature Flags│
                         └──┬────────┬────────┬────────────┘
                            │        │        │
              ┌─────────────▼─┐  ┌───▼────┐  ┌▼──────────────────┐
              │  TimescaleDB   │  │ Redis  │  │  Next.js Frontend  │
              │  :5433 (main)  │  │ :6379  │  │  :5001 (dashboard) │
              └────────────────┘  └───┬────┘  └────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────────┐
                    │                 │                     │
              ┌─────▼──────┐  ┌──────▼───────┐  ┌─────────▼────────┐
              │  BullMQ     │  │  BullMQ      │  │  BullMQ          │
              │  Backtest   │  │  Auto-Exec   │  │  External Action │
              │  Worker     │  │  Worker       │  │  Worker          │
              └─────────────┘  └──────────────┘  └──────────────────┘
                                      │
                              ┌───────▼────────┐
                              │  MT5 Bridge     │
                              │  Python         │
                              │  :8765 (read)   │
                              │  :8766 (exec)   │
                              └────────────────┘
                                      │
                              ┌───────▼────────┐
                              │  MetaTrader 5   │
                              │  Terminal       │
                              └────────────────┘
```

---

## Module Index

### Core Data Layer
| # | Document | Lines | Description |
|---|----------|-------|-------------|
| 01 | [Database Schema](01-database-schema.md) | 1,501 | All 30 Prisma models, 26 enums, indexes, relations, TimescaleDB hypertables, migration history |

### Backend Services
| # | Document | Lines | Description |
|---|----------|-------|-------------|
| 02 | [Signal System](02-signal-system.md) | 1,316 | Signal registry, 15 blocks, composed signal plugins, backtesting engine, optimization, indicator live runner |
| 03 | [Trading System](03-trading-system.md) | 1,085 | Account management, automation binding, trade intent pipeline, execution, MT5 bridge, reconciliation, quality assurance |
| 04 | [API Routes](04-api-routes.md) | 1,951 | All REST endpoints across 14 route files — auth, signals, trading, indicators, engine, monitoring |
| 05 | [Auth & Security](05-auth-security.md) | 776 | JWT, RBAC, scrypt passwords, AES-256-GCM credential encryption, rate limiting, feature flags |
| 06 | [Real-time & Workers](06-realtime-workers.md) | 727 | Socket.IO events/rooms, Redis pub/sub channels, 4 BullMQ workers, retry policies |

### External Services
| # | Document | Lines | Description |
|---|----------|-------|-------------|
| 07 | [MT5 Bridge](07-mt5-bridge.md) | 702 | Python bridge server, 12 HTTP endpoints, trade execution, historical data pipeline, gap repair |

### Frontend
| # | Document | Lines | Description |
|---|----------|-------|-------------|
| 08 | [Frontend Dashboard](08-frontend-dashboard.md) | 724 | Next.js 16 + React 19, 20 page routes, 6 Zustand stores, Socket.IO real-time, Lightweight Charts |

### Operations
| # | Document | Lines | Description |
|---|----------|-------|-------------|
| 09 | [Infrastructure](09-infrastructure.md) | 961 | Docker Compose, environment variables, Cloudflare tunnel, NPM scripts, deployment, disaster recovery checklist |
| 10 | [Scripts & CLI Tools](10-scripts-tools.md) | 824 | 120+ backtest/optimization scripts, data integrity checks, CLI flags, output formats |

---

## Signal Lifecycle (Cross-Module Reference)

The core data flow spans modules 02 → 03 → 06 → 07:

```
SignalDefinition (02)
  → BacktestRun (02: backtesting engine)
  → IndicatorInstance (02: live runner)
    → SignalEvent [13 stages] (02: TRAP→ENTRY→TP_HIT→EXPIRATION)
      → Socket.IO broadcast (06: indicator:events)
      → TradingTradeIntent (03: trade intent pipeline)
        → TradingExecutionCommand (03: execution service)
          → MT5 Bridge HTTP call (07: bridge_server.py)
            → MetaTrader 5 order placement
          → TradingReconciliation (03: reconciliation worker)
      → ExternalActionEvent (03: Telegram delivery)
        → External Action Worker (06: BullMQ)
          → Telegram Bot API
```

---

## Rebuild Order (Disaster Recovery)

If rebuilding from scratch, follow this order:

1. **Infrastructure** (doc 09) — Docker, databases, Redis, environment
2. **Database Schema** (doc 01) — Prisma schema, migrations, seed data
3. **Auth & Security** (doc 05) — JWT, user model, middleware
4. **Signal System** (doc 02) — Core domain logic
5. **Trading System** (doc 03) — Execution pipeline
6. **API Routes** (doc 04) — REST endpoints
7. **Real-time & Workers** (doc 06) — Socket.IO, BullMQ workers
8. **MT5 Bridge** (doc 07) — Python service
9. **Frontend** (doc 08) — Next.js dashboard
10. **Scripts** (doc 10) — CLI tools and batch runners

---

## Existing Project Documentation

These documents were created during development and contain additional context:

| Document | Description |
|----------|-------------|
| [new-dev-setup.md](new-dev-setup.md) | New developer onboarding guide |
| [chuyen-sang-may-moi-an-toan.md](chuyen-sang-may-moi-an-toan.md) | Server migration guide (Vietnamese) |
| [external-action-signal-architecture.md](external-action-signal-architecture.md) | External action/Telegram architecture design |
| [trading-worker.md](trading-worker.md) | Trading worker design notes |
| [logic-backtest-xau.md](logic-backtest-xau.md) | XAU backtesting logic documentation |
| [hourly-db-backup.md](hourly-db-backup.md) | Database backup schedule |
| [api-security-hardening-2026-03-11.md](api-security-hardening-2026-03-11.md) | API security hardening notes |
| [trading-execution-logging.md](trading-execution-logging.md) | Execution logging design |
| [mt5-execution-troubleshooting.md](mt5-execution-troubleshooting.md) | MT5 execution troubleshooting guide |
| [user-guide.md](user-guide.md) | End-user guide |
