import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCandleCoverage, CandleCoverageResult } from './CandleCoverageService';

describe('computeCandleCoverage', () => {
    it('returns 100% coverage when all expected bars exist', () => {
        const result = computeCandleCoverage({
            from: new Date('2026-01-01T00:00:00Z'),
            to: new Date('2026-01-01T05:00:00Z'),
            timeframeMinutes: 60,
            actualBarCount: 5,
        });

        assert.equal(result.coveragePct, 100);
        assert.equal(result.expectedBars, 5);
        assert.equal(result.actualBars, 5);
        assert.equal(result.sufficient, true);
    });

    it('returns partial coverage', () => {
        const result = computeCandleCoverage({
            from: new Date('2026-01-01T00:00:00Z'),
            to: new Date('2026-01-01T10:00:00Z'),
            timeframeMinutes: 60,
            actualBarCount: 7,
        });

        assert.equal(result.expectedBars, 10);
        assert.equal(result.actualBars, 7);
        assert.equal(result.coveragePct, 70);
        assert.equal(result.sufficient, false);
    });

    it('returns sufficient for 95%+ coverage', () => {
        const result = computeCandleCoverage({
            from: new Date('2026-01-01T00:00:00Z'),
            to: new Date('2026-01-01T10:00:00Z'),
            timeframeMinutes: 60,
            actualBarCount: 10,
        });

        assert.equal(result.sufficient, true);
    });

    it('handles custom threshold', () => {
        const result = computeCandleCoverage({
            from: new Date('2026-01-01T00:00:00Z'),
            to: new Date('2026-01-01T10:00:00Z'),
            timeframeMinutes: 60,
            actualBarCount: 9,
            sufficientThresholdPct: 90,
        });

        assert.equal(result.coveragePct, 90);
        assert.equal(result.sufficient, true);
    });

    it('returns 0% for empty data', () => {
        const result = computeCandleCoverage({
            from: new Date('2026-01-01T00:00:00Z'),
            to: new Date('2026-01-01T10:00:00Z'),
            timeframeMinutes: 60,
            actualBarCount: 0,
        });

        assert.equal(result.coveragePct, 0);
        assert.equal(result.sufficient, false);
    });

    it('builds a rejection message for insufficient coverage', () => {
        const result = computeCandleCoverage({
            from: new Date('2026-01-01T00:00:00Z'),
            to: new Date('2026-07-01T00:00:00Z'),
            timeframeMinutes: 5,
            actualBarCount: 30000,
            symbol: 'XAUUSDc',
            timeframe: 'M5',
        });

        assert.equal(result.sufficient, false);
        assert.ok(result.message.includes('XAUUSDc'));
        assert.ok(result.message.includes('M5'));
        assert.ok(result.message.includes('%'));
    });
});
