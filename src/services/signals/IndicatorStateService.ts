import { PrismaClient } from '@prisma/client';

export class IndicatorStateService {
    constructor(private prisma: PrismaClient) { }

    public async saveCheckpoint(indicatorInstanceId: string, stateJson: any, lastProcessedCandleTime: Date) {
        return this.prisma.indicatorInstance.update({
            where: { id: indicatorInstanceId },
            data: {
                stateJson,
                lastProcessedCandleTime,
            },
        });
    }

    public async loadCheckpoint(indicatorInstanceId: string) {
        const instance = await this.prisma.indicatorInstance.findUnique({
            where: { id: indicatorInstanceId },
            select: {
                stateJson: true,
                lastProcessedCandleTime: true,
                signalCode: true,
                signalVersion: true,
                parameterJson: true,
            },
        });

        if (!instance) return null;

        return {
            state: instance.stateJson,
            lastTime: instance.lastProcessedCandleTime,
            config: {
                signalCode: instance.signalCode,
                signalVersion: instance.signalVersion,
                parameters: instance.parameterJson as Record<string, unknown>,
            }
        };
    }
}
