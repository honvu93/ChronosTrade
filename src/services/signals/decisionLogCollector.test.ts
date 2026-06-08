import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionLogCollector } from './decisionLogCollector';

const makeOhlcv = () => ({ open: 100, high: 105, low: 99, close: 103, volume: 1000 });
const makeSnapshot = (overrides = {}) => ({
    activeStop: 98,
    remainingFraction: 1.0,
    realizedNetR: 0,
    movedToBreakeven: false,
    partialTaken: false,
    maxDrawdownPct: 0,
    ...overrides,
});

describe('DecisionLogCollector', () => {
    test('captures a single bar with HOLD action', () => {
        const collector = new DecisionLogCollector();
        collector.startBar(0, new Date('2025-01-01'), makeOhlcv(), makeSnapshot());
        collector.recordCondition('SL', false);
        collector.recordCondition('TP', false);
        collector.endBar('HOLD');

        const log = collector.getLog();
        assert.equal(log.length, 1);
        assert.equal(log[0].barIndex, 0);
        assert.equal(log[0].action, 'HOLD');
        assert.equal(log[0].conditions.length, 2);
        assert.equal(log[0].conditions[0].name, 'SL');
        assert.equal(log[0].conditions[0].result, 'PASS');
        assert.equal(log[0].conditions[1].name, 'TP');
        assert.equal(log[0].conditions[1].result, 'PASS');
    });

    test('captures TRIGGERED condition and CLOSE action', () => {
        const collector = new DecisionLogCollector();
        collector.startBar(5, new Date('2025-01-01'), makeOhlcv(), makeSnapshot());
        collector.recordCondition('SL', true);
        collector.recordCondition('PARTIAL', false, true); // skipped after SL
        collector.endBar('CLOSE');

        const log = collector.getLog();
        assert.equal(log.length, 1);
        assert.equal(log[0].action, 'CLOSE');
        assert.equal(log[0].conditions[0].result, 'TRIGGERED');
        assert.equal(log[0].conditions[1].result, 'SKIPPED');
    });

    test('captures multiple bars in sequence', () => {
        const collector = new DecisionLogCollector();

        collector.startBar(0, new Date('2025-01-01'), makeOhlcv(), makeSnapshot());
        collector.recordCondition('SL', false);
        collector.endBar('HOLD');

        collector.startBar(1, new Date('2025-01-01'), makeOhlcv(), makeSnapshot({ movedToBreakeven: true }));
        collector.recordCondition('SL', false);
        collector.recordCondition('BE', true);
        collector.endBar('MOVE_SL');

        collector.startBar(2, new Date('2025-01-01'), makeOhlcv(), makeSnapshot({ movedToBreakeven: true }));
        collector.recordCondition('SL', true);
        collector.endBar('CLOSE');

        const log = collector.getLog();
        assert.equal(log.length, 3);
        assert.equal(log[0].action, 'HOLD');
        assert.equal(log[1].action, 'MOVE_SL');
        assert.equal(log[2].action, 'CLOSE');
    });

    test('auto-ends previous bar when startBar called without endBar', () => {
        const collector = new DecisionLogCollector();
        collector.startBar(0, new Date('2025-01-01'), makeOhlcv(), makeSnapshot());
        collector.recordCondition('SL', false);
        // no endBar — next startBar auto-closes with HOLD
        collector.startBar(1, new Date('2025-01-01'), makeOhlcv(), makeSnapshot());
        collector.recordCondition('SL', false);
        collector.endBar('HOLD');

        const log = collector.getLog();
        assert.equal(log.length, 2);
        assert.equal(log[0].action, 'HOLD');
    });

    test('getLog auto-ends open bar', () => {
        const collector = new DecisionLogCollector();
        collector.startBar(0, new Date('2025-01-01'), makeOhlcv(), makeSnapshot());
        collector.recordCondition('SL', false);

        const log = collector.getLog();
        assert.equal(log.length, 1);
        assert.equal(log[0].action, 'HOLD');
    });

    test('captures state snapshot correctly', () => {
        const snapshot = makeSnapshot({ activeStop: 95, remainingFraction: 0.5, partialTaken: true });
        const collector = new DecisionLogCollector();
        collector.startBar(0, new Date('2025-01-01'), makeOhlcv(), snapshot);
        collector.endBar('HOLD');

        const log = collector.getLog();
        assert.equal(log[0].stateSnapshot.activeStop, 95);
        assert.equal(log[0].stateSnapshot.remainingFraction, 0.5);
        assert.equal(log[0].stateSnapshot.partialTaken, true);
    });

    test('empty collector returns empty log', () => {
        const collector = new DecisionLogCollector();
        assert.equal(collector.getLog().length, 0);
    });
});
