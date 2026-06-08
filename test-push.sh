#!/bin/bash
# test-push.sh — Test ingestion endpoints mà không lộ token trong shell history
# Chạy từ root TV-GIT: bash test-push.sh

if [ ! -f .env ]; then
  echo "ERROR: .env not found."
  exit 1
fi

# Đọc biến từ .env (chỉ lấy dòng không có comment)
export $(grep -v '^#' .env | xargs)

BASE="http://localhost:3001"

echo "=== T1: POST /api/ohlcv/batch (valid candles) ==="
curl -s -X POST "$BASE/api/ohlcv/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGESTION_TOKEN" \
  -d '{
    "batches": [
      {
        "symbol": "XAUUSD",
        "exchange": "MT5",
        "timeframe": "1h",
        "candles": [
          {
            "time": "2026-03-08T10:00:00.000Z",
            "open": 2950.50, "high": 2955.00, "low": 2948.00,
            "close": 2952.75, "volume": 1200.5
          },
          {
            "time": "2026-03-08T11:00:00.000Z",
            "open": 2952.75, "high": 2960.00, "low": 2950.00,
            "close": 2957.10, "volume": 980.0
          }
        ]
      },
      {
        "symbol": "XAGUSD",
        "exchange": "MT5",
        "timeframe": "1h",
        "candles": [
          {
            "time": "2026-03-08T10:00:00.000Z",
            "open": 31.20, "high": 31.45, "low": 31.10,
            "close": 31.35, "volume": 500.0
          }
        ]
      }
    ]
  }' | python -m json.tool 2>/dev/null || python3 -m json.tool 2>/dev/null || cat
echo ""

echo "=== T2: POST /api/ohlcv/:symbol (single endpoint) ==="
curl -s -X POST "$BASE/api/ohlcv/XAUUSD" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGESTION_TOKEN" \
  -d '{
    "exchange": "MT5",
    "timeframe": "1h",
    "candles": [
      {
        "time": "2026-03-08T12:00:00.000Z",
        "open": 2957.10, "high": 2965.00, "low": 2955.00,
        "close": 2962.30, "volume": 1100.0
      }
    ]
  }' | python -m json.tool 2>/dev/null || python3 -m json.tool 2>/dev/null || cat
echo ""

echo "=== T3: Wrong token → expect 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/ohlcv/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer WRONG_TOKEN" \
  -d '{"batches":[]}')
echo "HTTP status: $STATUS (expected: 401)"
echo ""

echo "=== T4: Invalid candle (high < low) → expect rejected: 1 ==="
curl -s -X POST "$BASE/api/ohlcv/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGESTION_TOKEN" \
  -d '{
    "batches": [{
      "symbol": "XAUUSD",
      "exchange": "MT5",
      "timeframe": "1h",
      "candles": [{
        "time": "2026-03-08T13:00:00.000Z",
        "open": 2950.0, "high": 2940.0, "low": 2960.0,
        "close": 2945.0, "volume": 100.0
      }]
    }]
  }' | python -m json.tool 2>/dev/null || python3 -m json.tool 2>/dev/null || cat
echo ""

echo "=== T5: Duplicate candle → expect upsert (no error) ==="
curl -s -X POST "$BASE/api/ohlcv/batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INGESTION_TOKEN" \
  -d '{
    "batches": [{
      "symbol": "XAUUSD",
      "exchange": "MT5",
      "timeframe": "1h",
      "candles": [{
        "time": "2026-03-08T10:00:00.000Z",
        "open": 2950.50, "high": 2955.00, "low": 2948.00,
        "close": 2952.75, "volume": 1200.5
      }]
    }]
  }' | python -m json.tool 2>/dev/null || python3 -m json.tool 2>/dev/null || cat
echo ""

echo "=== T6: GET verify data in DB via API ==="
curl -s "$BASE/api/ohlcv/XAUUSD?timeframe=1h&limit=5" \
  | python -m json.tool 2>/dev/null || python3 -m json.tool 2>/dev/null || cat
echo ""

echo "=== DONE. Check DB manually: ==="
echo "SELECT symbol, timeframe, COUNT(*), MIN(time), MAX(time)"
echo "FROM price_candles WHERE symbol IN ('XAUUSD','XAGUSD')"
echo "GROUP BY symbol, timeframe ORDER BY symbol, timeframe;"
