import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { computeMetrics } from './SignalLiveEligibilityService';

function makeResult(win: boolean, rMultiple: number, maxDrawdownPct = -3.0) {
    return { isOpen: false, win, rMultiple, maxDrawdownPct };
}

describe('computeMetrics', () => {
    it('computes basic stats from closed trade results', () => {
        const results = [
            makeResult(true, 2.0),
            makeResult(true, 1.5),
            makeResult(false, -0.5),
        ];
        const m = computeMetrics(results);

        assert.equal(m.closedTrades, 3);
        assert.equal(m.wins, 2);
        assert.equal(m.losses, 1);
        assert.ok(m.profitFactor > 1, 'PF should be positive');
        assert.ok(m.netR > 0, 'netR should be positive');
    });

    it('returns avgWinR as mean R of winning trades', () => {
        const results = [
            makeResult(true, 2.0),
            makeResult(true, 1.0),
            makeResult(false, -0.5),
        ];
        const m = computeMetrics(results);
        assert.equal(m.avgWinR, 1.5, 'avgWinR = (2.0 + 1.0) / 2');
    });

    it('returns avgLossR as positive mean of losing trade R', () => {
        const results = [
            makeResult(true, 2.0),
            makeResult(false, -0.5),
            makeResult(false, -1.0),
        ];
        const m = computeMetrics(results);
        assert.equal(m.avgLossR, 0.75, 'avgLossR = (0.5 + 1.0) / 2 = 0.75');
    });

    it('returns null avgWinR and avgLossR when no wins or losses', () => {
        const allWins = [makeResult(true, 1.0), makeResult(true, 2.0)];
        const m = computeMetrics(allWins);
        assert.equal(m.avgWinR, 1.5);
        assert.equal(m.avgLossR, null, 'no losses → avgLossR is null');
    });

    it('classifies confidenceTier correctly', () => {
        const limited = Array.from({ length: 5 }, () => makeResult(true, 1.0));
        const validated = Array.from({ length: 15 }, () => makeResult(true, 1.0));
        const high = Array.from({ length: 55 }, () => makeResult(true, 1.0));

        assert.equal(computeMetrics(limited).confidenceTier, 'LIMITED', '< 10 trades = LIMITED');
        assert.equal(computeMetrics(validated).confidenceTier, 'VALIDATED', '10–49 trades = VALIDATED');
        assert.equal(computeMetrics(high).confidenceTier, 'HIGH', '≥ 50 trades = HIGH');
    });

    it('computes estimatedTradesPerDay when tradingDays is provided', () => {
        const results = Array.from({ length: 30 }, () => makeResult(true, 1.0));
        const m = computeMetrics(results, { tradingDays: 60 });
        assert.equal(m.estimatedTradesPerDay, 0.5, '30 trades / 60 days = 0.5 trades/day');
    });

    it('returns null estimatedTradesPerDay when tradingDays is not provided', () => {
        const results = [makeResult(true, 1.0)];
        const m = computeMetrics(results);
        assert.equal(m.estimatedTradesPerDay, null);
    });

    it('returns null confidenceTier when no closed trades', () => {
        const m = computeMetrics([]);
        assert.equal(m.confidenceTier, null);
        assert.equal(m.avgWinR, null);
        assert.equal(m.avgLossR, null);
    });
});
