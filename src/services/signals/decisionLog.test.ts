import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isFullDecisionLogEntry,
    compressDecisionLog,
    type DecisionLogEntry,
    type CompressedDecisionLogEntry,
    type DecisionLogItem,
} from './types';

describe('DecisionLog types', () => {
    test('isFullDecisionLogEntry returns true for full entries', () => {
        const entry: DecisionLogEntry = {
            barIndex: 0,
            timestamp: new Date('2025-01-01T00:00:00Z'),
            ohlcv: { open: 100, high: 105, low: 99, close: 103, volume: 1000 },
            conditions: [
                { name: 'SL', result: 'PASS' },
                { name: 'TP', result: 'TRIGGERED' },
            ],
            action: 'CLOSE',
            stateSnapshot: {
                activeStop: 98,
                remainingFraction: 1.0,
                realizedNetR: 0,
                movedToBreakeven: false,
                partialTaken: false,
                maxDrawdownPct: 0.5,
            },
        };
        assert.equal(isFullDecisionLogEntry(entry), true);
    });

    test('isFullDecisionLogEntry returns false for compressed entries', () => {
        const entry: CompressedDecisionLogEntry = {
            barIndex: 5,
            action: 'HOLD',
        };
        assert.equal(isFullDecisionLogEntry(entry), false);
    });
});

describe('compressDecisionLog', () => {
    const makeFullEntry = (
        barIndex: number,
        action: DecisionLogEntry['action'],
        activeStop: number
    ): DecisionLogEntry => ({
        barIndex,
        timestamp: new Date(`2025-01-01T00:${String(barIndex).padStart(2, '0')}:00Z`),
        ohlcv: { open: 100, high: 105, low: 99, close: 103, volume: 1000 },
        conditions: [
            { name: 'SL', result: 'PASS' },
            { name: 'TP', result: 'PASS' },
        ],
        action,
        stateSnapshot: {
            activeStop,
            remainingFraction: 1.0,
            realizedNetR: 0,
            movedToBreakeven: false,
            partialTaken: false,
            maxDrawdownPct: 0,
        },
    });

    test('compresses consecutive HOLD bars with no state change', () => {
        const entries: DecisionLogEntry[] = [
            makeFullEntry(0, 'HOLD', 98),
            makeFullEntry(1, 'HOLD', 98),
            makeFullEntry(2, 'HOLD', 98),
            makeFullEntry(3, 'MOVE_SL', 100), // state change
            makeFullEntry(4, 'HOLD', 100),
            makeFullEntry(5, 'CLOSE', 100),
        ];

        const compressed = compressDecisionLog(entries);

        // First entry always full
        assert.equal(isFullDecisionLogEntry(compressed[0]), true);
        // Bars 1,2 compressed
        assert.equal(isFullDecisionLogEntry(compressed[1]), false);
        assert.equal((compressed[1] as CompressedDecisionLogEntry).barIndex, 1);
        assert.equal(isFullDecisionLogEntry(compressed[2]), false);
        assert.equal((compressed[2] as CompressedDecisionLogEntry).barIndex, 2);
        // Bar 3 state change — full
        assert.equal(isFullDecisionLogEntry(compressed[3]), true);
        assert.equal((compressed[3] as DecisionLogEntry).action, 'MOVE_SL');
        // Bar 4 HOLD after state change — compressed
        assert.equal(isFullDecisionLogEntry(compressed[4]), false);
        // Bar 5 CLOSE — full
        assert.equal(isFullDecisionLogEntry(compressed[5]), true);
        assert.equal((compressed[5] as DecisionLogEntry).action, 'CLOSE');

        assert.equal(compressed.length, 6);
    });

    test('preserves all entries when every bar has state changes', () => {
        const entries: DecisionLogEntry[] = [
            makeFullEntry(0, 'HOLD', 98),
            makeFullEntry(1, 'MOVE_SL', 99),
            makeFullEntry(2, 'PARTIAL_CLOSE', 100),
            makeFullEntry(3, 'CLOSE', 100),
        ];

        const compressed = compressDecisionLog(entries);
        assert.equal(compressed.length, 4);
        compressed.forEach((e) => assert.equal(isFullDecisionLogEntry(e), true));
    });

    test('returns empty array for empty input', () => {
        const compressed = compressDecisionLog([]);
        assert.equal(compressed.length, 0);
    });

    test('single entry returns full entry', () => {
        const entries: DecisionLogEntry[] = [makeFullEntry(0, 'CLOSE', 98)];
        const compressed = compressDecisionLog(entries);
        assert.equal(compressed.length, 1);
        assert.equal(isFullDecisionLogEntry(compressed[0]), true);
    });

    test('compression reduces size for long HOLD sequences', () => {
        const entries: DecisionLogEntry[] = [];
        for (let i = 0; i < 30; i++) {
            entries.push(makeFullEntry(i, i === 29 ? 'CLOSE' : 'HOLD', 98));
        }

        const compressed = compressDecisionLog(entries);
        const fullCount = compressed.filter((e: DecisionLogItem) => isFullDecisionLogEntry(e)).length;
        const compressedCount = compressed.filter((e: DecisionLogItem) => !isFullDecisionLogEntry(e)).length;

        // First + last = 2 full, 28 compressed
        assert.equal(fullCount, 2);
        assert.equal(compressedCount, 28);
    });
});
