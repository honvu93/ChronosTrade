import { Prisma, PrismaClient, TradingAutomationBindingStatus, TradingAutomationMode } from '@prisma/client';
import { TradingAccountAccessScope, TradingAccountActor, TradingAccountService } from './TradingAccountService';

export interface TradingAutomationBindingInput {
    indicatorInstanceId: string;
    name: string;
    mode: TradingAutomationMode;
    filtersJson?: Prisma.JsonValue | null;
    riskConfigJson?: Prisma.JsonValue | null;
    guardrailsJson?: Prisma.JsonValue | null;
    approvalRequired?: boolean;
    killSwitchActive?: boolean;
}

export interface TradingAutomationBindingStatusInput {
    status: TradingAutomationBindingStatus;
    killSwitchActive?: boolean;
    statusReason?: string | null;
}

export interface TradingAutomationIndicatorCandidate {
    id: string;
    name: string;
    status: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    sourceBacktestRunId: string | null;
    updatedAt: string;
}

export interface TradingAutomationBindingView {
    id: string;
    accountId: string;
    indicatorInstanceId: string;
    indicatorName: string;
    indicatorStatus: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    name: string;
    status: string;
    mode: string;
    approvalRequired: boolean;
    killSwitchActive: boolean;
    createdByUserId: string | null;
    approvedByUserId: string | null;
    approvedAt: string | null;
    lastTriggeredAt: string | null;
    statusReason: string | null;
    filtersJson: Prisma.JsonValue | null;
    riskConfigJson: Prisma.JsonValue | null;
    guardrailsJson: Prisma.JsonValue | null;
    createdAt: string;
    updatedAt: string;
}

export interface TradingAutomationSnapshot {
    autoExecuteLocked: boolean;
    pendingApprovalCount: number;
    bindings: TradingAutomationBindingView[];
    availableIndicators: TradingAutomationIndicatorCandidate[];
}

export class TradingAutomationBindingServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code:
            | 'TRADING_AUTOMATION_INVALID'
            | 'TRADING_AUTOMATION_NOT_FOUND'
            | 'TRADING_AUTOMATION_LOCKED',
        message: string,
        public readonly domain = 'trading.automation',
    ) {
        super(message);
        this.name = 'TradingAutomationBindingServiceError';
    }
}

export class TradingAutomationBindingService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly tradingAccountService: Pick<TradingAccountService, 'getBrokerContext'> = new TradingAccountService(prisma),
    ) {}

    async listBindings(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingAutomationSnapshot> {
        const account = await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const [bindings, indicators] = await Promise.all([
            this.prisma.tradingAutomationBinding.findMany({
                where: { accountId },
                include: {
                    indicatorInstance: {
                        select: {
                            id: true,
                            name: true,
                            status: true,
                            signalCode: true,
                            signalVersion: true,
                            symbol: true,
                            timeframe: true,
                        },
                    },
                },
                orderBy: [
                    { status: 'asc' },
                    { updatedAt: 'desc' },
                ],
            }),
            this.prisma.indicatorInstance.findMany({
                select: {
                    id: true,
                    name: true,
                    status: true,
                    signalCode: true,
                    signalVersion: true,
                    symbol: true,
                    timeframe: true,
                    sourceBacktestRunId: true,
                    updatedAt: true,
                },
                orderBy: { updatedAt: 'desc' },
                take: 20,
            }),
        ]);

        return {
            autoExecuteLocked: account.accountMode !== 'PAPER',
            pendingApprovalCount: bindings.filter((binding) => binding.status === 'PENDING_APPROVAL').length,
            bindings: bindings.map((binding) => ({
                id: binding.id,
                accountId: binding.accountId,
                indicatorInstanceId: binding.indicatorInstanceId,
                indicatorName: binding.indicatorInstance.name,
                indicatorStatus: binding.indicatorInstance.status,
                signalCode: binding.indicatorInstance.signalCode,
                signalVersion: binding.indicatorInstance.signalVersion,
                symbol: binding.indicatorInstance.symbol,
                timeframe: binding.indicatorInstance.timeframe,
                name: binding.name,
                status: binding.status,
                mode: binding.mode,
                approvalRequired: binding.approvalRequired,
                killSwitchActive: binding.killSwitchActive,
                createdByUserId: binding.createdByUserId ?? null,
                approvedByUserId: binding.approvedByUserId ?? null,
                approvedAt: binding.approvedAt?.toISOString() ?? null,
                lastTriggeredAt: binding.lastTriggeredAt?.toISOString() ?? null,
                statusReason: binding.statusReason ?? null,
                filtersJson: binding.filtersJson ?? null,
                riskConfigJson: binding.riskConfigJson ?? null,
                guardrailsJson: binding.guardrailsJson ?? null,
                createdAt: binding.createdAt.toISOString(),
                updatedAt: binding.updatedAt.toISOString(),
            })),
            availableIndicators: indicators.map((indicator) => ({
                id: indicator.id,
                name: indicator.name,
                status: indicator.status,
                signalCode: indicator.signalCode,
                signalVersion: indicator.signalVersion,
                symbol: indicator.symbol,
                timeframe: indicator.timeframe,
                sourceBacktestRunId: indicator.sourceBacktestRunId ?? null,
                updatedAt: indicator.updatedAt.toISOString(),
            })),
        };
    }

    async createBinding(
        actor: TradingAccountActor,
        accountId: string,
        input: TradingAutomationBindingInput,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingAutomationBindingView> {
        const account = await this.tradingAccountService.getBrokerContext(actor, accountId, scope);

        const name = input.name.trim();
        if (!name) {
            throw new TradingAutomationBindingServiceError(
                400,
                'TRADING_AUTOMATION_INVALID',
                'Binding name is required.',
            );
        }

        if (input.mode === 'AUTO_EXECUTE' && account.accountMode !== 'PAPER') {
            throw new TradingAutomationBindingServiceError(
                409,
                'TRADING_AUTOMATION_LOCKED',
                'Auto-execute is available only for paper/demo MT5 accounts. Live accounts remain blocked.',
            );
        }

        const indicator = await this.prisma.indicatorInstance.findUnique({
            where: { id: input.indicatorInstanceId },
            select: {
                id: true,
                name: true,
                status: true,
                signalCode: true,
                signalVersion: true,
                symbol: true,
                timeframe: true,
            },
        });
        if (!indicator) {
            throw new TradingAutomationBindingServiceError(
                404,
                'TRADING_AUTOMATION_NOT_FOUND',
                `Indicator instance ${input.indicatorInstanceId} was not found.`,
            );
        }

        const binding = await this.prisma.tradingAutomationBinding.create({
            data: {
                accountId,
                indicatorInstanceId: input.indicatorInstanceId,
                name,
                mode: input.mode,
                status: 'PENDING_APPROVAL',
                filtersJson: input.filtersJson ?? undefined,
                riskConfigJson: input.riskConfigJson ?? undefined,
                guardrailsJson: input.guardrailsJson ?? undefined,
                approvalRequired: input.approvalRequired ?? true,
                killSwitchActive: input.killSwitchActive ?? false,
                createdByUserId: actor.id,
            },
            include: {
                indicatorInstance: {
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        signalCode: true,
                        signalVersion: true,
                        symbol: true,
                        timeframe: true,
                    },
                },
            },
        });

        return {
            id: binding.id,
            accountId: binding.accountId,
            indicatorInstanceId: binding.indicatorInstanceId,
            indicatorName: binding.indicatorInstance.name,
            indicatorStatus: binding.indicatorInstance.status,
            signalCode: binding.indicatorInstance.signalCode,
            signalVersion: binding.indicatorInstance.signalVersion,
            symbol: binding.indicatorInstance.symbol,
            timeframe: binding.indicatorInstance.timeframe,
            name: binding.name,
            status: binding.status,
            mode: binding.mode,
            approvalRequired: binding.approvalRequired,
            killSwitchActive: binding.killSwitchActive,
            createdByUserId: binding.createdByUserId ?? null,
            approvedByUserId: binding.approvedByUserId ?? null,
            approvedAt: binding.approvedAt?.toISOString() ?? null,
            lastTriggeredAt: binding.lastTriggeredAt?.toISOString() ?? null,
            statusReason: binding.statusReason ?? null,
            filtersJson: binding.filtersJson ?? null,
            riskConfigJson: binding.riskConfigJson ?? null,
            guardrailsJson: binding.guardrailsJson ?? null,
            createdAt: binding.createdAt.toISOString(),
            updatedAt: binding.updatedAt.toISOString(),
        };
    }

    async updateBindingStatus(
        actor: TradingAccountActor,
        accountId: string,
        bindingId: string,
        input: TradingAutomationBindingStatusInput,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingAutomationBindingView> {
        const account = await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const binding = await this.prisma.tradingAutomationBinding.findFirst({
            where: {
                id: bindingId,
                accountId,
            },
            include: {
                indicatorInstance: {
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        signalCode: true,
                        signalVersion: true,
                        symbol: true,
                        timeframe: true,
                    },
                },
            },
        });
        if (!binding) {
            throw new TradingAutomationBindingServiceError(
                404,
                'TRADING_AUTOMATION_NOT_FOUND',
                `Automation binding ${bindingId} was not found.`,
            );
        }

        if (
            binding.mode === 'AUTO_EXECUTE'
            && input.status === 'ACTIVE'
            && account.accountMode !== 'PAPER'
        ) {
            throw new TradingAutomationBindingServiceError(
                409,
                'TRADING_AUTOMATION_LOCKED',
                'Auto-execute can only be activated for paper/demo MT5 accounts. Live accounts remain blocked.',
            );
        }

        const next = await this.prisma.tradingAutomationBinding.update({
            where: { id: bindingId },
            data: {
                status: input.status,
                killSwitchActive: input.killSwitchActive ?? binding.killSwitchActive,
                statusReason: input.statusReason ?? null,
                ...(input.status === 'ACTIVE'
                    ? {
                        approvedByUserId: actor.id,
                        approvedAt: new Date(),
                    }
                    : {}),
            },
            include: {
                indicatorInstance: {
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        signalCode: true,
                        signalVersion: true,
                        symbol: true,
                        timeframe: true,
                    },
                },
            },
        });

        return {
            id: next.id,
            accountId: next.accountId,
            indicatorInstanceId: next.indicatorInstanceId,
            indicatorName: next.indicatorInstance.name,
            indicatorStatus: next.indicatorInstance.status,
            signalCode: next.indicatorInstance.signalCode,
            signalVersion: next.indicatorInstance.signalVersion,
            symbol: next.indicatorInstance.symbol,
            timeframe: next.indicatorInstance.timeframe,
            name: next.name,
            status: next.status,
            mode: next.mode,
            approvalRequired: next.approvalRequired,
            killSwitchActive: next.killSwitchActive,
            createdByUserId: next.createdByUserId ?? null,
            approvedByUserId: next.approvedByUserId ?? null,
            approvedAt: next.approvedAt?.toISOString() ?? null,
            lastTriggeredAt: next.lastTriggeredAt?.toISOString() ?? null,
            statusReason: next.statusReason ?? null,
            filtersJson: next.filtersJson ?? null,
            riskConfigJson: next.riskConfigJson ?? null,
            guardrailsJson: next.guardrailsJson ?? null,
            createdAt: next.createdAt.toISOString(),
            updatedAt: next.updatedAt.toISOString(),
        };
    }
}
