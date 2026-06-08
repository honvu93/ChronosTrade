import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { dowTheoryStructureBlock } from './DowTheoryStructureBlock';

const runtimeServices = {
    indicatorSeries: {},
    executionModel: {},
} as SignalRuntimeServices;

function makeBars(closes: number[]): CandleBar[] {
    return closes.map((close, index) => ({
        time: new Date(`2026-03-14T00:${String(index).padStart(2, '0')}:00.000Z`),
        symbol: 'BTCUSDT',
        timeframe: '1h',
        exchange: 'BINANCE',
        open: index === 0 ? close : closes[index - 1]!,
        high: close + 0.5,
        low: close - 0.5,
        close,
        volume: 1000,
        isClosed: true,
    }));
}

function evaluateCondition(
    closes: number[],
    conditionId: string,
    targetIndex = closes.length - 1,
) {
    const bars = makeBars(closes);
    const params = { swingStrength: 1 };
    const state = dowTheoryStructureBlock.initialize(bars, params, runtimeServices);

    return dowTheoryStructureBlock.evaluate(
        bars[targetIndex]!,
        targetIndex > 0 ? bars[targetIndex - 1]! : null,
        bars,
        targetIndex,
        state,
        params,
        conditionId,
        {},
        runtimeServices,
    );
}

describe('dowTheoryStructureBlock', () => {
    it('flags a primary uptrend from confirmed higher highs and higher lows', () => {
        const result = evaluateCondition(
            [10, 12, 11, 14, 13, 16, 15, 18, 17],
            'primary_uptrend_confirmed',
        );

        assert.equal(result.isActive, true);
        assert.equal(result.values['trendState'], 'UPTREND');
        assert.equal(result.values['warningState'], 'NONE');
        assert.equal(result.values['confirmationBasis'], 'close');
        assert.equal(result.values['lastReactionLow'], 14.5);
    });

    it('flags a primary downtrend from confirmed lower highs and lower lows', () => {
        const result = evaluateCondition(
            [18, 16, 17, 14, 15, 12, 13, 10, 11],
            'primary_downtrend_confirmed',
        );

        assert.equal(result.isActive, true);
        assert.equal(result.values['trendState'], 'DOWNTREND');
        assert.equal(result.values['warningState'], 'NONE');
        assert.equal(result.values['lastReactionHigh'], 13.5);
    });

    it('keeps bearish reversal warning separate from confirmed reversal', () => {
        const result = evaluateCondition(
            [10, 12, 11, 14, 13, 16, 14, 15, 14.2],
            'bearish_reversal_warning',
        );

        assert.equal(result.isActive, true);
        assert.equal(result.values['trendState'], 'UPTREND');
        assert.equal(result.values['warningState'], 'BEARISH');
        assert.equal(result.values['lastReactionLow'], 13.5);

        const reversal = evaluateCondition(
            [10, 12, 11, 14, 13, 16, 14, 15, 14.2],
            'bearish_reversal_confirmed',
        );

        assert.equal(reversal.isActive, false);
    });

    it('confirms a bearish reversal only after a close breaks the reaction low', () => {
        const result = evaluateCondition(
            [10, 12, 11, 14, 13, 16, 14, 15, 14.2, 13.0],
            'bearish_reversal_confirmed',
        );

        assert.equal(result.isActive, true);
        assert.equal(result.values['trendState'], 'DOWNTREND');
        assert.equal(result.values['warningState'], 'NONE');
        assert.equal(result.values['lastReactionHigh'], 15.5);
    });

    it('keeps bullish reversal warning separate from confirmed reversal', () => {
        const result = evaluateCondition(
            [18, 16, 17, 14, 15, 12, 14, 13, 14],
            'bullish_reversal_warning',
        );

        assert.equal(result.isActive, true);
        assert.equal(result.values['trendState'], 'DOWNTREND');
        assert.equal(result.values['warningState'], 'BULLISH');
        assert.equal(result.values['lastReactionHigh'], 14.5);

        const reversal = evaluateCondition(
            [18, 16, 17, 14, 15, 12, 14, 13, 14],
            'bullish_reversal_confirmed',
        );

        assert.equal(reversal.isActive, false);
    });

    it('confirms a bullish reversal only after a close breaks the reaction high', () => {
        const result = evaluateCondition(
            [18, 16, 17, 14, 15, 12, 14, 13, 14, 15],
            'bullish_reversal_confirmed',
        );

        assert.equal(result.isActive, true);
        assert.equal(result.values['trendState'], 'UPTREND');
        assert.equal(result.values['warningState'], 'NONE');
        assert.equal(result.values['lastReactionLow'], 12.5);
    });

    it('stays neutral when confirmed swing history is insufficient', () => {
        const result = evaluateCondition(
            [10, 11, 10.5, 11],
            'primary_uptrend_confirmed',
        );

        assert.equal(result.isActive, false);
        assert.equal(result.values['trendState'], 'NEUTRAL');
        assert.equal(result.values['warningState'], 'NONE');
        assert.equal(result.values['lastReactionHigh'], null);
        assert.equal(result.values['lastReactionLow'], null);
    });

    it('treats equal swing highs and lows as non-confirming ties', () => {
        const result = evaluateCondition(
            [10, 12, 11, 12, 11, 12, 11],
            'primary_uptrend_confirmed',
        );

        assert.equal(result.isActive, false);
        assert.equal(result.values['trendState'], 'NEUTRAL');
        assert.equal(result.values['warningState'], 'NONE');

        const downtrend = evaluateCondition(
            [10, 12, 11, 12, 11, 12, 11],
            'primary_downtrend_confirmed',
        );

        assert.equal(downtrend.isActive, false);
    });
});
