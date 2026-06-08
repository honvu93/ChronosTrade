import { PrismaClient, SignalEventType, SignalSourceType } from '@prisma/client';

export class SignalTraceService {
    constructor(private prisma: PrismaClient) { }

    public async listRunTraces(backtestRunId: string, filters: {
        signalId?: string;
        signalEventId?: string;
        eventType?: SignalEventType;
    }) {
        const run = await this.prisma.backtestRun.findFirst({
            where: {
                id: backtestRunId,
                sourceType: SignalSourceType.GENERATED,
            },
            select: { id: true },
        });

        if (!run) {
            throw new Error('Generated backtest run not found');
        }

        const traces = await this.prisma.signalLogicTrace.findMany({
            where: {
                backtestRunId,
                ...(filters.signalId ? { signalId: filters.signalId } : {}),
                ...(filters.signalEventId ? { signalEventId: filters.signalEventId } : {}),
                ...(filters.eventType ? { eventType: filters.eventType } : {}),
            },
            orderBy: [
                { candleTime: 'asc' },
                { createdAt: 'asc' },
            ],
        });

        return traces.map((trace) => ({
            id: trace.id,
            signalId: trace.signalId,
            signalEventId: trace.signalEventId,
            backtestRunId: trace.backtestRunId,
            eventType: trace.eventType,
            candleTime: trace.candleTime,
            stateBefore: trace.stateBefore,
            stateAfter: trace.stateAfter,
            ruleId: trace.ruleId,
            indicatorJson: trace.indicatorJson,
            thresholdJson: trace.thresholdJson,
            priceJson: trace.priceJson,
            notes: trace.notes,
            createdAt: trace.createdAt,
        }));
    }
}
