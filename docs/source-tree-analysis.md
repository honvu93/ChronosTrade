# Source Tree Analysis

_Generated: 2026-04-16 | Deep Scan_

---

## Repository Root

```
lib-trade-latest/
├── src/                          # Backend API + Workers (TypeScript)
│   ├── main.ts                   # ★ Entry point: Prisma init, schema assert, ApiServer
│   ├── server.ts                 # ★ ApiServer class: Express, Socket.IO, Redis, routes
│   ├── routes/                   # REST API route registrations
│   │   ├── registerAuthRoutes.ts           # Auth: login, refresh, logout, users
│   │   ├── registerEngineRoutes.ts         # Engine analytics, leaderboards
│   │   ├── registerIndicatorRoutes.ts      # Indicator lifecycle, alerts
│   │   ├── registerMonitoringRoutes.ts     # Admin monitoring
│   │   ├── registerSignalRoutes.ts         # Signal definitions, backtests
│   │   ├── registerTradingAccountRoutes.ts # MT5 account CRUD
│   │   ├── registerTradingExportRoutes.ts  # Trade exports
│   │   ├── registerTradingExternalActionRoutes.ts # Webhooks, Telegram
│   │   ├── registerTradingIntegrationRoutes.ts    # External integrations
│   │   ├── registerTradingOperationsRoutes.ts     # Execution commands
│   │   └── registerTradingWorkspaceRoutes.ts      # Workspace, diagnosis
│   ├── services/                 # Business logic layer
│   │   ├── admin/                # MonitoringService, AlertDispatchService
│   │   ├── auth/                 # AuthUserService, sessions, passwords, RBAC
│   │   ├── signals/              # ★ Core signal system
│   │   │   ├── blocks/           # Composed signal block system
│   │   │   │   └── plugins/      # 15 TechIndicatorBlock plugins (ATR, EMA, RSI, SMC, etc.)
│   │   │   ├── SignalDefinitionService.ts
│   │   │   ├── SignalBacktestRunner.ts
│   │   │   ├── IndicatorLiveRunner.ts
│   │   │   ├── ComposedSignalService.ts
│   │   │   ├── SignalRegistry.ts
│   │   │   └── ... (20+ service files)
│   │   └── trading/              # ★ Core trading system
│   │       ├── TradingAccountService.ts
│   │       ├── TradingExecutionService.ts
│   │       ├── TradingAutoExecutionProcessor.ts
│   │       ├── TradingReconciliationProcessor.ts
│   │       ├── MT5BridgeClient.ts           # → calls mt5-service bridge
│   │       ├── MT5CredentialCipher.ts       # AES encryption
│   │       ├── tradingFeatureFlags.ts       # Feature flag snapshot builder
│   │       ├── externalAction/              # Telegram, webhooks, external DB
│   │       └── ... (20+ service files)
│   ├── middleware/               # Express middleware
│   │   ├── auth.ts               # JWT validation, user hydration, RBAC guards
│   │   └── featureFlag.ts        # Trading capability gating
│   ├── queues/                   # BullMQ queue definitions
│   │   ├── backtestExecutionQueue.ts
│   │   ├── tradingAutoExecutionQueue.ts
│   │   └── tradingReconciliationQueue.ts
│   ├── workers/                  # BullMQ worker entry points
│   │   ├── backtestExecutionWorker.ts
│   │   ├── tradingAutoExecutionWorker.ts
│   │   ├── tradingReconciliationWorker.ts
│   │   └── externalActionDeliveryWorker.ts
│   ├── utils/                    # Shared utilities
│   │   ├── symbols.ts            # Symbol normalization (MT5 ↔ TradingView)
│   │   ├── timeframes.ts         # Timeframe normalization
│   │   ├── corsConfig.ts         # CORS origins
│   │   ├── requestBodyLimits.ts  # Body size limits
│   │   ├── trustProxy.ts         # Proxy trust config
│   │   └── workerLogger.ts       # JSON worker logging
│   ├── database/                 # DB utilities, schema assertion
│   └── scripts/                  # CLI scripts (backtests, seeding, migrations)
│
├── web/                          # Frontend Dashboard (Next.js)
│   └── src/
│       ├── app/                  # ★ App Router pages (21 routes)
│       │   ├── page.tsx          # Home (Charts)
│       │   ├── layout.tsx        # Root layout: Providers → AppChrome
│       │   ├── login/            # Authentication
│       │   ├── trading/          # Trading workspace, history, paper dashboard
│       │   ├── signals/          # Signal management, composer, backtests
│       │   ├── indicators/       # Indicator catalog, charts
│       │   ├── reports/          # Reports, portfolio
│       │   ├── admin/            # Monitoring, users, indicator catalog
│       │   ├── engine/           # Engine workspace
│       │   ├── docs/             # Documentation page
│       │   └── public/           # Public reports, history
│       ├── components/           # ★ 78 React components
│       │   ├── auth/             # AccessGate, LoginWorkspace
│       │   ├── chart/            # MultiPaneChart, indicators, overlays
│       │   ├── layout/           # AppChrome, TopNav, ModuleRail, Watchlist
│       │   ├── signals/          # SignalComposer, backtests, comparison
│       │   ├── trading/          # TradingWorkspace, paper, execution, audit
│       │   ├── indicators/       # Settings, trace, alerts
│       │   ├── admin/            # Monitoring, users, catalog
│       │   ├── reports/          # Leaderboard, portfolio
│       │   ├── ui/               # FactCard, MetricCard, Sparkline
│       │   └── public/           # PublicReports, PublicTradeHistory
│       ├── hooks/                # 22 custom hooks
│       ├── store/                # 6 Zustand stores
│       └── lib/                  # 60+ API clients, utilities, view logic
│
├── mt5-service/                  # MT5 Bridge (Python)
│   ├── main.py                   # ★ Market data service: startup sync + live collection
│   ├── trade_exec_main.py        # ★ Execution bridge (separate terminal)
│   ├── mt5_connector.py          # MT5 API wrapper (thread-safe)
│   ├── bridge_server.py          # HTTP REST bridge for Node backend
│   ├── symbol_config.py          # YAML-driven symbol/timeframe config
│   ├── historical_fetcher.py     # Historical data fetch + chunking
│   ├── pusher.py                 # Batch ingestion to backend API
│   ├── gap_filler.py             # Gap detection logic
│   ├── config.yaml               # Symbol/TF/broker configuration
│   ├── sync_history_mt5.py       # Full historical sync (all symbols)
│   ├── sync_history_btc.py       # BTC-specific sync
│   ├── sync_history_metals.py    # Metals-specific sync
│   ├── repair_gaps_btc.py        # BTC gap repair
│   ├── repair_gaps_metals.py     # Metals gap repair
│   ├── repair_all_gaps.py        # Unified gap repair
│   ├── sync_gap_backfill.py      # Automatic gap backfill
│   └── tests/                    # unittest test suite
│
├── prisma/                       # Database schema + migrations
│   ├── schema.prisma             # 29 models, 20+ enums
│   └── migrations/               # Prisma migration history
│
├── docker-compose.yml            # TimescaleDB + External DB + Redis
├── package.json                  # Backend dependencies + scripts
├── tsconfig.json                 # TypeScript config (strict, ES2020, CommonJS)
├── CLAUDE.md                     # AI agent instructions
│
├── docs/                         # Project documentation (this folder)
├── docs-disaster-recovery/       # DR documentation
├── _bmad/                        # BMAD workflow framework
└── _bmad-output/                 # BMAD generated artifacts
```

## Critical Folders Summary

| Folder | Purpose | Key Files |
|---|---|---|
| `src/services/signals/` | Signal lifecycle: definitions, backtesting, live indicators, composed blocks | 20+ services |
| `src/services/signals/blocks/plugins/` | 15 TechIndicatorBlock plugins | ATR, EMA, RSI, SMC, DowTheory, etc. |
| `src/services/trading/` | Trading lifecycle: accounts, execution, automation, diagnosis | 20+ services |
| `src/services/trading/externalAction/` | External delivery: Telegram, webhooks, separate DB | 7 services |
| `src/routes/` | REST API endpoints | 11 route files |
| `src/workers/` | BullMQ async workers | 4 workers |
| `web/src/components/` | React UI components | 78 components |
| `mt5-service/` | Python MT5 bridge + sync scripts | 2 servers + 7 sync/repair scripts |
