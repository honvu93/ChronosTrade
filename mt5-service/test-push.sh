#!/bin/bash
# test-push.sh — Kiểm tra toàn bộ pipeline mt5-service mà không lộ token
# Chạy từ thư mục mt5-service/: bash test-push.sh

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Hãy copy .env.example và điền thông tin."
  exit 1
fi

source .env
BASE="$TVGIT_URL"

echo "=== [1] Kiểm tra kết nối TV-GIT ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
if [ "$STATUS" = "200" ]; then
  echo "OK — TV-GIT online ($BASE)"
else
  echo "FAIL — TV-GIT không phản hồi (status: $STATUS)"
  exit 1
fi
echo ""

echo "=== [2] Test UTC timezone: push candle rồi check time trong response ==="
RESP=$(curl -s -X POST "$BASE/api/ohlcv/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGESTION_TOKEN" \
  -d '{
    "batches": [{
      "symbol": "XAUUSDc", "exchange": "MT5", "timeframe": "1h",
      "candles": [{
        "time": "2026-03-08T09:00:00.000Z",
        "open": 2950.50, "high": 2955.00, "low": 2948.00,
        "close": 2952.75, "volume": 1200.5
      }]
    }]
  }')
echo "Response: $RESP"
echo ""

echo "=== [3] Verify sync-status qua API ingestion auth ==="
curl -s "$BASE/api/sync-status/XAUUSDc?timeframe=1h" \
  -H "Authorization: Bearer $INGESTION_TOKEN" | python -m json.tool 2>/dev/null || echo "$?"
echo ""

echo "=== [4] Token sai → expect 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ohlcv/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer WRONG_TOKEN" \
  -d '{"batches":[{"symbol":"XAUUSDc","exchange":"MT5","timeframe":"1h","candles":[]}]}')
echo "Status: $STATUS (expected: 401)"
echo ""

echo "=== [5] Test MT5 connection (cần MT5 terminal đang chạy) ==="
python -c "
from dotenv import load_dotenv; load_dotenv()
from mt5_connector import MT5Connector
c = MT5Connector()
ok = c.connect()
print('MT5 connect:', 'OK' if ok else 'FAIL')
if ok:
    import MetaTrader5 as mt5
    info = mt5.account_info()
    print('Account:', info.login if info else 'N/A')
    c.disconnect()
"
echo ""

echo "=== [6] Test fetch 1 ngày XAUUSD H1 (cần MT5) ==="
python -c "
from dotenv import load_dotenv; load_dotenv()
from mt5_connector import MT5Connector
from historical_fetcher import HistoricalFetcher
c = MT5Connector()
if not c.connect():
    print('MT5 not available — skip')
    exit(0)
f = HistoricalFetcher(c)
df = f.fetch_days('XAUUSDc', 'H1', 1)
print(f'Bars fetched: {len(df)}')
if not df.empty:
    print('First bar:', df.iloc[0].to_dict())
    print('Last bar: ', df.iloc[-1].to_dict())
c.disconnect()
"
echo ""

echo "=== [7] Test build_batch_item + push (cần MT5 + TV-GIT) ==="
python -c "
from dotenv import load_dotenv; load_dotenv()
from mt5_connector import MT5Connector
from historical_fetcher import HistoricalFetcher
from pusher import build_batch_item, push_batch
c = MT5Connector()
if not c.connect():
    print('MT5 not available — skip')
    exit(0)
f = HistoricalFetcher(c)
df = f.fetch_days('XAUUSDc', 'H1', 1)
if df.empty:
    print('No data from MT5')
    exit(0)
sym = {'mt5': 'XAUUSDc', 'tv': 'XAUUSDc'}
item = build_batch_item(sym, 'H1', df)
print(f'Built item: {item[\"symbol\"]} {item[\"timeframe\"]} — {len(item[\"candles\"])} candles')
print(f'First candle time (should be UTC Z): {item[\"candles\"][0][\"time\"]}')
push_batch([item])
print('Push OK')
c.disconnect()
"
