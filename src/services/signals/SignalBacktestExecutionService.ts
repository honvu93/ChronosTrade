import {
    BacktestRunStatus,
    PositionSide,
    Prisma,
    PrismaClient,
    SignalSourceType,
    TradingSession,
} from '@prisma/client';
import { createHash } from 'crypto';
import { SignalAnnotationSerializer } from './SignalAnnotationSerializer';
import { SignalBacktestRunService } from './SignalBacktestRunService';
import { LogicTraceSerializer } from './LogicTraceSerializer';
import { SignalPlatformService } from './SignalPlatformService';
import { ExecuteSignalBacktestResult, RuntimeSignalDraft } from './types';
import { normalizeSymbol } from '../../utils/symbols';
import {
    createTradingWebhookDeliveryService,
    TradingWebhookDeliveryService,
} from '../trading/TradingWebhookDeliveryService';

const toJsonValue = (value: Record<string, unknown> | null | undefined) => (
    value ? value as Prisma.InputJsonValue : undefined
);

const normalizeSignalDraft = (draft: RuntimeSignalDraft, index: number, backtestRunId: string): RuntimeSignalDraft => ({
    ...draft,
    externalKey: draft.externalKey || `${backtestRunId}:SIGNAL:${index + 1}`,
});

const normalizeStrategyCode = (value: string): string => {
    const normalized = value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (normalized.length <= 40) {
        return normalized;
    }

    const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 8).toUpperCase();
    return `${normalized.slice(0, 31)}_${digest}`;
};

const deriveFallbackStrategyCode = (
    signal: RuntimeSignalDraft,
    run: {
        signalCode: string | null;
        signalVersion: number | null;
    },
): string | null => {
    const candidates = [
        signal.strategyCode,
        signal.definitionCode,
        run.signalCode,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return normalizeStrategyCode(candidate);
        }
    }

    if (run.signalVersion !== null && run.signalCode) {
        return normalizeStrategyCode(`${run.signalCode}_V${run.signalVersion}`);
    }

    return null;
};

export class SignalBacktestExecutionService {
    private readonly platform: SignalPlatformService;
    private readonly annotationSerializer: SignalAnnotationSerializer;
    private readonly traceSerializer: LogicTraceSerializer;
    private readonly backtests: SignalBacktestRunService;

    constructor(
        private prisma: PrismaClient,
        private readonly webhookDeliveryService: Pick<TradingWebhookDeliveryService, 'deliverConfiguredOutputs'> = createTradingWebhookDeliveryService(prisma),
    ) {
        this.platform = new SignalPlatformService(prisma);
        this.annotationSerializer = this.platform.getAnnotationSerializer();
        this.traceSerializer = this.platform.getTraceSerializer();
        this.backtests = new SignalBacktestRunService(prisma);
    }

    public async executeRun(backtestRunId: string): Promise<ExecuteSignalBacktestResult> {
        const run = await this.prisma.backtestRun.findFirst({
            where: {
                id: backtestRunId,
                sourceType: SignalSourceType.GENERATED,
            },
        });

        if (!run) {
            throw new Error('Generated backtest run not found');
        }

        if (!run.signalCode || run.signalVersion === null || !run.startedAt || !run.finishedAt || !run.parametersJson || typeof run.parametersJson !== 'object') {
            throw new Error('Generated backtest run is missing execution metadata');
        }

        await this.prisma.backtestRun.update({
            where: { id: backtestRunId },
            data: {
                status: BacktestRunStatus.RUNNING,
                errorMessage: null,
            },
        });

        try {
            const preview = await this.platform.runPreview({
                signalCode: run.signalCode,
                signalVersion: run.signalVersion,
                symbol: run.symbol,
                timeframe: run.timeframe,
                from: run.startedAt,
                to: run.finishedAt,
                parameters: run.parametersJson as Record<string, unknown>,
                initialEquity: Number(run.initialEquity),
                riskPercent: Number(run.riskPercent),
                executionConfig: (run.executionConfigJson && typeof run.executionConfigJson === 'object'
                    ? run.executionConfigJson as Record<string, unknown>
                    : undefined),
            });

            const normalizedSignals = preview.signals.map((signal, index) => normalizeSignalDraft(signal, index, backtestRunId));
            const strategyIdByCode = await this.resolveStrategyIds(normalizedSignals, run);
            const exitRuleIdByCode = await this.resolveExitRuleIds(preview.results);
            const signalIdByExternalKey = new Map<string, string>();

            await this.prisma.$transaction(async (tx) => {
                await tx.signalLogicTrace.deleteMany({ where: { backtestRunId } });
                await tx.signalEvent.deleteMany({ where: { backtestRunId } });
                await tx.backtestTradeResult.deleteMany({ where: { backtestRunId } });
                await tx.signal.deleteMany({ where: { backtestRunId } });

                for (const signal of normalizedSignals) {
                    const strategyCode = deriveFallbackStrategyCode(signal, run);
                    const strategyId = signal.strategyId
                        || (strategyCode ? strategyIdByCode.get(strategyCode) : null);

                    if (!strategyId) {
                        throw new Error(`Unable to resolve strategy for generated signal ${signal.externalKey}`);
                    }

                    const created = await tx.signal.create({
                        data: {
                            backtestRunId,
                            sourceType: SignalSourceType.GENERATED,
                            definitionCode: signal.definitionCode || run.signalCode,
                            definitionVersion: signal.definitionVersion ?? run.signalVersion,
                            executionConfigJson: toJsonValue(signal.executionConfigJson || undefined),
                            externalKey: signal.externalKey || null,
                            symbol: normalizeSymbol(signal.symbol),
                            timeframe: signal.timeframe,
                            side: signal.side,
                            strategyId,
                            session: signal.session || TradingSession.NY,
                            entryTime: signal.entryTime,
                            entryPrice: signal.entryPrice,
                            stopLoss: signal.stopLoss,
                            takeProfit1: signal.takeProfit1 ?? null,
                            takeProfit2: signal.takeProfit2 ?? null,
                            invalidationPrice: signal.invalidationPrice ?? null,
                            notes: signal.notes ?? null,
                        },
                    });

                    signalIdByExternalKey.set(signal.externalKey!, created.id);
                }

                const eventInputs = this.annotationSerializer.toCreateManyInput(
                    backtestRunId,
                    signalIdByExternalKey,
                    preview.events,
                );
                if (eventInputs.length) {
                    await tx.signalEvent.createMany({ data: eventInputs });
                }

                const traceInputs = this.traceSerializer.toCreateManyInput(
                    backtestRunId,
                    signalIdByExternalKey,
                    preview.traces,
                );
                if (traceInputs.length) {
                    await tx.signalLogicTrace.createMany({ data: traceInputs });
                }

                if (preview.results.length) {
                    const resultInputs = preview.results.map((result) => {
                        const signalId = signalIdByExternalKey.get(result.signalExternalKey);
                        if (!signalId) {
                            throw new Error(`Unable to resolve generated signal for result ${result.signalExternalKey}`);
                        }

                        const exitRuleId = result.exitRuleId || (result.exitRuleCode ? exitRuleIdByCode.get(result.exitRuleCode) : undefined);
                        if (!exitRuleId) {
                            throw new Error(`Unable to resolve exit rule for result ${result.signalExternalKey}`);
                        }

                        return {
                            backtestRunId,
                            signalId,
                            exitRuleId,
                            resultSide: result.resultSide,
                            session: result.session,
                            win: result.win,
                            isOpen: result.isOpen,
                            rMultiple: result.rMultiple,
                            pnlUsd: result.pnlUsd,
                            maxDrawdownPct: result.maxDrawdownPct,
                            exitReason: result.exitReason as any,
                            exitTime: result.exitTime ?? null,
                            exitPrice: result.exitPrice ?? null,
                            notes: result.notes ?? null,
                            decisionLogJson: (result.decisionLog as any) ?? undefined,
                        };
                    });

                    await tx.backtestTradeResult.createMany({
                        data: resultInputs,
                    });
                }

                const uniqueStrategyIds = Array.from(new Set(
                    normalizedSignals
                        .map((signal) => {
                            const strategyCode = deriveFallbackStrategyCode(signal, run);
                            return strategyCode ? strategyIdByCode.get(strategyCode) : signal.strategyId;
                        })
                        .filter((value): value is string => Boolean(value)),
                ));
                const uniqueSides = Array.from(new Set(normalizedSignals.map((signal) => signal.side)));

                await tx.backtestRun.update({
                    where: { id: backtestRunId },
                    data: {
                        status: BacktestRunStatus.COMPLETED,
                        errorMessage: null,
                        strategyId: uniqueStrategyIds.length === 1 ? uniqueStrategyIds[0] : null,
                        side: uniqueSides.length === 1 ? uniqueSides[0] : null,
                    },
                });
            }, {
                timeout: 120_000,
                maxWait: 10_000,
            });

            await this.dispatchWebhookOutputs(backtestRunId, [
                { contractKind: 'signal-event', limit: preview.events.length },
                { contractKind: 'execution-event', limit: preview.traces.length },
                { contractKind: 'trade-outcome', limit: preview.results.length },
            ]);

            return {
                backtestRunId,
                status: 'COMPLETED',
                counts: {
                    previewSignals: preview.signals.length,
                    previewEvents: preview.events.length,
                    previewTraces: preview.traces.length,
                    persistedSignals: normalizedSignals.length,
                    persistedEvents: preview.events.length,
                    persistedTraces: preview.traces.length,
                    persistedResults: preview.results.length,
                    droppedEvents: 0,
                    droppedTraces: 0,
                },
            };
        } catch (error: any) {
            await this.prisma.backtestRun.update({
                where: { id: backtestRunId },
                data: {
                    status: BacktestRunStatus.FAILED,
                    errorMessage: error.message,
                },
            });
            throw error;
        }
    }

    public async createAndMaybeExecute(input: Parameters<SignalBacktestRunService['createGeneratedBacktest']>[0], executeNow: boolean) {
        const created = await this.backtests.createGeneratedBacktest(input);
        if (!executeNow) {
            return { created, execution: null };
        }

        return {
            created,
            execution: await this.executeRun(created.backtestRunId),
        };
    }

    private async resolveStrategyIds(
        signals: RuntimeSignalDraft[],
        run: {
            signalCode: string | null;
            signalVersion: number | null;
        },
    ) {
        const strategyCodes = Array.from(new Set(
            signals
                .map((signal) => deriveFallbackStrategyCode(signal, run))
                .filter((value): value is string => Boolean(value)),
        ));

        const strategyIdByCode = new Map<string, string>();

        for (const code of strategyCodes) {
            const strategy = await this.prisma.strategy.upsert({
                where: { code },
                update: {},
                create: {
                    code,
                    name: code,
                    description: `Autogenerated strategy container for ${code}.`,
                },
            });
            strategyIdByCode.set(code, strategy.id);
        }

        return strategyIdByCode;
    }

    private async resolveExitRuleIds(results: Awaited<ReturnType<SignalPlatformService['runPreview']>>['results']) {
        const rows = results.filter((result) => !result.exitRuleId && result.exitRuleCode);
        const uniqueCodes = Array.from(new Set(rows.map((result) => result.exitRuleCode as string)));
        const exitRuleIdByCode = new Map<string, string>();

        for (const code of uniqueCodes) {
            const sample = rows.find((row) => row.exitRuleCode === code);
            const exitRule = await this.prisma.exitRule.upsert({
                where: { code },
                update: {
                    name: sample?.exitRuleName || code,
                    configJson: toJsonValue(sample?.exitRuleConfigJson || undefined),
                    isActive: true,
                },
                create: {
                    code,
                    name: sample?.exitRuleName || code,
                    description: `Autogenerated exit profile for ${code}.`,
                    configJson: toJsonValue(sample?.exitRuleConfigJson || undefined),
                    isActive: true,
                },
            });
            exitRuleIdByCode.set(code, exitRule.id);
        }

        return exitRuleIdByCode;
    }

    private async dispatchWebhookOutputs(
        backtestRunId: string,
        deliveries: Array<{
            contractKind: 'signal-event' | 'execution-event' | 'trade-outcome';
            limit: number;
        }>,
    ) {
        const filteredDeliveries = deliveries.filter((delivery) => delivery.limit > 0);
        if (filteredDeliveries.length === 0) {
            return;
        }

        try {
            await this.webhookDeliveryService.deliverConfiguredOutputs({
                backtestRunId,
                indicatorInstanceId: null,
                deliveries: filteredDeliveries,
            });
        } catch {
            // External delivery is best-effort and must not fail the run.
        }
    }
}
