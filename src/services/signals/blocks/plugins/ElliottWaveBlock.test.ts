import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { elliottWaveBlock } from './ElliottWaveBlock';

const runtimeServices = {
    indicatorSeries: {} as SignalRuntimeServices['indicatorSeries'],
    executionModel: {} as SignalRuntimeServices['executionModel'],
} as SignalRuntimeServices;

function makeBars(closes: number[]): CandleBar[] {
    return closes.map((close, index) => ({
        time: new Date(Date.UTC(2026, 0, 1, 0, index)),
        symbol: 'XAUUSD',
        timeframe: 'M1',
        exchange: 'TEST',
        open: close,
        high: close + 0.2,
        low: close - 0.2,
        close,
        volume: 1000,
        isClosed: true,
    }));
}

function findFirstActiveIndex(closes: number[], conditionId: string): number {
    const bars = makeBars(closes);
    let state = elliottWaveBlock.initialize(bars, { pivotLength: 1 }, runtimeServices);

    for (let index = 0; index < bars.length; index += 1) {
        const result = elliottWaveBlock.evaluate(
            bars[index]!,
            index > 0 ? bars[index - 1]! : null,
            bars,
            index,
            state,
            { pivotLength: 1 },
            conditionId,
            {},
            runtimeServices,
        );
        state = result.state;

        if (result.isActive) {
            return index;
        }
    }

    return -1;
}

describe('elliottWaveBlock', () => {
    it('detects a bullish ABC corrective completion after a bullish motive wave', () => {
        const activeIndex = findFirstActiveIndex(
            [13, 10, 15, 12, 20, 16, 25, 18, 22, 17, 19, 18],
            'corrective_bullish',
        );

        assert.equal(activeIndex, 10);
    });

    it('detects a bearish ABC corrective completion after a bearish motive wave', () => {
        const activeIndex = findFirstActiveIndex(
            [17, 20, 15, 18, 10, 14, 5, 12, 8, 13, 11, 12],
            'corrective_bearish',
        );

        assert.equal(activeIndex, 10);
    });
});
