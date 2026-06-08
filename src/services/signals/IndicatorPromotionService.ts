import { PrismaClient } from '@prisma/client';
import { IndicatorInstanceService } from './IndicatorInstanceService';

export class IndicatorPromotionService {
    constructor(
        private prisma: PrismaClient,
        private indicatorService: IndicatorInstanceService
    ) { }

    /**
     * Promotes a successful backtest run to a live indicator instance.
     */
    public async promoteBacktest(backtestRunId: string, name?: string) {
        const run = await this.prisma.backtestRun.findUnique({
            where: { id: backtestRunId },
            include: { strategy: true }
        });

        if (!run) {
            throw new Error(`Backtest run ${backtestRunId} not found`);
        }

        if (!run.parametersJson) {
            throw new Error(`Backtest run ${backtestRunId} has no parameters`);
        }

        return this.indicatorService.createInstance({
            name: name || `Live: ${run.strategy?.name || run.signalCode} (${run.symbol})`,
            signalCode: run.signalCode || 'UNKNOWN',
            signalVersion: run.signalVersion || 1,
            symbol: run.symbol,
            timeframe: run.timeframe,
            parameterJson: run.parametersJson,
            executionConfigJson: run.executionConfigJson,
            sourceBacktestRunId: run.id,
        });
    }
}
