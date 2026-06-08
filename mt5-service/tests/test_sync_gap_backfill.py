import unittest
from datetime import datetime, timedelta, timezone

import sync_gap_backfill


class SyncGapBackfillLogicTests(unittest.TestCase):
    def test_filter_expected_timeline_skips_closed_metal_hours(self):
        timeline = [
            datetime(2026, 3, 27, 20, 0, tzinfo=timezone.utc),
            datetime(2026, 3, 27, 21, 0, tzinfo=timezone.utc),
            datetime(2026, 3, 28, 10, 0, tzinfo=timezone.utc),
            datetime(2026, 3, 29, 21, 0, tzinfo=timezone.utc),
            datetime(2026, 3, 29, 22, 0, tzinfo=timezone.utc),
        ]

        result = sync_gap_backfill.filter_expected_timeline(timeline, crypto=False)

        self.assertEqual(
            result,
            [
                datetime(2026, 3, 27, 20, 0, tzinfo=timezone.utc),
                datetime(2026, 3, 29, 22, 0, tzinfo=timezone.utc),
            ],
        )

    def test_classify_gap_range_marks_stale_tail(self):
        symbol_cfg = {"tv": "BTCUSD", "mt5": "BTCUSDc", "market": "crypto"}
        end = datetime(2026, 3, 26, 12, 15, tzinfo=timezone.utc)
        missing_times = [
            datetime(2026, 3, 26, 12, 5, tzinfo=timezone.utc),
            datetime(2026, 3, 26, 12, 10, tzinfo=timezone.utc),
            datetime(2026, 3, 26, 12, 15, tzinfo=timezone.utc),
        ]

        result = sync_gap_backfill.classify_gap_range(
            missing_times=missing_times,
            symbol_cfg=symbol_cfg,
            date_to=end,
            min_gap_bars=1,
            has_existing_data=True,
        )

        self.assertEqual(result, "stale_tail")

    def test_classify_gap_range_marks_empty_range_when_window_has_no_data(self):
        symbol_cfg = {"tv": "XAUUSD", "mt5": "XAUUSDc", "market": "metal"}
        end = datetime(2026, 3, 26, 12, 0, tzinfo=timezone.utc)
        missing_times = [
            datetime(2026, 3, 26, 11, 0, tzinfo=timezone.utc),
            datetime(2026, 3, 26, 12, 0, tzinfo=timezone.utc),
        ]

        result = sync_gap_backfill.classify_gap_range(
            missing_times=missing_times,
            symbol_cfg=symbol_cfg,
            date_to=end,
            min_gap_bars=1,
            has_existing_data=False,
        )

        self.assertEqual(result, "empty_range")

    def test_group_missing_ranges_splits_contiguous_blocks(self):
        symbol_cfg = {"tv": "BTCUSD", "mt5": "BTCUSDc", "market": "crypto"}
        start = datetime(2026, 3, 26, 10, 0, tzinfo=timezone.utc)
        missing_times = [
            start,
            start + timedelta(minutes=5),
            start + timedelta(minutes=20),
        ]

        result = sync_gap_backfill.group_missing_ranges(
            missing_times=missing_times,
            symbol_cfg=symbol_cfg,
            timeframe_mt5="M5",
            date_to=start + timedelta(minutes=30),
            min_gap_bars=1,
            has_existing_data=True,
        )

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].missing_bars, 2)
        self.assertEqual(result[0].gap_type, "gap")
        self.assertEqual(result[1].missing_bars, 1)
        self.assertEqual(result[1].gap_type, "gap")


if __name__ == "__main__":
    unittest.main()
