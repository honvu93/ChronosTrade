import { BacktestRunStatus, Prisma, PrismaClient, SignalEventType, SignalSourceType } from '@prisma/client';
import { CreateSignalBacktestInput } from './types';
import { SignalDefinitionService } from './SignalDefinitionService';
import { ExecutionModelService } from './ExecutionModelService';
import { SignalRegistry } from './SignalRegistry';
import { normalizeSymbol } from '../../utils/symbols';

const DEFAULT_INITIAL_EQUITY = 10_000;
const DEFAULT_RISK_PERCENT = 1;

const round = (value: unknown, digits = 2) => Number(Number(value || 0).toFixed(digits));

export class SignalBacktestRunService {
    private definitions: SignalDefinitionService;
    private executionModel: ExecutionModelService;

    constructor(private prisma: PrismaClient) {
        this.definitions = new SignalDefinitionService(prisma);
        this.executionModel = new ExecutionModelService();
    }

    public async createGeneratedBacktest(input: CreateSignalBacktestInput) {
        const signalCode = input.signalCode.trim().toUpperCase();
        let definition: { name: string; isActive: boolean } | null = await this.definitions.getDefinition(signalCode, input.signalVersion);

        if (!definition) {
            // Check registry for temporary/memory-only signals
            const plugin = SignalRegistry.getInstance().get(signalCode, input.signalVersion);
            if (plugin) {
                definition = {
                    name: plugin.definition.name || signalCode,
                    isActive: true
                };
            }
        }

        if (!definition || !definition.isActive) {
            throw new Error(`Signal definition ${signalCode}@${input.signalVersion} is not available`);
        }

        const from = new Date(input.dateRange.from);
        const to = new Date(input.dateRange.to);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
            throw new Error('Invalid dateRange');
        }

        const resolvedExecutionConfig = this.executionModel.resolveConfig(input.executionConfig);
        const normalizedSymbol = normalizeSymbol(input.symbol);

        const created = await this.prisma.backtestRun.create({
            data: {
                sourceType: SignalSourceType.GENERATED,
                status: BacktestRunStatus.PENDING,
                signalCode,
                signalVersion: input.signalVersion,
                parametersJson: input.parameters as Prisma.InputJsonValue,
                executionConfigJson: resolvedExecutionConfig as unknown as Prisma.InputJsonValue,
                name: `${definition.name} ${normalizedSymbol} ${input.timeframe} ${input.dateRange.from.slice(0, 10)}..${input.dateRange.to.slice(0, 10)}`,
                symbol: normalizedSymbol,
                timeframe: input.timeframe,
                initialEquity: input.initialEquity ?? DEFAULT_INITIAL_EQUITY,
                riskPercent: input.riskPercent ?? DEFAULT_RISK_PERCENT,
                notes: input.notes ?? null,
                startedAt: from,
                finishedAt: to,
            },
        });

        return {
            backtestRunId: created.id,
            signalCode,
            signalVersion: input.signalVersion,
            status: created.status,
        };
    }

    public async listGeneratedBacktests(filters: {
        signalCode?: string;
        signalVersion?: number;
        symbol?: string;
        timeframe?: string;
        status?: BacktestRunStatus;
        notes?: string;
    }) {
        const runs = await this.prisma.backtestRun.findMany({
            where: {
                sourceType: SignalSourceType.GENERATED,
                ...(filters.signalCode ? { signalCode: filters.signalCode.toUpperCase() } : {}),
                ...(filters.signalVersion !== undefined ? { signalVersion: filters.signalVersion } : {}),
                ...(filters.symbol ? { symbol: normalizeSymbol(filters.symbol) } : {}),
                ...(filters.timeframe ? { timeframe: filters.timeframe } : {}),
                ...(filters.status ? { status: filters.status } : {}),
                ...(filters.notes ? { notes: { contains: filters.notes } } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: 250,
        });

        return runs.map((run) => ({
            id: run.id,
            name: run.name,
            sourceType: run.sourceType,
            status: run.status,
            signalCode: run.signalCode,
            signalVersion: run.signalVersion,
            symbol: run.symbol,
            timeframe: run.timeframe,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            initialEquity: round(run.initialEquity),
            riskPercent: round(run.riskPercent, 4),
            parametersJson: run.parametersJson,
            executionConfigJson: run.executionConfigJson,
            notes: run.notes,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
        }));
    }

    public async getGeneratedBacktest(id: string) {
        const run = await this.prisma.backtestRun.findFirst({
            where: {
                id,
                sourceType: SignalSourceType.GENERATED,
            },
            include: {
                signals: {
                    select: { id: true },
                },
                events: {
                    select: { id: true },
                },
                logicTraces: {
                    select: { id: true },
                },
                results: {
                    select: { id: true },
                },
            },
        });

        if (!run) {
            return null;
        }

        // Count guard-blocked signals from signal notes
        const signalsWithNotes = await this.prisma.signal.findMany({
            where: { backtestRunId: id },
            select: { notes: true },
        });
        const blockedEntryCount = signalsWithNotes.filter(
            (s) => typeof s.notes === 'string' && s.notes.includes('blocked:'),
        ).length;

        return {
            id: run.id,
            name: run.name,
            sourceType: run.sourceType,
            status: run.status,
            signalCode: run.signalCode,
            signalVersion: run.signalVersion,
            symbol: run.symbol,
            timeframe: run.timeframe,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            initialEquity: round(run.initialEquity),
            riskPercent: round(run.riskPercent, 4),
            parametersJson: run.parametersJson,
            executionConfigJson: run.executionConfigJson,
            errorMessage: run.errorMessage,
            notes: run.notes,
            counts: {
                signals: run.signals.length,
                events: run.events.length,
                traces: run.logicTraces.length,
                results: run.results.length,
            },
            guardMetrics: {
                blockedEntryCount,
            },
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
        };
    }

    public async deleteGeneratedBacktest(id: string) {
        const run = await this.prisma.backtestRun.findFirst({
            where: {
                id,
                sourceType: SignalSourceType.GENERATED,
            },
            select: {
                id: true,
                name: true,
                status: true,
            },
        });

        if (!run) {
            throw new Error('Generated backtest run not found');
        }

        if (run.status === BacktestRunStatus.PENDING || run.status === BacktestRunStatus.RUNNING) {
            throw new Error(`Generated backtest run ${id} is still active`);
        }

        await this.prisma.$transaction(async (tx) => {
            const linkedIndicator = await tx.indicatorInstance.findFirst({
                where: { sourceBacktestRunId: id },
                select: {
                    id: true,
                    name: true,
                },
            });

            if (linkedIndicator) {
                throw new Error(`Generated backtest run is linked to indicator ${linkedIndicator.name || linkedIndicator.id}`);
            }

            await tx.signalLogicTrace.deleteMany({ where: { backtestRunId: id } });
            await tx.signalEvent.deleteMany({ where: { backtestRunId: id } });
            await tx.backtestTradeResult.deleteMany({ where: { backtestRunId: id } });
            await tx.signal.deleteMany({ where: { backtestRunId: id } });
            await tx.backtestRun.delete({ where: { id } });
        });

        return {
            id: run.id,
            name: run.name,
        };
    }

    public async listRunEvents(id: string, filters: {
        signalId?: string;
        eventType?: SignalEventType;
        from?: Date;
        to?: Date;
    }) {
        const run = await this.prisma.backtestRun.findFirst({
            where: {
                id,
                sourceType: SignalSourceType.GENERATED,
            },
            select: { id: true },
        });

        if (!run) {
            throw new Error('Generated backtest run not found');
        }

        const events = await this.prisma.signalEvent.findMany({
            where: {
                backtestRunId: id,
                ...(filters.signalId ? { signalId: filters.signalId } : {}),
                ...(filters.eventType ? { eventType: filters.eventType } : {}),
                ...((filters.from || filters.to) ? {
                    candleTime: {
                        ...(filters.from ? { gte: filters.from } : {}),
                        ...(filters.to ? { lte: filters.to } : {}),
                    },
                } : {}),
            },
            orderBy: [
                { candleTime: 'asc' },
                { createdAt: 'asc' },
            ],
        });

        return events.map((event) => ({
            id: event.id,
            signalId: event.signalId,
            backtestRunId: event.backtestRunId,
            eventType: event.eventType,
            candleTime: event.candleTime,
            price: event.price ? round(event.price, 4) : null,
            label: event.label,
            metaJson: event.metaJson,
            createdAt: event.createdAt,
        }));
    }
}
