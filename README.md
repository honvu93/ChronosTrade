# 📊 ChronosTrade — Enterprise Quantitative Trading & Analytics Platform

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2020.0.0-green.svg)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-38bdf8.svg)](https://tailwindcss.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Database](https://img.shields.io/badge/Database-TimescaleDB-orange.svg)](https://www.timescale.com/)

[Tiếng Việt](README.vi.md) | [Español](README.es.md) | [简体中文](README.zh.md)

**ChronosTrade** is an enterprise-grade quantitative trading and analytics platform. Engineered for high performance, it delivers a unified pipeline for market data ingestion, dynamic technical indicator computation, high-concurrency backtesting (parameter optimization), real-time signal dispatching, and automated order execution through MetaTrader 5 (MT5). The project serves as a robust foundation for quantitative developers and algorithmic traders transitioning from strategy discovery to live execution.

---

## 🛠 Technology Stack

### 1. Backend (Core Engine)
* **Node.js & TypeScript:** Node >= 20.x, TypeScript 5.3.
* **Express.js 5:** High-performance REST API with structured security middlewares.
* **Prisma ORM & TimescaleDB:** Optimized storage for financial time-series candle data and complex relational trading objects (29 models).
* **BullMQ & Redis:** Robust message broker and job queue for multi-lane parallel backtesting and trade execution.
* **Socket.IO:** Real-time event and state broadcasting to the dashboard.

### 2. Frontend (Dashboard)
* **Next.js 16 (App Router) & React 19:** Server and client-side components optimized for rendering speed.
* **Tailwind CSS 4 & Radix UI:** Clean, modern, responsive, and accessible UI layout.
* **Zustand & TanStack React Query:** Sleek client store management and automated server state synchronization.
* **Lightweight Charts (TradingView):** Professional interactive charting to view entry/exit points, indicators, and price actions.

### 3. MT5 Bridge (Python Bridge Service)
* **Python 3.x & MetaTrader5 API:** Fetching historical data and pushing live trade requests directly to the MT5 terminal.
* **APScheduler:** Automated job scheduling for periodic candle synchronization.
* **Thread-safe Lock:** Ensures serial and safe execution of trades within the MT5 environment.

---

## 🚀 Core Features

```mermaid
flowchart TD
    subgraph MarketData [Market Data Flow]
        MT5[MetaTrader 5] -->|Sync Candles| Bridge[Python MT5 Bridge]
        Bridge -->|Store| TS[TimescaleDB]
    end

    subgraph SignalEngine [Signal Engine]
        TS -->|Query Candles| Runner[Indicator Live Runner]
        Def[Signal Definition] -->|Configure Indicators| Runner
        Runner -->|Generate Event| Event[Signal Event]
    end

    subgraph Execution [Execution Pipeline]
        Event -->|Create Intent| Intent[Trade Intent]
        Intent -->|Check Filters| Guard{Trade Guards}
        Guard -->|Passed| Comm[Execution Command]
        Comm -->|Push HTTP Request| Bridge
        Bridge -->|Execute Order| MT5
    end

    subgraph Monitoring [Real-time Feeds]
        Event -->|Socket.IO| UI[Next.js Dashboard]
        Event -->|Telegram Bot| TG[Telegram Channel]
    end
```

### 1. Indicator Management & Dynamic Parameter Tuning
* **Parameter Tuning:** Dynamically customize technical indicators (such as RSI periods, EMA lengths, Elliott Waves, and Swing structures) directly from the Backtest UI without changing any source code.
* **Declarative Schemas:** Indicators define their configuration parameters via schemas (`FieldSchema`). The frontend automatically renders suitable sliders, toggle switches, or dropdowns.
* **Bar Inspection:** Hover over any candle on the chart to inspect the precise value of all active indicators on that specific bar.

### 2. Exit Profiles & Advanced Risk Management (Trade Guards)
* **Exit Profiles:** Support multiple automated exit strategies:
  * Fixed Risk Multiple (1R, 2R, hard TP/SL).
  * **Break-even:** Move stop loss (SL) to entry once the trade reaches a 1R target.
  * **Partial Close:** Close a portion of the volume at 1R, letting the rest run on a trailing stop.
  * **Swing Trailing:** Trailing stop based on the high/low of the last N bars.
* **Trade Guards (Entry Filters):**
  * Loss streak cooldown (stop trading after N consecutive losses).
  * Daily and Session loss caps (max drawdown safety gates).
  * Equity Curve EMA Filter (restrict entry when equity curve is below its average).

### 3. Decision Tracing & Multi-Timeframe Alignment
* **Decision Tracing:** Log bar-by-bar decision states for exits (`PASS`, `FAIL`, `TRIGGERED`, `SKIPPED`) for easy debugging.
* **Multi-Timeframe Alignment:** Sync indicators from higher timeframes (e.g. H1 trend filter) down to the base execution timeframe (e.g. M5 entry signals) aligned precisely on closing time.

### 4. Parallel Backtesting Engine
* **Concurrent Workers:** Process massive optimization and backtest tasks in parallel via BullMQ worker pools (configurable via `BACKTEST_WORKER_CONCURRENCY`).
* **Matrix Sweeps:** Execute grid search parameter sweeps across various indicator settings to find the optimal combination.

---

## ⚖️ Why ChronosTrade? (Comparison with Alternatives)

When compared to other retail or proprietary trading frameworks, ChronosTrade offers a unique middle ground between research speed and automated live execution:

| Feature / Metric | Python Frameworks (Backtrader / Zipline) | Traditional EAs (MT5 MQL5) | TradingView / Pine Script | **ChronosTrade** |
| :--- | :--- | :--- | :--- | :--- |
| **Execution Architecture** | High latency or custom-built bridge | Low latency but complex state handling | Webhook delay, requires external server | **Sub-second MT5 bridge with atomic locks** |
| **Database Performance** | Flat files (CSV) or slow relational DB queries | No native timeseries DB integration | Hosted memory storage (limited history) | **TimescaleDB (PostgreSQL) optimized hypertables** |
| **Parameter Optimization** | CPU-bound, single-process by default | MT5 Strategy Tester (Windows locked) | Single-threaded, runs inside browser | **Distributed BullMQ workers (multi-core / parallel)** |
| **Parameter Customization** | Requires code edits per run | Static inputs, rigid UI | Dropdowns / Inputs in TV panel | **Dynamic forms generated by schemas (`FieldSchema`)** |
| **Decision Debugging** | Plain text logs / basic console prints | Print statements in journal | Visual shapes on charts (hard to audit) | **Granular Decision Tracing (`PASS`, `FAIL` step timeline)** |
| **Hosting Model** | Local scripts or custom servers | Local VPS client instances | Cloud hosted | **Local-first, 100% self-hosted & self-owned** |

### Key Competitive Advantages

1. **Local-First & Complete Privacy:** You own your data, strategies, and API keys. No third-party servers see your parameters or execution logic, unlike cloud-hosted options.
2. **Next.js & React Dashboard:** Bridge the gap between algorithmic code and visual monitoring. Review backtests on professional TradingView-powered Lightweight Charts, edit parameters dynamically on the fly, and inspect indicator values bar-by-bar.
3. **Optimized for High Concurrency:** Rather than waiting hours for single-threaded backtests to complete, the system partitions parameter sweeps into independent lanes executed concurrently by a cluster of Node.js background workers.
4. **Resilient Execution Guardrails:** The platform sits between signal generators and brokers. It checks equity curve filters, streak caps, and trailing targets at the API layer *before* sending execution directives to MT5, reducing risk from runaway algorithms.

---

## 📐 System Architecture

Below is the high-level architecture diagram showing how the components communicate:

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

## 🏃 Quick Start Guide

### Prerequisites
* **Node.js** v20 or higher.
* **Docker & Docker Compose** installed and running.
* **Python 3.8+** (for MT5 bridge service).
* **MetaTrader 5 Terminal** (running on your broker account).

### Step 1: Install Dependencies

1. Install root Backend dependencies:
   ```bash
   npm install
   ```

2. Install Frontend Next.js dependencies:
   ```bash
   npm --prefix web install
   ```

3. Install Python requirements (inside `mt5-service` directory):
   ```bash
   pip install -r mt5-service/requirements.txt
   ```

### Step 2: Start Infrastructure Services

Use Docker Compose to run TimescaleDB, Redis, and External Signal Database containers:
```bash
docker compose up -d
```
*Check containers status using:* `docker ps`

### Step 3: Configure Environment Variables (.env)

1. Create a `.env` file in the root folder (for Backend API & Workers):
   ```env
   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
   EXTERNAL_SIGNAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:5434/external_signal?schema=public"
   REDIS_URL="redis://localhost:6379"
   NODE_ENV="development"
   MT5_BRIDGE_PORT="8765"
   MT5_EXEC_BRIDGE_PORT="8766"
   ```

2. Create a `web/.env.local` file in the `web/` directory:
   ```env
   NEXT_PUBLIC_API_URL="http://localhost:3001"
   NEXT_PUBLIC_SOCKET_URL="http://localhost:3001"
   ```

### Step 4: Run Prisma Migrations & Generate Client

Generate the Prisma client and apply database schemas to TimescaleDB:
```bash
npx prisma generate
npx prisma migrate deploy
```

---

## 🚀 Running the Project

### Method 1: Automated Script (Recommended)
You can use the built-in startup script `trade-dev` to spin up all services together:
```bash
# Add execution permissions (only required once)
chmod +x ./trade-dev

# Run Backend + Frontend
./trade-dev

# Run with Cloudflare Tunnel enabled
./trade-dev --with-tunnel
```

### Method 2: Manually Run Individual Services (For Debugging)
Run each command in a separate terminal window:

* **Terminal 1: Start Backend API Server**
  ```bash
  npm run dev
  ```
* **Terminal 2: Start Next.js Dashboard**
  ```bash
  npm --prefix web run dev
  ```
* **Terminal 3: Start BullMQ Backtest Worker**
  ```bash
  npm run dev:backtest:worker
  ```
* **Terminal 4: Start Auto Execution Worker**
  ```bash
  npm run dev:trading:auto-worker
  ```
* **Terminal 5: Run Python MT5 Bridge**
  ```bash
  python mt5-service/bridge_server.py
  ```

---

## 🧪 Seeding & Test Scripts

This repository includes several CLI utilities to seed database values or run stress tests:

* **Seed Demo Data:**
  ```bash
  npm run seed:engine               # Seed demo engine configuration
  npx ts-node src/scripts/seedTier1ComposedSignals.ts # Seed sample tier 1 signals
  ```

* **Smoke Tests:**
  ```bash
  npm run smoke:signals-platform    # Smoke test signal platform logic
  npm run test:trading:backend      # Run backend trading unit tests
  ```

* **Gold (XAU/USD - M5) Strategy Matrix Optimization:**
  ```bash
  npm run xau:abc:all               # Run all parameter sweep batches for XAU
  npm run xau:new:l5                # Run XAU Smart Trail M5 logic variant
  ```

---

## 📂 Repository Directory Tree

```
ChronosTrade/
  ├── prisma/               # Prisma database schemas and migration histories
  ├── src/                  # Core Backend codebase
  │    ├── routes/          # REST API endpoints (accounts, indicators, signals)
  │    ├── services/        # Business logic services (backtesting, automation, runner)
  │    ├── workers/         # BullMQ queue processors
  │    └── scripts/         # CLI utility, stress-testing, and optimization scripts
  ├── web/                  # Next.js Frontend app (Dashboard UI)
  │    ├── src/app/         # Routing pages and client views
  │    ├── src/components/  # Charting and reusable UI elements
  │    └── src/store/       # Zustand client-state management
  ├── mt5-service/          # Python MT5 connection and order bridge
  ├── docs/                 # Detailed documentation guides for each module
  ├── docker-compose.yml    # Docker services config
  └── trade-dev             # Quickstart bash helper script
```

---

## 🤝 Contributing

We welcome community contributions! If you would like to help improve ChronosTrade:
1. Fork this repository.
2. Create a new branch: `git checkout -b feature/AmazingFeature`.
3. Commit your changes: `git commit -m 'Add some AmazingFeature'`.
4. Push to the branch: `git push origin feature/AmazingFeature`.
5. Open a **Pull Request**.

---

## 👤 Author

* **Hon Vu (honvu93)** - *Initial architecture & development* - [@honvu93](https://github.com/honvu93)

---

## 📄 License

This project is licensed under the **ISC License**. For more details, see the [LICENSE](file:///Users/honvu/Public/Claude-Project/ChronosTrade/LICENSE) file.

