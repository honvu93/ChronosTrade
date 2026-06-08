import unittest
from datetime import datetime

import pusher


class PusherChunkingTests(unittest.TestCase):
    def test_build_batch_item_canonicalizes_symbol_and_extended_timeframes(self):
        class _Row:
            def __init__(self, time, open_, high, low, close, volume):
                self.time = time
                self.open = open_
                self.high = high
                self.low = low
                self.close = close
                self.volume = volume

        class _Frame:
            def itertuples(self):
                return iter([
                    _Row(datetime(2026, 3, 12, 0, 0, 0), 1.0, 2.0, 0.5, 1.5, 10.0),
                ])

        item = pusher.build_batch_item(
            {"mt5": "XAUUSDc", "tv": "XAUUSD", "aliases": ["XAUUSD"]},
            "M30",
            _Frame(),
        )

        self.assertEqual(item["symbol"], "XAUUSD")
        self.assertEqual(item["timeframe"], "30m")

    def test_split_oversized_batch_item_keeps_metadata_and_slices_candles(self):
        item = {
            "symbol": "BTCUSD",
            "exchange": "MT5",
            "timeframe": "1m",
            "candles": [{"time": str(index)} for index in range(12_001)],
        }

        result = pusher._split_oversized_batch_item(item, max_candles=5_000)

        self.assertEqual(len(result), 3)
        self.assertEqual([len(entry["candles"]) for entry in result], [5_000, 5_000, 2_001])
        self.assertTrue(all(entry["symbol"] == "BTCUSD" for entry in result))
        self.assertTrue(all(entry["timeframe"] == "1m" for entry in result))

    def test_normalize_items_for_push_splits_only_items_that_need_it(self):
        small_item = {
            "symbol": "XAUUSD",
            "exchange": "MT5",
            "timeframe": "1h",
            "candles": [{"time": "1"}],
        }
        large_item = {
            "symbol": "BTCUSD",
            "exchange": "MT5",
            "timeframe": "1m",
            "candles": [{"time": str(index)} for index in range(6_000)],
        }

        result = pusher._normalize_items_for_push([small_item, large_item])

        self.assertEqual(len(result), 3)
        self.assertEqual(len(result[0]["candles"]), 1)
        self.assertEqual(len(result[1]["candles"]), 5_000)
        self.assertEqual(len(result[2]["candles"]), 1_000)

    def test_chunk_items_by_request_limits_caps_batches_per_request(self):
        items = [{"candles": []} for _ in range(28)]

        result = pusher._chunk_items_by_request_limits(items, max_batches=25)

        self.assertEqual([len(chunk) for chunk in result], [25, 3])


if __name__ == "__main__":
    unittest.main()
