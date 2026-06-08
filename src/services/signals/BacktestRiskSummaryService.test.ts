import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BacktestRiskSummaryService } from './BacktestRiskSummaryService';

describe('BacktestRiskSummaryService', () => {
    it('summarizes account-level risk metrics from runtime outputs', () => {
        const service = new BacktestRiskSummaryService();

        const summary = service.summarize({
            initialEquity: 10_000,
            signals: [
                { externalKey: 'sig-1', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 1 } } },
                { externalKey: 'sig-2', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 0.5 } } },
                { externalKey: 'sig-3', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 1 } } },
                { externalKey: 'sig-4', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 1 } } },
                { externalKey: 'sig-5', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 0.25 } } },
                { externalKey: 'sig-6', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 1 } } },
            ],
            events: [
                { signalExternalKey: 'blocked-a', label: 'RISK BLOCK' },
                { signalExternalKey: 'blocked-a', label: 'RISK BLOCK' },
            ],
            traces: [
                { signalExternalKey: 'blocked-a', ruleId: 'entry_blocked_by_trade_guard' },
                { signalExternalKey: 'blocked-b', ruleId: 'entry_blocked_by_trade_guard' },
            ],
            results: [
                { signalExternalKey: 'sig-1', rMultiple: -1, pnlUsd: -100, isOpen: false, exitTime: new Date('2026-03-01T09:00:00.000Z') },
                { signalExternalKey: 'sig-2', rMultiple: -1.2, pnlUsd: -120, isOpen: false, exitTime: new Date('2026-03-01T11:00:00.000Z') },
                { signalExternalKey: 'sig-3', rMultiple: 0, pnlUsd: 0, isOpen: false, exitTime: new Date('2026-03-01T12:00:00.000Z') },
                { signalExternalKey: 'sig-4', rMultiple: -0.8, pnlUsd: -80, isOpen: false, exitTime: new Date('2026-03-02T10:00:00.000Z') },
                { signalExternalKey: 'sig-5', rMultiple: -0.5, pnlUsd: -50, isOpen: false, exitTime: new Date('2026-03-03T10:00:00.000Z') },
                { signalExternalKey: 'sig-6', rMultiple: 2, pnlUsd: 200, isOpen: false, exitTime: new Date('2026-03-04T10:00:00.000Z') },
            ],
        });

        assert.deepEqual(summary, {
            maxConsecutiveLosses: 2,
            maxConsecutiveLosingDays: 3,
            guardActivationCount: 2,
            blockedEntryCount: 2,
            equityCurveMaxDdUsd: 350,
            equityCurveMaxDdPct: 3.5,
            avgRPerTrade: -0.25,
            medianRPerTrade: -0.65,
            equityCurveFilterBlockCount: 0,
            maxDrawdownHaltBlockCount: 0,
            minTradeSpacingBlockCount: 0,
        });
    });

    it('resets consecutive-loss counting after a cooldown-reset entry', () => {
        const service = new BacktestRiskSummaryService();

        const summary = service.summarize({
            initialEquity: 10_000,
            signals: [
                { externalKey: 'sig-1', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 1, rawConsecutiveLosses: 0, consecutiveLosses: 0 } } },
                { externalKey: 'sig-2', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 1, rawConsecutiveLosses: 1, consecutiveLosses: 1 } } },
                { externalKey: 'sig-3', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 1, rawConsecutiveLosses: 2, consecutiveLosses: 0 } } },
                { externalKey: 'sig-4', executionConfigJson: { tradeGuards: { baseRiskPercent: 1, effectiveRiskPercent: 1, rawConsecutiveLosses: 1, consecutiveLosses: 1 } } },
            ],
            results: [
                { signalExternalKey: 'sig-1', rMultiple: -1, pnlUsd: -100, isOpen: false, exitTime: new Date('2026-03-01T09:00:00.000Z') },
                { signalExternalKey: 'sig-2', rMultiple: -1, pnlUsd: -100, isOpen: false, exitTime: new Date('2026-03-01T11:00:00.000Z') },
                { signalExternalKey: 'sig-3', rMultiple: -1, pnlUsd: -100, isOpen: false, exitTime: new Date('2026-03-02T09:00:00.000Z') },
                { signalExternalKey: 'sig-4', rMultiple: -1, pnlUsd: -100, isOpen: false, exitTime: new Date('2026-03-02T11:00:00.000Z') },
            ],
        });

        assert.equal(summary.maxConsecutiveLosses, 2);
    });
});
