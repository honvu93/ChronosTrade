import { PrismaClient } from '@prisma/client';
import { SignalLiveEligibilityService } from './SignalLiveEligibilityService';

export interface TradingChecklistResult {
    mt5Connected: boolean;
    hasCompletedBacktest: boolean;
    hasLiveEligibleSignal: boolean;
    hasPaperTradingActive: boolean;
}

export class TradingChecklistService {
    constructor(private readonly prisma: PrismaClient) {}

    async getChecklist(userId: string): Promise<TradingChecklistResult> {
        const [activeAccount, completedBacktest, paperBinding] = await Promise.all([
            this.prisma.tradingAccount.findFirst({
                where: { ownerUserId: userId, status: 'ACTIVE' },
                select: { id: true },
            }),
            this.prisma.backtestRun.findFirst({
                where: { status: 'COMPLETED' },
                select: { id: true },
            }),
            this.prisma.tradingAutomationBinding.findFirst({
                where: {
                    status: 'ACTIVE',
                    mode: 'AUTO_EXECUTE',
                    account: { ownerUserId: userId, accountMode: 'PAPER' },
                },
                select: { id: true },
            }),
        ]);

        let hasLiveEligibleSignal = false;
        if (completedBacktest) {
            const eligibilityService = new SignalLiveEligibilityService(this.prisma);
            const items = await eligibilityService.listEligibility();
            hasLiveEligibleSignal = items.some((item) => item.eligibilityState === 'live-eligible');
        }

        return {
            mt5Connected: Boolean(activeAccount),
            hasCompletedBacktest: Boolean(completedBacktest),
            hasLiveEligibleSignal,
            hasPaperTradingActive: Boolean(paperBinding),
        };
    }
}
