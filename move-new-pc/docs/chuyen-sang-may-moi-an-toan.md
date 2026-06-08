# Chuyen Sang May Moi An Toan

## Muc dich

Tai lieu nay huong dan cach chuyen du an sang may moi ma van giu duoc:

- source code va lich su Git
- thay doi chua commit
- database PostgreSQL/TimescaleDB chinh
- database `external_signal` neu dang su dung
- file cau hinh local va secret
- file state cua MT5 service

Tai lieu nay duoc viet cho dev moi, uu tien thao tac theo tung buoc va co checkpoint de kiem tra.

## Khi nao dung tai lieu nay

Dung tai lieu nay khi:

- ban dang co mot may da chay du an on dinh va muon chuyen sang may khac
- ban can mang theo local DB hien tai thay vi tao moi tu dau
- ban muon dua cho mot dev moi mot goi du lieu de ho co the khoi dong nhanh

Khong dung tai lieu nay khi:

- ban chi muon clone repo va setup moi tu dau
- ban khong can du lieu local hien tai

Neu chi setup moi, dung [docs/new-dev-setup.md](./new-dev-setup.md).

## Tong quan nhung gi can chuyen

Khong duoc chi copy moi thu muc source.

De may moi dung duoc, can chuyen it nhat cac nhom du lieu sau:

1. Git va working tree
2. Database dump
3. File env va local config
4. File state MT5 neu co

## Database hien tai cua du an

Stack local duoc dinh nghia trong [docker-compose.yml](../../docker-compose.yml):

- DB chinh:
  - container: `binance-timescaledb`
  - loai: `timescale/timescaledb:latest-pg16`
  - database: `binance_trade`
  - user: `postgres`
  - host port: `5433`
- DB phu:
  - container: `binance-external-signal-db`
  - loai: `postgres:16-alpine`
  - database: `external_signal`
  - user: `postgres`
  - host port: `5434`
- Redis:
  - container: `binance-redis`
  - host port: `6379`

Backend local thong thuong dung:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
```

## Cac file va du lieu can copy

### Bat buoc

- toan bo repo Git hoac `git bundle`
- database dump cua `binance_trade`
- `.env`
- `web/.env.local`

### Neu dang dung external signal lane

- database dump cua `external_signal`

### Neu dang dung MT5 integration

- `mt5-service/.env`
- `mt5-service/config.yaml`
- `mt5-service/.sync_btc_usdc_mt5_state.json`
- `mt5-service/.sync_mt5_assets_state.json`

### Neu co local thay doi chua commit

- `git status --short`
- `git diff`
- `git diff --staged`
- danh sach file untracked
- optional: snapshot working tree

## Nhung thuong khong can copy

Thuong co the bo qua:

- `node_modules`
- `dist`
- `logs`
- `web/.next`
- `web/node_modules`
- `mt5-service/__pycache__`

## Cach nhanh nhat de hieu quy trinh

Neu ban muon nho nhanh, day la flow:

1. Dung cac process dang ghi vao DB tren may cu.
2. Tao dump cho `binance_trade` va, neu can, `external_signal`.
3. Copy source/Git, env, va file state sang may moi.
4. Tren may moi, clone repo hoac restore bundle.
5. Dat lai cac file env.
6. Chay `docker compose up -d`.
7. Restore dump vao DB tuong ung.
8. Chay `npx prisma generate` va `npx prisma migrate deploy`.
9. Kiem tra backend, frontend, va so luong ban ghi.

Phan ben duoi la huong dan chi tiet.

## Phan A - Chuan bi tren may cu

### A1. Dong cac process dang ghi DB

Truoc khi backup DB, dung cac process co the tiep tuc ghi du lieu:

- backend dev server
- trading workers
- MT5 Python services
- script chay tay dang ghi PostgreSQL

Ban co the giu Docker containers tiep tuc chay.

Kiem tra containers:

```powershell
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

Ban mong doi thay it nhat:

- `binance-timescaledb`
- `binance-redis`

Neu dang dung external signal lane, se co them:

- `binance-external-signal-db`

### A2. Tao thu muc transfer

Vi du:

```powershell
New-Item -ItemType Directory -Force D:\transfer-package | Out-Null
New-Item -ItemType Directory -Force D:\transfer-package\db | Out-Null
New-Item -ItemType Directory -Force D:\transfer-package\secrets | Out-Null
```

### A3. Luu trang thai Git

#### Lua chon 1: Tao WIP commit tam thoi

Neu ban chap nhan tao commit tam:

```powershell
git checkout -b transfer/2026-03-15
git add -A
git commit -m "WIP before moving to another machine"
git bundle create D:\transfer-package\repo.bundle --all
```

#### Lua chon 2: Khong commit

Neu khong muon commit, luu lai trang thai hien tai:

```powershell
git status --short > D:\transfer-package\git-status.txt
git diff > D:\transfer-package\git-working-tree.patch
git diff --staged > D:\transfer-package\git-staged.patch
git ls-files --others --exclude-standard > D:\transfer-package\git-untracked.txt
git bundle create D:\transfer-package\repo.bundle --all
```

Neu co nhieu file untracked quan trong, nen tao them snapshot:

```powershell
robocopy . D:\transfer-package\source-snapshot /E /XD .git node_modules dist logs web\node_modules web\.next mt5-service\__pycache__
```

### A4. Backup DB chinh `binance_trade`

Tao dump theo custom format:

```powershell
docker exec binance-timescaledb sh -c "pg_dump -U postgres -d binance_trade -Fc -f /tmp/binance_trade.dump"
docker cp binance-timescaledb:/tmp/binance_trade.dump D:\transfer-package\db\binance_trade.dump
```

Optional schema-only:

```powershell
docker exec binance-timescaledb sh -c "pg_dump -U postgres -d binance_trade --schema-only -f /tmp/binance_trade_schema.sql"
docker cp binance-timescaledb:/tmp/binance_trade_schema.sql D:\transfer-package\db\binance_trade_schema.sql
```

### A5. Backup DB phu `external_signal` neu can

Chi can buoc nay neu ban dang dung external signal lane hoac muon giu nguyen du lieu webhook/action lane.

```powershell
docker exec binance-external-signal-db sh -c "pg_dump -U postgres -d external_signal -Fc -f /tmp/external_signal.dump"
docker cp binance-external-signal-db:/tmp/external_signal.dump D:\transfer-package\db\external_signal.dump
```

Optional schema-only:

```powershell
docker exec binance-external-signal-db sh -c "pg_dump -U postgres -d external_signal --schema-only -f /tmp/external_signal_schema.sql"
docker cp binance-external-signal-db:/tmp/external_signal_schema.sql D:\transfer-package\db\external_signal_schema.sql
```

### A6. Kiem tra dump da tao thanh cong

Kiem tra file co ton tai:

```powershell
Get-ChildItem D:\transfer-package\db
```

Ban nen thay it nhat:

- `binance_trade.dump`

Va neu da backup DB phu:

- `external_signal.dump`

Neu muon kiem tra dung luong:

```powershell
Get-Item D:\transfer-package\db\binance_trade.dump | Select-Object FullName,Length,LastWriteTime
```

### A7. Copy secrets va local config

Copy cac file sau vao `D:\transfer-package\secrets` qua kenh an toan:

- `.env`
- `.env.prod` neu ban van can
- `web/.env.local`
- `mt5-service/.env`
- `mt5-service/config.yaml`
- `mt5-service/.sync_btc_usdc_mt5_state.json`
- `mt5-service/.sync_mt5_assets_state.json`

Khong commit cac file nay vao Git.

### A8. Dong goi de chuyen sang may moi

Layout goi du lieu de xuat:

```text
D:\transfer-package\
  repo.bundle
  git-status.txt
  git-working-tree.patch
  git-staged.patch
  git-untracked.txt
  source-snapshot\
  db\
    binance_trade.dump
    binance_trade_schema.sql
    external_signal.dump
    external_signal_schema.sql
  secrets\
    .env
    .env.prod
    web.env.local
    mt5-service.env
    config.yaml
```

## Phan B - Chuan bi tren may moi

### B1. Cai cac cong cu can thiet

May moi nen co:

- Node.js 20+
- Docker Desktop
- Git
- Python 3.11+ neu dung `mt5-service`

Kiem tra:

```powershell
node --version
docker --version
git --version
python --version
```

### B2. Lay source code

#### Cach 1: Clone tu remote

```powershell
git clone https://github.com/honvu93/ChronosTrade.git new-tv-trade
cd new-tv-trade
```

#### Cach 2: Clone tu bundle

```powershell
git clone D:\transfer-package\repo.bundle new-tv-trade
cd new-tv-trade
```

Sau do checkout branch can dung.

### B3. Khoi phuc local thay doi neu co

Neu ban co patch:

```powershell
git apply D:\transfer-package\git-working-tree.patch
git apply D:\transfer-package\git-staged.patch
```

Neu co untracked files quan trong, copy lai tu `source-snapshot`.

### B4. Dat lai file env va local config

Copy cac file da backup vao dung vi tri:

- `D:\transfer-package\secrets\.env` -> `.env`
- `D:\transfer-package\secrets\web.env.local` hoac file tuong ung -> `web/.env.local`
- `D:\transfer-package\secrets\mt5-service.env` hoac file tuong ung -> `mt5-service/.env`
- `D:\transfer-package\secrets\config.yaml` -> `mt5-service/config.yaml`

Neu goi transfer giu nguyen ten file goc, dat lai dung duong dan goc la du.

### B5. Cai dependencies

Tai root repo:

```powershell
npm install
npm --prefix web install
```

## Phan C - Khoi tao ha tang local tren may moi

### C1. Bat Docker stack

```powershell
docker compose up -d
```

Kiem tra:

```powershell
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

Ban mong doi thay:

- `binance-timescaledb`
- `binance-redis`

Va neu stack co bat DB phu:

- `binance-external-signal-db`

### C2. Tao Prisma client

```powershell
npx prisma generate
```

## Phan D - Restore database

## Canh bao an toan

Cac lenh restore ben duoi se ghi de database tren may moi.

Chi thuc hien tren may moi hoac tren moi truong ma ban chac chan duoc phep ghi de.

### D1. Restore DB chinh `binance_trade`

Copy dump vao container:

```powershell
docker cp D:\transfer-package\db\binance_trade.dump binance-timescaledb:/tmp/binance_trade.dump
```

Xoa DB cu neu co, tao lai, va restore:

```powershell
docker exec binance-timescaledb sh -c "dropdb -U postgres --if-exists binance_trade"
docker exec binance-timescaledb sh -c "createdb -U postgres binance_trade"
docker exec binance-timescaledb sh -c "pg_restore -U postgres -d binance_trade --clean --if-exists /tmp/binance_trade.dump"
```

### D2. Restore DB phu `external_signal` neu co

Chi thuc hien neu ban da chuyen dump cua DB phu:

```powershell
docker cp D:\transfer-package\db\external_signal.dump binance-external-signal-db:/tmp/external_signal.dump
docker exec binance-external-signal-db sh -c "dropdb -U postgres --if-exists external_signal"
docker exec binance-external-signal-db sh -c "createdb -U postgres external_signal"
docker exec binance-external-signal-db sh -c "pg_restore -U postgres -d external_signal --clean --if-exists /tmp/external_signal.dump"
```

### D3. Dong bo migration tren may moi

Sau khi restore, dong bo schema theo code hien tai:

```powershell
npx prisma generate
npx prisma migrate deploy
```

Neu luong external signal co migration rieng va stack cua ban can dung schema do, chay them buoc migration tuong ung theo quy trinh cua lane nay.

## Phan E - Kiem tra sau khi restore

### E1. Kiem tra ket noi DB chinh

```powershell
docker exec binance-timescaledb psql -U postgres -d binance_trade -c "\dt"
docker exec binance-timescaledb psql -U postgres -d binance_trade -c "select count(*) from price_candles;"
docker exec binance-timescaledb psql -U postgres -d binance_trade -c "select count(*) from backtest_runs;"
docker exec binance-timescaledb psql -U postgres -d binance_trade -c "select count(*) from trading_accounts;"
```

### E2. Kiem tra DB phu neu co

```powershell
docker exec binance-external-signal-db psql -U postgres -d external_signal -c "\dt"
```

### E3. Kiem tra backend

Chay backend:

```powershell
npm run dev
```

Trong terminal khac:

```powershell
curl http://localhost:3001/health
```

### E4. Kiem tra frontend

Chay frontend:

```powershell
npm --prefix web run dev
```

Sau do mo:

- `http://localhost:5001`

### E5. Kiem tra Git state

```powershell
git status --short
git branch --show-current
git rev-parse --short HEAD
```

## Cac loi thuong gap va cach xu ly

### Loi: `prisma: Can't reach database`

Thuong do:

- Docker chua chay
- container `binance-timescaledb` chua len
- `DATABASE_URL` sai host hoac port

Kiem tra:

```powershell
docker ps
```

Va xac nhan `.env` dang tro den:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
```

### Loi: Prisma nhac den `prisma://` hoac `prisma+postgres://`

Thuong do Prisma client cu van con cache.

Thu lai:

```powershell
npx prisma generate
```

Neu can, xoa cache local phu hop roi generate lai theo quy trinh hien tai cua repo.

### Loi: Khong restore duoc `external_signal`

Neu ban khong dung external signal lane, co the bo qua DB nay.

Neu dang dung lane do, kiem tra:

- container `binance-external-signal-db` da chay chua
- file dump co ton tai khong
- da dung dung ten DB `external_signal` chua

### Loi: Frontend len nhung khong goi duoc backend

Kiem tra file `web/.env.local` va dam bao:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

## Checklist nhanh cho dev moi

Dev moi chi can theo checklist nay:

1. Clone repo hoac restore `repo.bundle`.
2. Dat lai `.env` va `web/.env.local`.
3. Chay `docker compose up -d`.
4. Chay `npm install` va `npm --prefix web install`.
5. Restore `binance_trade.dump`.
6. Chay `npx prisma generate`.
7. Chay `npx prisma migrate deploy`.
8. Chay `npm run dev`.
9. Chay `npm --prefix web run dev`.
10. Kiem tra `http://localhost:3001/health` va `http://localhost:5001`.

## Tom tat

De chuyen DB cua du an nay sang may khac va dung duoc ngay, can chuyen ca dump DB, env/local config, va neu co thi ca state cua MT5 va DB `external_signal`.

Neu lam theo tai lieu nay, mot dev moi co the:

- khoi phuc dung source va local config
- restore du lieu local hien tai
- dong bo schema Prisma
- chay backend va frontend tren may moi
- xac nhan he thong da san sang de tiep tuc phat trien
