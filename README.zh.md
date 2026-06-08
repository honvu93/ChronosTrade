# 📊 ChronosTrade — 企业级量化交易与分析平台

[English](README.md) | [Tiếng Việt](README.vi.md) | [Español](README.es.md)

**ChronosTrade** 是一个高性能、企业级的量化交易和金融数据分析平台。系统旨在提供极致的性能，提供从市场数据接入、动态技术指标计算、高并发策略回测（参数优化）、实时信号推送，到通过 MetaTrader 5 (MT5) 桥接服务进行全自动订单执行的统一处理流水线。本项目为量化开发人员和算法交易者从策略研发向实盘交易过渡提供了坚实的基础。

---

## 🛠 技术栈

### 1. 后端 (核心引擎)
* **Node.js & TypeScript:** 使用 Node >= 20.x, TypeScript 5.3。
* **Express.js 5:** 具有结构化安全中间件的高性能 REST API。
* **Prisma ORM & TimescaleDB:** 针对金融时间序列 K 线数据和 29 个复杂关系型交易模型进行优化的数据库存储。
* **BullMQ & Redis:** 用于高并发多通道并行回测和交易执行的异步任务队列系统。
* **Socket.IO:** 向前端控制面板实时推送交易状态和事件数据。

### 2. 前端 (控制面板 - Dashboard)
* **Next.js 16 (App Router) & React 19:** 针对渲染速度进行深度优化的服务器端和客户端渲染组件。
* **Tailwind CSS 4 & Radix UI:** 现代化、自适应、整洁且易用的 UI 框架。
* **Zustand & TanStack React Query:** 顺畅的前端状态管理和自动化的服务器状态同步。
* **Lightweight Charts (TradingView):** 专业交互式图表，直观显示买入/卖出点位及价格。

### 3. MT5 Bridge (Python 桥接服务)
* **Python 3.x & MetaTrader5 API:** 获取历史数据并直接向 MT5 终端推送实时交易指令。
* **APScheduler:** 周期性 K 线同步的自动化任务调度器。
* **Thread-safe Lock:** 线程安全锁，确保 MT5 内部订单的顺序安全执行。

---

## 🚀 核心功能

```mermaid
flowchart TD
    subgraph MarketData [市场数据流]
        MT5[MetaTrader 5] -->|同步K线| Bridge[Python MT5 桥接]
        Bridge -->|存储| TS[TimescaleDB]
    end

    subgraph SignalEngine [信号引擎]
        TS -->|查询K线| Runner[指标实时执行器]
        Def[信号定义] -->|配置指标| Runner
        Runner -->|生成事件| Event[信号事件]
    end

    subgraph Execution [执行流水线]
        Event -->|创建意图| Intent[交易意图]
        Intent -->|检查过滤| Guard{风险过滤器}
        Guard -->|通过| Comm[执行指令]
        Comm -->|发送 HTTP| Bridge
        Bridge -->|执行订单| MT5
    end

    subgraph Monitoring [实时推送]
        Event -->|Socket.IO| UI[Next.js 控制面板]
        Event -->|Telegram 机器人| TG[Telegram 频道]
    end
```

### 1. 指标管理与动态参数调整 (Dynamic Parameter Tuning)
* **参数微调 (Parameter Tuning):** 直接从回测界面动态自定义技术指标参数（如 RSI 周期、EMA 长度、艾略特波浪和 Swing 结构），无需修改任何原始代码。
* **声明式 Schema:** 指标通过 `FieldSchema` 声明其参数结构。前端将自动渲染相应的滑动条、切换按钮或下拉菜单。
* **K 线数值查询 (Bar Inspection):** 在图表上悬停即可查看任何特定 K 线柱上所有活跃技术指标的精确数值。

### 2. 离场策略与高级风险管理 (Exit Profiles & Trade Guards)
* **离场配置文件 (Exit Profiles):** 支持多种自动止盈止损策略：
  * 固定风险倍数（1R、2R，硬性 TP/SL）。
  * **盈亏平衡 (Break-even):** 在交易达到 1R 目标后，自动将止损 (SL) 移动到开仓价。
  * **部分平仓 (Partial Close):** 在 1R 处平掉部分仓位，其余仓位跟随移动止损（Trailing Stop）。
  * **Swing 移动止损:** 移动止损点根据最近 N 根 K 线的最高/最低价进行跟踪。
* **交易保护过滤 (Trade Guards):**
  * 连败冷却时间（在连续 N 次亏损后暂停交易）。
  * 日内和单节最大亏损上限（最大回撤安全门限）。
  * 净值曲线 EMA 过滤器（当净值曲线低于均值时限制开仓）。

### 3. 决策追溯与多时间周期对齐 (Decision Tracing & Multi-TF)
* **决策追溯 (Decision Tracing):** 记录每根 K 线上的退出条件判定状态（`PASS`、`FAIL`、`TRIGGERED`、`SKIPPED`），方便策略调试。
* **多时间周期对齐 (Multi-TF Alignment):** 将更高时间周期（如 H1 趋势过滤器）的指标自动对齐并同步到基础执行周期（如 M5 进场信号），对齐精度基于 K 线收盘时间。

### 4. 高性能并行回测引擎
* **并发 Worker 队列:** 通过 BullMQ 任务队列多通道并行处理海量参数优化和回测任务（通过 `BACKTEST_WORKER_CONCURRENCY` 进行配置）。
* **矩阵扫描 (Matrix Sweeps):** 对各种技术指标的参数组合进行网格搜索扫描，以寻找到最优配置。

---

## ⚖️ 为什么选择 ChronosTrade？ (方案对比)

与市场上其他零售量化框架或自行开发的系统相比，ChronosTrade 在策略研发速度和全自动实盘执行之间取得了最佳的平衡：

| 功能 / 评估维度 | Python 框架 (Backtrader / Zipline) | 传统交易机器人 (MQL5 EA) | TradingView / Pine Script | **ChronosTrade** |
| :--- | :--- | :--- | :--- | :--- |
| **执行架构** | 高延迟，或需自行编写桥接 | 低延迟，但状态处理极其复杂 | Webhook 延迟，需外部中转服务器 | **亚秒级 MT5 桥接，采用原子并发锁** |
| **数据库性能** | 平面文件 (CSV) 或慢速关系型 DB 查询 | 无内置时间序列数据库集成 | 云端内存存储（有历史长度限制） | **TimescaleDB 时间序列超表优化** |
| **参数优化** | 默认 CPU 单进程运行 | MT5 策略测试器 (限制在 Windows 上) | 浏览器端单线程执行 | **分布式 BullMQ 队列 (多核/并行)** |
| **参数自定义** | 每次运行均需修改代码 | 界面死板固定，参数静态 | TradingView 控制面板调整 | **基于 Schema 自动生成动态表单 (`FieldSchema`)** |
| **决策调试** | 控制台打印简单文本日志 | 输出到 MT5 的 Journal 面板 | 图表上绘制视觉形状（难以回溯审计） | **详尽的判定时间线 (`PASS`/`FAIL` 每根K线)** |
| **运行模式** | 本地脚本或自建服务器 | 运行在 MT5 终端或 VPS 上 | TradingView 云端托管 | **Local-first，100% 自主掌控及私有部署** |

---

## 📐 系统架构

系统整体的分层架构设计图：

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

## 🏃 快速启动指南

### 准备工作
* 安装 **Node.js** v20 或更高版本。
* **Docker & Docker Compose** 已安装并正常运行。
* **Python 3.8+** (用于 MT5 桥接服务)。
* **MetaTrader 5 终端** (已登录您的交易账户)。

### 第一步：安装依赖

1. 安装后端依赖：
   ```bash
   npm install
   ```

2. 安装前端依赖：
   ```bash
   npm --prefix web install
   ```

3. 安装 Python 库依赖 (在 `mt5-service` 文件夹中):
   ```bash
   pip install -r mt5-service/requirements.txt
   ```

### 第二步：启动基础服务 (Database & Cache)

使用 Docker Compose 启动 TimescaleDB、Redis 以及外部信号数据库：
```bash
docker compose up -d
```
*检查容器状态：* `docker ps`

### 第三步：配置环境变量 (.env)

1. 在项目根目录下创建 `.env` 文件 (用于后端 API 和 Workers):
   ```env
   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
   EXTERNAL_SIGNAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:5434/external_signal?schema=public"
   REDIS_URL="redis://localhost:6379"
   NODE_ENV="development"
   MT5_BRIDGE_PORT="8765"
   MT5_EXEC_BRIDGE_PORT="8766"
   ```

2. 在 `web/` 目录下创建 `web/.env.local` 文件:
   ```env
   NEXT_PUBLIC_API_URL="http://localhost:3001"
   NEXT_PUBLIC_SOCKET_URL="http://localhost:3001"
   ```

### 第四步：执行 Prisma 数据库同步

生成 Prisma 客户端并将数据库 Schema 应用到 TimescaleDB：
```bash
npx prisma generate
npx prisma migrate deploy
```

---

## 🚀 启动项目

### 方式 1：使用自动化脚本 (推荐)
使用项目内置的脚本 `trade-dev` 可以一次性启动所有服务：
```bash
# 添加执行权限 (仅需执行一次)
chmod +x ./trade-dev

# 运行后端 + 前端
./trade-dev

# 启动并开启 Cloudflare Tunnel
./trade-dev --with-tunnel
```

### 方式 2：手动在独立终端启动服务
* **终端 1: 启动后端 API 服务** -> `npm run dev`
* **终端 2: 启动前端 Dashboard** -> `npm --prefix web run dev`
* **终端 3: 启动回测 Worker** -> `npm run dev:backtest:worker`
* **终端 4: 启动自动交易 Worker** -> `npm run dev:trading:auto-worker`
* **终端 5: 运行 Python MT5 桥接** -> `python mt5-service/bridge_server.py`

---

## 🧪 常用测试与数据脚本 (CLI)

项目提供了一些有用的命令行工具，以填充测试数据或优化参数：

* **填充演示数据 (Seed):**
  ```bash
  npm run seed:engine               # 初始化系统配置
  npx ts-node src/scripts/seedTier1ComposedSignals.ts # 生成测试技术指标信号
  ```
* **Smoke Tests (快速可用性测试):**
  ```bash
  npm run smoke:signals-platform    # 测试信号平台基础逻辑
  npm run test:trading:backend      # 运行后端交易部分的单元测试
  ```
* **黄金 (XAU/USD - M5) 策略矩阵优化:**
  ```bash
  npm run xau:abc:all               # 运行所有参数矩阵扫描
  npm run xau:new:l5                # 测试 M5 Smart Trail 策略变体
  ```

---

## 📂 项目目录结构

```
ChronosTrade/
  ├── prisma/               # Prisma 数据库配置及版本迁移记录
  ├── src/                  # 后端核心源码
  │    ├── routes/          # REST API 路由
  │    ├── services/        # 业务逻辑服务 (回测, 自动化, 实时计算)
  │    ├── workers/         # BullMQ 异步队列处理器
  │    └── scripts/         # CLI 数据处理及网格优化脚本
  ├── web/                  # Next.js 前端控制台项目
  │    ├── src/app/         # 页面视图路由
  │    ├── src/components/  # 可重用 UI 及图表组件 (Lightweight Charts)
  │    └── src/store/       # 基于 Zustand 的前端状态存储
  ├── mt5-service/          # Python 实现的 MT5 数据与订单桥接服务
  ├── docs/                 # 项目各模块详细的高级技术文档
  ├── docker-compose.yml    # Docker 容器服务定义
  └── trade-dev             # 快速启动服务的 Bash 脚本
```

---

## 🤝 贡献指南

我们非常欢迎社区的贡献：
1. Fork 本项目。
2. 创建您的功能分支：`git checkout -b feature/AmazingFeature`。
3. 提交更改：`git commit -m 'Add some AmazingFeature'`。
4. 推送到分支：`git push origin feature/AmazingFeature`。
5. 提交 **Pull Request**。

---

## 📄 开源协议

本项目采用 **ISC License** 开源协议。详情请参阅 [LICENSE](file:///Users/honvu/Public/Claude-Project/ChronosTrade/LICENSE) 文件。
