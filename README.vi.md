# 📊 ChronosTrade — Nền Tảng Giao Dịch Định Lượng & Phân Tích Cấp Doanh Nghiệp

[English](README.md) | [Español](README.es.md) | [简体中文](README.zh.md)

**ChronosTrade** là một nền tảng giao dịch định lượng và phân tích tài chính hiệu năng cao cấp doanh nghiệp. Được thiết kế tối ưu hóa tốc độ, hệ thống cung cấp một luồng xử lý đồng bộ từ nạp dữ liệu thị trường, tính toán chỉ báo kỹ thuật động, kiểm thử chiến lược song song hiệu năng cao (tối ưu hóa tham số), truyền tải tín hiệu thời gian thực và thực thi lệnh tự động qua cổng kết nối MetaTrader 5 (MT5). Dự án phục vụ như một nền móng vững chắc cho các nhà phát triển định lượng và các nhà giao dịch thuật toán chuyển đổi từ giai đoạn thử nghiệm chiến lược sang vận hành thực tế.

---

## 🛠 Công nghệ sử dụng (Technology Stack)

### 1. Backend (Lõi Hệ Thống)
* **Node.js & TypeScript:** Sử dụng Node >= 20.x, TypeScript 5.3.
* **Express.js 5:** API REST hiệu năng cao với cấu trúc middleware bảo mật.
* **Prisma ORM & TimescaleDB:** Cơ sở dữ liệu chuỗi thời gian tối ưu lưu trữ nến giá (price candles) và quản lý 29 mô hình dữ liệu quan hệ giao dịch phức tạp.
* **BullMQ & Redis:** Hệ thống quản lý hàng đợi và phân phối tác vụ bất đồng bộ cho backtest song song và thực thi lệnh.
* **Socket.IO:** Phát và đồng bộ trạng thái lệnh/dữ liệu theo thời gian thực tới giao diện người dùng.

### 2. Frontend (Bảng điều khiển - Dashboard)
* **Next.js 16 (App Router) & React 19:** Tối ưu hóa hiển thị phía máy chủ và trải nghiệm tương tác tốc độ cao.
* **Tailwind CSS 4 & Radix UI:** Hệ thống giao diện hiện đại, responsive và dễ tiếp cận.
* **Zustand & TanStack React Query:** Quản lý state cục bộ mượt mà và tự động đồng bộ hóa trạng thái server.
* **Lightweight Charts (TradingView):** Dựng đồ thị kỹ thuật tương tác chuyên nghiệp để theo dõi điểm vào/ra lệnh trực quan.

### 3. MT5 Bridge (Dịch vụ cầu nối Python)
* **Python 3.x & MetaTrader5 API:** Lấy dữ liệu lịch sử và đẩy các lệnh giao dịch trực tiếp xuống terminal MT5.
* **APScheduler:** Tự động lập lịch đồng bộ dữ liệu nến định kỳ.
* **Thread-safe Lock:** Đảm bảo thực thi lệnh tuần tự và an toàn tuyệt đối trên MT5.

---

## 🚀 Tính năng cốt lõi (Core Features)

```mermaid
flowchart TD
    subgraph MarketData [Luồng dữ liệu thị trường]
        MT5[MetaTrader 5] -->|Đồng bộ nến| Bridge[Python MT5 Bridge]
        Bridge -->|Lưu trữ| TS[TimescaleDB]
    end

    subgraph SignalEngine [Bộ xử lý tín hiệu]
        TS -->|Truy vấn nến| Runner[Indicator Live Runner]
        Def[Signal Definition] -->|Cấu hình chỉ báo| Runner
        Runner -->|Tạo sự kiện| Event[Signal Event]
    end

    subgraph Execution [Hành trình thực thi]
        Event -->|Tạo ý định| Intent[Trade Intent]
        Intent -->|Xét bộ lọc| Guard{Trade Guards}
        Guard -->|Đạt chuẩn| Comm[Execution Command]
        Comm -->|Đẩy lệnh HTTP| Bridge
        Bridge -->|Đặt lệnh thực tế| MT5
    end

    subgraph Monitoring [Kênh giám sát]
        Event -->|Socket.IO| UI[Next.js Dashboard]
        Event -->|Telegram Bot| TG[Telegram Channel]
    end
```

### 1. Quản lý Chỉ báo & Tinh chỉnh tham số động (Dynamic Parameter Tuning)
* **Parameter Tuning:** Điều chỉnh tham số chỉ báo kỹ thuật trực tiếp trên giao diện Backtest UI mà không cần sửa mã nguồn gốc.
* **Declarative Schemas:** Chỉ báo tự định nghĩa cấu trúc tham số thông qua `FieldSchema`, giúp frontend tự động render thanh trượt, nút chọn hoặc dropdown tương ứng.
* **Bar Inspection:** Di chuột trên đồ thị để kiểm tra chi tiết giá trị của từng chỉ báo tại bất kỳ cây nến nào.

### 2. Chiến lược Exit & Quản trị rủi ro nâng cao (Exit Profiles & Trade Guards)
* **Exit Profiles:** Chốt lời/dừng lỗ tự động đa dạng:
  * Cố định R-multiple (1R, 2R, TP/SL cứng).
  * **Break-even:** Dời dừng lỗ (SL) về entry khi đạt mục tiêu 1R.
  * **Partial Close:** Chốt một phần khối lượng tại 1R, phần còn lại chạy theo Trailing Stop.
  * **Swing Trailing:** Dừng lỗ động bám theo đỉnh/đáy của N nến trước đó.
* **Trade Guards (Bộ lọc an toàn):**
  * Giới hạn chuỗi thua liên tiếp (Loss streak cooldown).
  * Giới hạn lỗ tối đa trong ngày hoặc phiên giao dịch (Daily/Session loss caps).
  * Bộ lọc đường trung bình của đường cong vốn (Equity Curve EMA Filter).

### 3. Nhật ký quyết định & Căn chỉnh đa khung (Decision Tracing & Multi-TF)
* **Decision Tracing:** Ghi nhật ký từng bước quyết định của lệnh (`PASS`, `FAIL`, `TRIGGERED`, `SKIPPED`) giúp gỡ lỗi dễ dàng.
* **Multi-Timeframe Alignment:** Tự động căn chỉnh và đồng bộ nến của các khung thời gian lớn hơn về khung thời gian cơ sở (ví dụ: Xu hướng H1 áp dụng cho điểm vào lệnh M5).

### 4. Hệ thống chạy Backtest song song hiệu năng cao (Concurrent Backtesting)
* **Concurrent Workers:** Xử lý các tác vụ backtest lớn trong hàng đợi BullMQ với số luồng cấu hình tùy ý (`BACKTEST_WORKER_CONCURRENCY`).
* **Matrix sweeps:** Tự động chạy quét ma trận tham số để tìm ra cấu hình chỉ báo tối ưu nhất.

---

## ⚖️ Tại sao chọn ChronosTrade? (So sánh với giải pháp khác)

Khi so sánh với các thư viện giao dịch bán lẻ hoặc hệ thống nội bộ khác, ChronosTrade mang lại sự cân bằng hoàn hảo giữa nghiên cứu chiến lược và thực thi tự động trực tiếp:

| Tính năng / Tiêu chí | Thư viện Python (Backtrader / Zipline) | Robot giao dịch truyền thống (MQL5 EA) | TradingView / Pine Script | **ChronosTrade** |
| :--- | :--- | :--- | :--- | :--- |
| **Kiến trúc thực thi** | Độ trễ cao hoặc phải tự viết bridge | Độ trễ thấp nhưng xử lý trạng thái phức tạp | Trễ webhook, yêu cầu server trung gian | **Cầu nối MT5 dưới 1 giây với khóa nguyên tử** |
| **Hiệu năng Database** | File phẳng (CSV) hoặc truy vấn DB chậm | Không có tích hợp DB chuỗi thời gian | Bộ nhớ đám mây giới hạn lịch sử | **TimescaleDB tối ưu hypertables chuỗi thời gian** |
| **Tối ưu hóa tham số** | Chạy đơn luồng trên CPU theo mặc định | MT5 Strategy Tester (Giới hạn trên Windows) | Đơn luồng chạy trực tiếp trên trình duyệt | **Workers BullMQ phân tán (đa nhân / song song)** |
| **Tùy biến tham số** | Yêu cầu sửa mã nguồn mỗi lần chạy | Form cứng nhắc, cố định | Điều chỉnh trên panel TradingView | **Tự động render form qua schema (`FieldSchema`)** |
| **Gỡ lỗi quyết định** | Ghi log text đơn giản ở màn hình console | In nhật ký ra tab Journal của MT5 | Vẽ hình trên chart (khó kiểm toán lại) | **Bảng tiến trình chi tiết (`PASS`, `FAIL` từng nến)** |
| **Mô hình vận hành** | Script chạy local hoặc server tự dựng | Chạy trên phần mềm MT5 local/VPS | Lưu trữ đám mây của TradingView | **Local-first, tự chủ & tự sở hữu 100%** |

---

## 📐 Kiến trúc Hệ thống (System Architecture)

Sơ đồ kiến trúc tổng thể của hệ thống:

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

## 🏃 Hướng dẫn Cài đặt & Khởi chạy Nhanh

### Yêu cầu hệ thống (Prerequisites)
* **Node.js** v20 hoặc cao hơn.
* **Docker & Docker Compose** đã khởi chạy.
* **Python 3.8+** (cho dịch vụ MT5 Bridge).
* **MetaTrader 5 Terminal** (đã đăng nhập tài khoản broker của bạn).

### Bước 1: Cài đặt dependencies

1. Cài đặt dependencies cho Backend:
   ```bash
   npm install
   ```

2. Cài đặt dependencies cho Frontend:
   ```bash
   npm --prefix web install
   ```

3. Cài đặt thư viện Python (tại thư mục `mt5-service`):
   ```bash
   pip install -r mt5-service/requirements.txt
   ```

### Bước 2: Khởi động Docker (Database & Cache)

```bash
docker compose up -d
```
*Kiểm tra trạng thái:* `docker ps`

### Bước 3: Cấu hình môi trường (.env)

1. Tạo tệp `.env` tại thư mục gốc Backend:
   ```env
   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
   EXTERNAL_SIGNAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:5434/external_signal?schema=public"
   REDIS_URL="redis://localhost:6379"
   NODE_ENV="development"
   MT5_BRIDGE_PORT="8765"
   MT5_EXEC_BRIDGE_PORT="8766"
   ```

2. Tạo tệp `web/.env.local` tại thư mục frontend:
   ```env
   NEXT_PUBLIC_API_URL="http://localhost:3001"
   NEXT_PUBLIC_SOCKET_URL="http://localhost:3001"
   ```

### Bước 4: Khởi tạo database (Prisma Migration)

```bash
npx prisma generate
npx prisma migrate deploy
```

---

## 🚀 Khởi chạy ứng dụng

### Cách 1: Sử dụng script tự động (Khuyên dùng)
```bash
# Thêm quyền thực thi (chỉ cần chạy lần đầu)
chmod +x ./trade-dev

# Chạy Backend + Frontend
./trade-dev

# Chạy kèm Cloudflare Tunnel
./trade-dev --with-tunnel
```

### Cách 2: Khởi chạy thủ công từng terminal
* **Terminal 1: API Server Backend** -> `npm run dev`
* **Terminal 2: Dashboard Next.js** -> `npm --prefix web run dev`
* **Terminal 3: Backtest Worker** -> `npm run dev:backtest:worker`
* **Terminal 4: Auto Trading Worker** -> `npm run dev:trading:auto-worker`
* **Terminal 5: Python MT5 Bridge** -> `python mt5-service/bridge_server.py`

---

## 🧪 Các script kiểm thử hữu ích (CLI Tools & Seeding)

* **Seed dữ liệu mẫu:**
   ```bash
   npm run seed:engine               # Seed cấu hình hệ thống
   npx ts-node src/scripts/seedTier1ComposedSignals.ts # Seed các tín hiệu chỉ báo mẫu
   ```
* **Chạy Smoke Tests:**
   ```bash
   npm run smoke:signals-platform    # Smoke test hệ thống tín hiệu
   npm run test:trading:backend      # Chạy unit tests backend trading
   ```
* **Chạy tối ưu hóa tham số Vàng (XAU/USD):**
   ```bash
   npm run xau:abc:all               # Chạy quét ma trận tối ưu tham số
   npm run xau:new:l5                # Chạy thử nghiệm chiến lược Smart Trail M5
   ```

---

## 📂 Cấu trúc thư mục chính (Repository Directory Tree)

```
ChronosTrade/
  ├── prisma/               # Cấu hình Prisma schema và migration
  ├── src/                  # Mã nguồn lõi của Backend
  │    ├── routes/          # REST API endpoints
  │    ├── services/        # Logic nghiệp vụ (backtest, trading automation, runner)
  │    ├── workers/         # BullMQ queue processors
  │    └── scripts/         # Script CLI phân tích và tối ưu hóa tham số
  ├── web/                  # Dashboard Frontend Next.js
  │    ├── src/app/         # Giao diện chính và các trang
  │    ├── src/components/  # Thư viện component đồ thị (Lightweight Charts)
  │    └── src/store/       # Quản lý state bằng Zustand
  ├── mt5-service/          # Cầu nối trung gian MT5 Bridge (Python)
  ├── docs/                 # Tài liệu nâng cao chi tiết của từng phân hệ
  ├── docker-compose.yml    # Định nghĩa cấu hình các Docker container
  └── trade-dev             # Script bash khởi chạy nhanh toàn bộ dự án
```

---

## 🤝 Đóng góp cho Dự án (Contributing)

Chúng tôi luôn hoan nghênh mọi đóng góp từ cộng đồng:
1. Fork dự án này.
2. Tạo nhánh mới: `git checkout -b feature/AmazingFeature`.
3. Commit thay đổi: `git commit -m 'Add some AmazingFeature'`.
4. Push lên nhánh: `git push origin feature/AmazingFeature`.
5. Mở một **Pull Request**.

---

## 📄 Bản quyền & Giấy phép (License)

Dự án được phân phối dưới giấy phép **ISC License**. Xem thêm chi tiết tại tệp [LICENSE](file:///Users/honvu/Public/Claude-Project/ChronosTrade/LICENSE).
