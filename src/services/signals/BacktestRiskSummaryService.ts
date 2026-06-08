import {
    RuntimeLogicTraceDraft,
    RuntimeResultDraft,
    RuntimeSignalDraft,
    RuntimeSignalEventDraft,
} from './types';

export type BacktestRiskSummary = {
    maxConsecutiveLosses: number;
    maxConsecutiveLosingDays: number;
    guardActivationCount: number;
    blockedEntryCount: number;
    equityCurveMaxDdUsd: number;
    equityCurveMaxDdPct: number;
    avgRPerTrade: number;
    medianRPerTrade: number;
    equityCurveFilterBlockCount: number;
    maxDrawdownHaltBlockCount: number;
    minTradeSpacingBlockCount: number;
};

type RiskSummaryInput = {
    initialEquity: number;
    results: Array<Pick<RuntimeResultDraft, 'signalExternalKey' | 'rMultiple' | 'pnlUsd' | 'isOpen' | 'exitTime'>>;
    signals?: Array<Pick<RuntimeSignalDraft, 'externalKey' | 'executionConfigJson'>>;
    events?: Array<Pick<RuntimeSignalEventDraft, 'signalExternalKey' | 'label' | 'metaJson'>>;
    traces?: Array<Pick<RuntimeLogicTraceDraft, 'signalExternalKey' | 'ruleId'>>;
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

const buildDayKey = (time: Date) => time.toISOString().slice(0, 10);

export class BacktestRiskSummaryService {
    public summarize(input: RiskSummaryInput): BacktestRiskSummary {
        const closedResults = input.results
            .filter((result) => !result.isOpen)
            .map((result) => ({
                ...result,
                exitTime: result.exitTime ?? null,
            }));

        const signalByExternalKey = new Map(
            (input.signals ?? [])
                .filter((signal): signal is Pick<RuntimeSignalDraft, 'externalKey' | 'executionConfigJson'> & { externalKey: string } => Boolean(signal.externalKey))
                .map((signal) => [signal.externalKey, signal]),
        );

        let maxConsecutiveLosses = 0;
        let activeLossStreak = 0;
        for (const result of closedResults) {
            const signal = signalByExternalKey.get(result.signalExternalKey);
            const tradeGuards = signal?.executionConfigJson?.['tradeGuards'] as Record<string, unknown> | undefined;
            const rawConsecutiveLosses = Number(tradeGuards?.['rawConsecutiveLosses'] ?? NaN);
            const consecutiveLosses = Number(tradeGuards?.['consecutiveLosses'] ?? NaN);
            if (Number.isFinite(rawConsecutiveLosses) && rawConsecutiveLosses > 0 && consecutiveLosses === 0) {
                activeLossStreak = 0;
            }

            if (result.rMultiple < 0) {
                activeLossStreak += 1;
                maxConsecutiveLosses = Math.max(maxConsecutiveLosses, activeLossStreak);
            } else {
                activeLossStreak = 0;
            }
        }

        const dailyPnl = new Map<string, number>();
        for (const result of closedResults) {
            if (!result.exitTime) {
                continue;
            }
            const dayKey = buildDayKey(result.exitTime);
            dailyPnl.set(dayKey, (dailyPnl.get(dayKey) ?? 0) + Number(result.pnlUsd));
        }

        const sortedDays = Array.from(dailyPnl.entries()).sort((left, right) => left[0].localeCompare(right[0]));
        let maxConsecutiveLosingDays = 0;
        let activeLosingDayStreak = 0;
        for (const [, pnl] of sortedDays) {
            if (pnl < 0) {
                activeLosingDayStreak += 1;
                maxConsecutiveLosingDays = Math.max(maxConsecutiveLosingDays, activeLosingDayStreak);
            } else {
                activeLosingDayStreak = 0;
            }
        }

        const guardActivationCount = closedResults.reduce((count, result) => {
            const signal = signalByExternalKey.get(result.signalExternalKey);
            const tradeGuards = signal?.executionConfigJson?.['tradeGuards'] as Record<string, unknown> | undefined;
            const baseRiskPercent = Number(tradeGuards?.['baseRiskPercent'] ?? NaN);
            const effectiveRiskPercent = Number(tradeGuards?.['effectiveRiskPercent'] ?? NaN);
            if (Number.isFinite(baseRiskPercent) && Number.isFinite(effectiveRiskPercent) && effectiveRiskPercent < baseRiskPercent) {
                return count + 1;
            }
            return count;
        }, 0);

        const blockedSignalKeys = new Set<string>();
        const ecfBlockedKeys = new Set<string>();
        const ddHaltBlockedKeys = new Set<string>();
        const spacingBlockedKeys = new Set<string>();
        for (const event of input.events ?? []) {
            if (event.label === 'RISK BLOCK') {
                blockedSignalKeys.add(event.signalExternalKey);
                const meta = event.metaJson as Record<string, unknown> | undefined;
                const reasons = (meta?.blockedReasons ?? []) as string[];
                for (const reason of reasons) {
                    if (reason.startsWith('equity_curve_filter:')) {
                        ecfBlockedKeys.add(event.signalExternalKey);
                    }
                    if (reason.startsWith('max_drawdown_halt:')) {
                        ddHaltBlockedKeys.add(event.signalExternalKey);
                    }
                    if (reason.startsWith('min_trade_spacing:')) {
                        spacingBlockedKeys.add(event.signalExternalKey);
                    }
                }
            }
        }
        for (const trace of input.traces ?? []) {
            if (trace.ruleId === 'entry_blocked_by_trade_guard') {
                blockedSignalKeys.add(trace.signalExternalKey);
            }
        }

        const sortedByExit = [...closedResults]
            .filter((result): result is typeof result & { exitTime: Date } => result.exitTime instanceof Date)
            .sort((left, right) => left.exitTime.getTime() - right.exitTime.getTime());

        let runningEquity = input.initialEquity;
        let equityPeak = input.initialEquity;
        let equityCurveMaxDdUsd = 0;
        let equityCurveMaxDdPct = 0;

        for (const result of sortedByExit) {
            runningEquity += Number(result.pnlUsd);
            equityPeak = Math.max(equityPeak, runningEquity);
            const drawdownUsd = equityPeak - runningEquity;
            const drawdownPct = equityPeak > 0 ? (drawdownUsd / equityPeak) * 100 : 0;
            equityCurveMaxDdUsd = Math.max(equityCurveMaxDdUsd, drawdownUsd);
            equityCurveMaxDdPct = Math.max(equityCurveMaxDdPct, drawdownPct);
        }

        const rValues = closedResults.map((result) => Number(result.rMultiple));
        const avgRPerTrade = rValues.length > 0
            ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length
            : 0;
        const sortedRValues = [...rValues].sort((left, right) => left - right);
        const medianRPerTrade = sortedRValues.length === 0
            ? 0
            : sortedRValues.length % 2 === 1
                ? sortedRValues[(sortedRValues.length - 1) / 2]
                : (sortedRValues[(sortedRValues.length / 2) - 1] + sortedRValues[sortedRValues.length / 2]) / 2;

        return {
            maxConsecutiveLosses,
            maxConsecutiveLosingDays,
            guardActivationCount,
            blockedEntryCount: blockedSignalKeys.size,
            equityCurveMaxDdUsd: round(equityCurveMaxDdUsd),
            equityCurveMaxDdPct: round(equityCurveMaxDdPct, 4),
            avgRPerTrade: round(avgRPerTrade, 4),
            medianRPerTrade: round(medianRPerTrade, 4),
            equityCurveFilterBlockCount: ecfBlockedKeys.size,
            maxDrawdownHaltBlockCount: ddHaltBlockedKeys.size,
            minTradeSpacingBlockCount: spacingBlockedKeys.size,
        };
    }
}
