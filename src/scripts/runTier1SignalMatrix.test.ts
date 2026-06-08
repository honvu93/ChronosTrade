import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseArgs, summarizeRunOutput } from './runTier1SignalMatrix';

describe('runTier1SignalMatrix', () => {
    it('parses defaults and normalizes aliases', () => {
        const options = parseArgs([
            '--symbols=XAUUSD,BTCUSD',
            '--timeframes=H1,m30',
            '--from=2019-01-01',
            '--to=2026-03-14',
            '--feeBps=5',
            '--slippageBps=3',
            '--maxConcurrency=3',
            '--top=10',
            '--no-write',
        ]);

        assert.deepEqual(options.symbols, ['XAUUSD', 'BTCUSD']);
        assert.deepEqual(options.timeframes, ['1h', '30m']);
        assert.equal(options.from.toISOString(), '2019-01-01T00:00:00.000Z');
        assert.equal(options.to.toISOString(), '2026-03-14T23:59:59.999Z');
        assert.equal(options.executionConfig.entryFeeBps, 5);
        assert.equal(options.executionConfig.exitFeeBps, 5);
        assert.equal(options.executionConfig.entrySlippageBps, 3);
        assert.equal(options.executionConfig.exitSlippageBps, 3);
        assert.equal(options.maxConcurrency, 3);
        assert.equal(options.top, 10);
        assert.equal(options.writeFiles, false);
    });

    it('summarizes closed trades into matrix metrics', () => {
        const metrics = summarizeRunOutput({
            barsProcessed: 100,
            signals: [{}, {}] as any,
            events: [{}, {}, {}] as any,
            traces: [{}, {}] as any,
            results: [
                { isOpen: false, rMultiple: 2, pnlUsd: 400, maxDrawdownPct: -3, win: true },
                { isOpen: false, rMultiple: -1, pnlUsd: -200, maxDrawdownPct: -5.5, win: false },
                { isOpen: false, rMultiple: 0, pnlUsd: 0, maxDrawdownPct: -1, win: false },
                { isOpen: true, rMultiple: 0.5, pnlUsd: 100, maxDrawdownPct: -0.5, win: true },
            ] as any,
        });

        assert.equal(metrics.signalCount, 2);
        assert.equal(metrics.resultCount, 4);
        assert.equal(metrics.closedTrades, 3);
        assert.equal(metrics.openTrades, 1);
        assert.equal(metrics.wins, 1);
        assert.equal(metrics.losses, 1);
        assert.equal(metrics.breakEven, 1);
        assert.equal(metrics.winRate, 33.33);
        assert.equal(metrics.profitFactor, 2);
        assert.equal(metrics.expectancy, 0.333);
        assert.equal(metrics.netR, 1);
        assert.equal(metrics.netUsd, 200);
        assert.equal(metrics.avgWinR, 2);
        assert.equal(metrics.avgLossR, -1);
        assert.equal(metrics.maxDrawdownPct, -5.5);
    });
});
