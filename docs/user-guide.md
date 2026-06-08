# Trading Platform — User Guide

## Quick Start

### Khởi động hệ thống

```bash
# 1. Infrastructure (TimescaleDB + Redis)
docker compose up -d

# 2. Backend API (:3001)
cd lib-trade-latest && npm run dev

# 3. Frontend (:5001)
npm --prefix web run dev

# 4. Backtest Worker (async execution)
npm run dev:backtest:worker

# 5. Trading Workers (chỉ khi cần live trading)
npm run dev:trading:auto-worker
npm run dev:trading:reconciliation-worker
npm run dev:external-action:worker
```

Truy cập: `http://localhost:5001` hoặc `https://trade.your-domain.com` (qua Cloudflare Tunnel)

---

## Modules

### 1. Chart (`/`)

Workspace chính để xem biểu đồ và phân tích kỹ thuật.

- **Chuyển symbol**: Click symbol dropdown (XAUUSDc, BTCUSDc, XAGUSDc...)
- **Chuyển timeframe**: Click timeframe selector (M1, M5, M15, M30, H1, H4, D1)
- **Indicators**: Overlay indicator lên chart, xem realtime values
- **Session shading**: Hiển thị vùng ASIAN / LONDON / NY trên chart
- **Watchlist**: Panel bên phải, quản lý symbols quan tâm

### 2. Signals (`/signals`)

Module backtest và phân tích signals. Có **4 tabs**:

#### Tab Generate — Chạy Backtest

1. **Chọn Signal Definition** từ dropdown (VD: `SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG`)
2. **Cấu hình thị trường**: Symbol, Timeframe, Date range (From → To)
3. **Cấu hình vốn**: Initial Equity ($10,000), Risk per trade (2%)
4. **Execution Config**:
   - Entry/Exit fees (bps) và slippage (bps)
   - Order timing: `SIGNAL_BAR_CLOSE`, `NEXT_BAR_OPEN`, `LIMIT_TOUCH`
   - Stop Loss mode: `SIGNAL_PRICE`, `FIXED_AMOUNT`, `ACCOUNT_PERCENT`
   - Take Profit mode: `SIGNAL_PRICE`, `FIXED_AMOUNT`, `R_MULTIPLE`
   - Position Sizing: `RISK_BASED`, `FIXED_QUANTITY`, `ACCOUNT_PERCENT`
5. **Trade Guards** (mở rộng section):
   - **Min Trade Spacing**: `30 min` (bật mặc định) — ngăn vào lệnh liên tục
   - **Loss Streak Throttle**: giảm risk % sau N lần thua liên tiếp
   - **Loss Streak Cooldown**: tạm dừng trade sau N lần thua
   - **Session Loss Cap**: giới hạn thua/session (ASIAN, LONDON, NY)
   - **Day Loss Cap**: giới hạn thua/ngày
   - **Equity Curve Filter**: dừng/giảm risk khi equity < EMA(N trades)
   - **Max Drawdown Halt**: circuit breaker khi DD vượt ngưỡng
6. **Run**: Bấm nút Run → backtest chạy async (không block UI)
7. **Kết quả**: Hiện trong history panel, click vào xem chi tiết

#### Tab Batch — So sánh nhiều configs

1. **Chọn Signal Definition** và base params (symbol, TF, date range, equity, risk)
2. **Thêm Variants**: Mỗi variant có label + JSON override cho execution config
   ```json
   // Ví dụ variant: test Spacing 60min
   { "tradeGuards": { "minTradeSpacing": { "minSpacingMinutes": 60 } } }
   ```
3. **Run All**: Tất cả variants chạy song song qua BullMQ queue
4. **Comparison Table**: Tự động hiện khi tất cả xong — so sánh Trades, WR%, Net R, PF, Max DD

#### Tab Import — Nhập signals từ bên ngoài

- Upload CSV/JSON với signals và results
- Validate against strategy dictionary
- Tạo backtest run từ data imported

#### Tab Review — Xem lại signals đã import

- Browse signal runs, filter theo strategy/session
- Drill-down vào từng trade

### 3. Signal Composer (`/signals/composer`)

Tạo custom signals bằng cách kết hợp indicator blocks:

1. **Indicator Catalog**: Browse danh sách indicators (RSI, EMA, ATR, Session, SMC...)
2. **Drag & Drop**: Kéo blocks vào canvas
3. **Conditions**: Cấu hình threshold cho mỗi indicator
4. **Match Mode**: ALL (tất cả phải match) / ANY (1 đủ) / SEQUENCE
5. **Entry/Exit Config**: SL, TP, exit management profile
6. **Exit Profiles có sẵn**:
   - `HARD_SIGNAL_TP` — SL cố định / TP theo signal
   - `FIXED_2R` — SL cố định / TP = 2R
   - `BE_1R_TP_2R` — Move BE tại 1R / TP = 2R
   - `PARTIAL_1R_BE_R3` — Chốt 50% tại 1R / BE / TP = 3R
   - `BE_1R_TRAIL_2R_3R` — BE tại 1R / trail tại 2R, 3R
   - `PARTIAL_1R_BE_SWING_TRAIL` — Chốt 50% / swing trail 12-bar
   - `XAU_NY_CLOSE` — TP 2R / force close cuối NY
   - `TIME_24` — Time stop 24 bars
7. **Run Backtest**: Bấm "Run Backtest" → chuyển sang tab Generate

### 4. Engine (`/engine`)

Dashboard phân tích chi tiết backtest results:

- **Performance Cards**: Win Rate, PF, Expectancy, Net R, Trades, Max Consecutive Loss
- **Chart**: Candlestick với entry/exit markers, session shading
- **By Strategy**: Performance breakdown theo strategy code
- **By Session**: So sánh ASIAN / LONDON / NY
- **Exit Strategy Comparison**: So sánh chi tiết các exit rules

### 5. Reports (`/reports`)

Export và báo cáo chi tiết:

- **Signal Leaderboard**: Top signals theo performance
- **Explainable Report**: Market snapshot, indicator state, matched rules tại mỗi entry
- **Export**:
  - Trade Log CSV
  - Signal Review CSV
  - Run Summary CSV
  - Strategy/Session/Exit Breakdown CSV
  - Validation Artifact JSON

### 6. Trading (`/trading`)

Giao dịch live qua MT5:

- **Account Connection**: Xem trạng thái kết nối MT5
- **Manual Order**: Vào lệnh thủ công (symbol, side, volume, SL, TP)
- **Automation Bindings**: Gắn indicator → tự động trade
- **Trade Intent Queue**: Review và approve lệnh tự động
- **Kill Switch**: Dừng toàn bộ automation
- **External Deployments**: Forward signals qua Telegram/Webhook
- **Trade History**: Lịch sử lệnh, P&L

### 7. Indicators (`/indicators`)

Quản lý fleet indicator live:

- **Fleet Health**: Total nodes, Active, Stale, Errors
- **Per Instance**: Status, heartbeat, diagnostics
- **Actions**: Play/Pause, Alert config, Archive, Analyzer

### 8. Admin (`/admin`)

- **Users** (`/admin/users`): Quản lý users, roles (ADMIN/USER), module permissions
- **Indicator Catalog** (`/admin/indicator-catalog`): Registry indicator definitions
- **Monitoring** (`/admin/monitoring`): System health, workers, DB, Redis, MT5 status

---

## Trade Guards — Chi tiết cấu hình

### Defaults (OPT-8 Optimized)

| Guard | Default | Mô tả |
|-------|---------|-------|
| **Min Trade Spacing** | **30 min, ON** | Ngăn vào lệnh liên tiếp, giảm 55% consec losses, giữ 90% Net R |
| Loss Streak Throttle | OFF | Giảm risk % sau N lần thua |
| Loss Streak Cooldown | OFF | Tạm dừng sau N lần thua |
| Session Loss Cap | OFF | Max thua/session |
| Day Loss Cap | OFF | Max thua/ngày |
| Equity Curve Filter | OFF | Block/giảm risk khi equity < EMA |
| Max Drawdown Halt | OFF | Circuit breaker khi DD quá sâu |

### Recommended Configs (từ OPT-2 + OPT-8)

**Config A — Preserve Profit (recommended)**
```
Min Trade Spacing: 30 min (ON)
Equity Curve Filter: EMA(20), HALF_RISK (ON)
```
- Giữ 90% Net R, giảm exposure khi drawdown

**Config B — Moderate Protection**
```
Min Trade Spacing: 30 min (ON)
Session Loss Cap: 3 losses (ON)
Day Loss Cap: 4 losses (ON)
Loss Streak Cooldown: 5 losses → 720 min (ON)
Loss Streak Throttle: 3→1.5%, 5→1.0% (ON)
```
- Giữ 99% Net R, PF +4-6%

**Config C — Maximum Safety**
```
Min Trade Spacing: 30 min (ON)
Equity Curve Filter: EMA(10), BLOCK (ON)
Max Drawdown Halt: 10% (ON)
```
- Max consec losses ~5, nhưng chỉ giữ ~7% Net R (quá aggressive)

---

## Backtest Workflow — Step by Step

### Single Backtest

```
/signals/composer → Compose signal → Save
       ↓
/signals (Generate) → Select signal → Set params → Set guards → Run
       ↓
Backtest chạy async (worker) → Progress hiện real-time
       ↓
Click vào run → Xem chi tiết trades, metrics
       ↓
/engine → Phân tích sâu: chart, session breakdown, exit comparison
       ↓
/reports → Export CSV/JSON
```

### Batch Comparison

```
/signals (Batch tab) → Select signal → Set base params
       ↓
Add variants: label + JSON override cho mỗi config muốn test
       ↓
Run All → Tất cả chạy song song
       ↓
Comparison table tự động hiện: Trades, WR%, Net R, PF, Max DD
       ↓
Click vào variant tốt nhất → Xem chi tiết
```

### Go Live

```
/signals → Chạy backtest với config final
       ↓
Verify metrics đạt go-live criteria
       ↓
/indicators → Promote backtest thành live indicator
       ↓
/trading → Tạo Automation Binding (indicator → account)
       ↓
Start workers: auto-execution + reconciliation
       ↓
Monitor: /indicators (health) + /trading (trade history)
```

---

## Infrastructure

### Services & Ports

| Service | Port | Mô tả |
|---------|------|-------|
| TimescaleDB | 5433 | Main database (candles, signals, backtests, trading) |
| Redis | 6379 | BullMQ queues, Socket.IO, pub/sub |
| Backend API | 3001 | Express.js REST + Socket.IO |
| Frontend | 5001 | Next.js dev server |
| MT5 Read Bridge | 8765 | Python HTTP bridge (data) |
| MT5 Exec Bridge | 8766 | Python HTTP bridge (execution) |

### Workers

| Worker | Command | Mô tả |
|--------|---------|-------|
| Backtest | `npm run dev:backtest:worker` | Async backtest execution |
| Auto Execution | `npm run dev:trading:auto-worker` | Trade intent → MT5 order |
| Reconciliation | `npm run dev:trading:reconciliation-worker` | Broker position sync |
| External Action | `npm run dev:external-action:worker` | Telegram/webhook delivery |

### Environment Files

| File | Mô tả |
|------|-------|
| `.env` | Backend: DATABASE_URL, REDIS_URL, JWT_SECRET, ENCRYPTION_KEY |
| `web/.env.local` | Frontend: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SOCKET_URL |
| `mt5-service/.env` | MT5 credentials |

### Cloudflare Tunnel

```bash
# Config: ~/.cloudflared/config.yml
# trade.your-domain.com → localhost:5001 (frontend)
# content.your-domain.com → localhost:3000

cloudflared tunnel run content-tunnel
```

---

## CLI Scripts

### Backtests

```bash
npm run xau:abc:all          # Run all XAU ABC optimization batches
npm run xau:abc:report       # Render optimization report
npm run xau:m5:roadmap       # XAU M5 roadmap preview
npm run smoke:signals-platform  # Signal platform smoke test
npm run smoke:signals-batch     # Batch preview smoke test
```

### Database

```bash
npx prisma generate          # Generate Prisma client
npx prisma migrate deploy    # Apply pending migrations
npx prisma studio            # Visual DB browser
npx prisma migrate dev --name <name>  # Create migration
```

### Build & Test

```bash
npm run build                         # TypeScript compile
npm run test:trading:backend          # Trading backend tests
npm --prefix web run build            # Frontend production build
npm --prefix web run lint             # ESLint
```
