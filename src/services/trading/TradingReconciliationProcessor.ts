import { PrismaClient } from '@prisma/client';
import { TradingAccountService } from './TradingAccountService';
import { TradingWorkspaceService } from './TradingWorkspaceService';

export class TradingReconciliationProcessor {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly tradingAccountService: Pick<TradingAccountService, 'getBrokerContext'> = new TradingAccountService(prisma),
        private readonly workspaceService: Pick<TradingWorkspaceService, 'forceSync'> = new TradingWorkspaceService(prisma),
    ) {}

    async process({
        accountId,
        requestedByUserId,
    }: {
        accountId: string;
        requestedByUserId: string | null;
    }): Promise<void> {
        const actorId = requestedByUserId ?? await this.resolveOwnerUserId(accountId);
        await this.tradingAccountService.getBrokerContext(
            {
                id: actorId,
                role: 'USER',
            },
            accountId,
        );
        await this.workspaceService.forceSync(
            {
                id: actorId,
                role: 'USER',
            },
            accountId,
        );
    }

    private async resolveOwnerUserId(accountId: string): Promise<string> {
        const account = await this.prisma.tradingAccount.findUnique({
            where: { id: accountId },
            select: {
                ownerUserId: true,
            },
        });

        if (!account) {
            throw new Error(`Trading account ${accountId} was not found for reconciliation.`);
        }

        return account.ownerUserId;
    }
}
