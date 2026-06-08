import { PrismaClient } from '@prisma/client';

export type IndicatorStatusValue = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'FAILED' | 'ARCHIVED';

export class IndicatorInstanceService {
    constructor(private prisma: PrismaClient) { }

    public async createInstance(params: {
        name: string;
        signalCode: string;
        signalVersion: number;
        symbol: string;
        timeframe: string;
        parameterJson: any;
        executionConfigJson?: any;
        sourceBacktestRunId?: string;
    }) {
        return this.prisma.indicatorInstance.create({
            data: {
                ...params,
                status: 'ACTIVE',
                stateVersion: 1,
            },
        });
    }

    public async listInstances(filters?: { symbol?: string; timeframe?: string; status?: IndicatorStatusValue }) {
        return this.prisma.indicatorInstance.findMany({
            where: filters,
            orderBy: { createdAt: 'desc' },
        });
    }

    public async getInstance(id: string) {
        return this.prisma.indicatorInstance.findUnique({
            where: { id },
            include: {
                events: {
                    orderBy: { candleTime: 'desc' },
                    take: 50,
                },
            },
        });
    }

    public async updateStatus(id: string, status: IndicatorStatusValue) {
        return this.prisma.indicatorInstance.update({
            where: { id },
            data: {
                status,
                stoppedAt: status === 'ARCHIVED' || status === 'FAILED' || status === 'PAUSED' ? new Date() : undefined,
                startedAt: status === 'ACTIVE' ? new Date() : undefined,
            },
        });
    }

    public async updateCheckpoint(id: string, stateJson: any, lastProcessedCandleTime: Date) {
        return this.prisma.indicatorInstance.update({
            where: { id },
            data: {
                stateJson,
                lastProcessedCandleTime,
            },
        });
    }

    public async updateInstance(id: string, data: { name?: string; parameterJson?: any; executionConfigJson?: any }) {
        return this.prisma.indicatorInstance.update({
            where: { id },
            data,
        });
    }
}
