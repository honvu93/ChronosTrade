# MT5 Sync - Run History & Playbook

## Prerequisites

1. MetaTrader 5 app dang mo tren may.
2. Backend server dang chay tai `localhost:3001`.

## Step 1 - Install dependencies

```bash
cd mt5-service
pip install -r requirements.txt
```

## Step 2 - Check broker history depth

```bash
python check_history.py
```

## Step 3 - Historical backfill to 2017

```bash
# Dry run
python sync_history_mt5.py --dry-run

# Full backfill for all enabled symbols
python sync_history_mt5.py --from 2017-01-01

# Only selected symbols
python sync_history_mt5.py --symbols BTCUSDc XAUUSDc XAGUSDc --from 2017-01-01
```

Script nay resume-safe. Neu bi ngat, chay lai se tiep tuc tu cursor da luu.

## Step 4 - Live realtime sync

```bash
python main.py
```

Hanh vi:
- Startup: tu detect va fill gap tu lan chay cuoi.
- Moi 10 giay: fetch vai bar moi nhat cho `BTCUSDc`, `XAUUSDc`, `XAGUSDc`.
- Moi 5 phut: retry cac batch fail neu backend bi down tam thoi.
- `BTCUSDc`: chay 24/7.
- `XAUUSDc`, `XAGUSDc`: tu dung cuoi tuan, tu resume dau tuan.

## Legacy split scripts

```bash
python sync_history_metals.py --from 2017-01-01
python sync_history_btc.py --from 2017-01-01
```

Khuyen nghi dung `sync_history_mt5.py` lam script backfill chuan. Hai script tren chi giu lai de chay rieng tung nhom symbol khi can.

## Repair scripts

```bash
python repair_gaps_metals.py
python repair_gaps_metals.py --apply

python repair_gaps_btc.py
python repair_gaps_btc.py --apply
```

## Script reference

| Script | Symbols | Muc dich |
|--------|---------|----------|
| `check_history.py` | BTCUSDc, XAUUSDc, XAGUSDc | Kiem tra do sau lich su trong broker |
| `sync_history_mt5.py` | BTCUSDc, XAUUSDc, XAGUSDc | Backfill chuan toi 2017, resume-safe |
| `sync_history_metals.py` | XAUUSDc, XAGUSDc | Legacy metals-only backfill |
| `sync_history_btc.py` | BTCUSDc | Legacy BTC-only backfill |
| `main.py` | BTCUSDc, XAUUSDc, XAGUSDc | Realtime sync + startup gap fill |
| `repair_gaps_metals.py` | XAUUSDc, XAGUSDc | Gap repair cho metals |
| `repair_gaps_btc.py` | BTCUSDc | Gap repair cho BTC |
