import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CandleBar, SignalRuntimeServices } from '../../types';
import { sessionBlock } from './SessionBlock';

const runtimeServices = {
    indicatorSeries: {},
    executionModel: {},
} as SignalRuntimeServices;

function makeBarAtHour(utcHour: number): CandleBar {
    return {
        time: new Date(Date.UTC(2026, 2, 9, utcHour, 0)),
        symbol: 'XAUUSD',
        timeframe: '1h',
        exchange: 'TEST',
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
        isClosed: true,
    };
}

function evaluateSession(
    utcHour: number,
    startHour: number,
    endHour: number,
): { isActive: boolean; values: Record<string, unknown> } {
    const bar = makeBarAtHour(utcHour);
    const params = { startHour, endHour };
    const state = sessionBlock.initialize([bar], params, runtimeServices);

    return sessionBlock.evaluate(
        bar, null, [bar], 0, state, params,
        'in_session', {}, runtimeServices,
    );
}

describe('sessionBlock', () => {
    it('detects bar within a normal daytime session (8-22 UTC)', () => {
        assert.equal(evaluateSession(10, 8, 22).isActive, true);
        assert.equal(evaluateSession(8, 8, 22).isActive, true);  // start hour inclusive
        assert.equal(evaluateSession(21, 8, 22).isActive, true); // end hour exclusive
    });

    it('rejects bars outside a normal daytime session', () => {
        assert.equal(evaluateSession(7, 8, 22).isActive, false);
        assert.equal(evaluateSession(22, 8, 22).isActive, false); // end hour is exclusive
        assert.equal(evaluateSession(23, 8, 22).isActive, false);
        assert.equal(evaluateSession(3, 8, 22).isActive, false);
    });

    it('handles overnight session (22-08 UTC)', () => {
        assert.equal(evaluateSession(22, 22, 8).isActive, true);
        assert.equal(evaluateSession(23, 22, 8).isActive, true);
        assert.equal(evaluateSession(0, 22, 8).isActive, true);
        assert.equal(evaluateSession(3, 22, 8).isActive, true);
        assert.equal(evaluateSession(7, 22, 8).isActive, true);
    });

    it('rejects bars outside overnight session', () => {
        assert.equal(evaluateSession(8, 22, 8).isActive, false);
        assert.equal(evaluateSession(12, 22, 8).isActive, false);
        assert.equal(evaluateSession(21, 22, 8).isActive, false);
    });

    it('handles full-day session (0-0 or same start/end)', () => {
        // When start === end, no hour satisfies start <= end path (hour >= 0 && hour < 0 = false)
        // This is an edge case: effectively filters all bars
        assert.equal(evaluateSession(0, 0, 0).isActive, false);
        assert.equal(evaluateSession(12, 0, 0).isActive, false);
    });

    it('exposes UTC hour in values', () => {
        const result = evaluateSession(15, 8, 22);
        assert.equal(result.values['utcHour'], 15);
    });

    it('handles single-hour session (e.g., 8-9)', () => {
        assert.equal(evaluateSession(8, 8, 9).isActive, true);
        assert.equal(evaluateSession(9, 8, 9).isActive, false);
        assert.equal(evaluateSession(7, 8, 9).isActive, false);
    });

    it('handles Asian session (0-7 UTC)', () => {
        assert.equal(evaluateSession(0, 0, 7).isActive, true);
        assert.equal(evaluateSession(3, 0, 7).isActive, true);
        assert.equal(evaluateSession(6, 0, 7).isActive, true);
        assert.equal(evaluateSession(7, 0, 7).isActive, false);
        assert.equal(evaluateSession(12, 0, 7).isActive, false);
    });
});
