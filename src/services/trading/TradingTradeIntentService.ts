import {
    ExecutionCommandType,
    Prisma,
    PrismaClient,
    SignalEventType,
    TradingAutomationMode,
    TradeIntentStatus,
} from '@prisma/client';
import { RuntimeSignalDraft, RuntimeSignalEventDraft } from '../signals/types';
import { TradingAccountAccessScope, TradingAccountActor, TradingAccountService } from './TradingAccountService';
import { TradingAutoExecutionJobPublisher } from '../../queues/tradingAutoExecutionQueue';

export interface PersistedLiveSignalEvent {
    draftEvent: RuntimeSignalEventDraft;
    savedEvent: {
        id: string;
        eventType: SignalEventType;
        candleTime: Date;
        price: Prisma.Decimal | number | null;
        label: string | null;
        metaJson: Prisma.JsonValue | null;
    };
}

export interface TradingTradeIntentCaptureInput {
    indicatorInstanceId: string;
    runtimeSignal?: RuntimeSignalDraft | null;
    persistedEvents: PersistedLiveSignalEvent[];
}

export interface TradingTradeIntentView {
    id: string;
    accountId: string;
    bindingId: string;
    bindingName: string;
    indicatorInstanceId: string;
    indicatorName: string;
    signalEventId: string;
    executionCommandId: string | null;
    executionCommandStatus: string | null;
    executionCommandError: string | null;
    mode: string;
    status: string;
    statusReason: string | null;
    eventType: string;
    commandType: string;
    symbol: string;
    side: string | null;
    volume: number | null;
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    candleTime: string;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    payloadJson: Prisma.JsonValue | null;
}

const MAX_INTENT_HISTORY_LIMIT = 100;

const toNumber = (value: Prisma.Decimal | number | string | null | undefined): number | null => {
    if (value === null || value === undefined) {
        return null;
    }

    return Number(value);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return Prisma.JsonNull;
    }

    return value as Prisma.InputJsonValue;
};

type TradeIntentRow = Prisma.TradingTradeIntentGetPayload<{
    include: {
        binding: {
            include: {
                indicatorInstance: {
                    select: {
                        id: true;
                        name: true;
                    };
                };
            };
        };
        signalEvent: {
            select: {
                candleTime: true;
            };
        };
        executionCommand: {
            select: {
                id: true;
                status: true;
                errorMessage: true;
            };
        };
    };
}>;

function isPrismaDuplicateError(error: unknown) {
    const candidate = error as { code?: unknown };
    return candidate?.code === 'P2002';
}

export class TradingTradeIntentService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly autoExecutionPublisher: TradingAutoExecutionJobPublisher | null = null,
        private readonly tradingAccountService: Pick<TradingAccountService, 'getBrokerContext'> = new TradingAccountService(prisma),
    ) { }

    async listIntents(
        actor: TradingAccountActor,
        accountId: string,
        { limit = 20 }: { limit?: number } = {},
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingTradeIntentView[]> {
        await this.tradingAccountService.getBrokerContext(actor, accountId, scope);
        const normalizedLimit = Math.min(Math.max(limit, 1), MAX_INTENT_HISTORY_LIMIT);
        const rows = await this.prisma.tradingTradeIntent.findMany({
            where: { accountId },
            include: {
                binding: {
                    include: {
                        indicatorInstance: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
                signalEvent: {
                    select: {
                        candleTime: true,
                    },
                },
                executionCommand: {
                    select: {
                        id: true,
                        status: true,
                        errorMessage: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: normalizedLimit,
        });

        return rows.map((row) => this.serializeIntent(row));
    }

    async captureAutoExecuteEntryIntents(input: TradingTradeIntentCaptureInput): Promise<number> {
        if (!this.autoExecutionPublisher || !input.runtimeSignal?.externalKey) {
            return 0;
        }

        const entryEvents = input.persistedEvents.filter((item) => (
            item.savedEvent.eventType === 'ENTRY'
            && item.draftEvent.signalExternalKey === input.runtimeSignal?.externalKey
        ));
        if (entryEvents.length === 0) {
            return 0;
        }

        const activeBindings = await this.prisma.tradingAutomationBinding.findMany({
            where: {
                indicatorInstanceId: input.indicatorInstanceId,
                mode: TradingAutomationMode.AUTO_EXECUTE,
                status: 'ACTIVE',
                killSwitchActive: false,
                account: {
                    accountMode: 'PAPER',
                },
            },
            select: {
                id: true,
                accountId: true,
                name: true,
            },
        });
        if (activeBindings.length === 0) {
            return 0;
        }

        const runtimeSignal = input.runtimeSignal;

        const intentPromises = entryEvents.flatMap((entryEvent) =>
            activeBindings.map((binding) =>
                this.createIntentForBinding(
                    binding,
                    input.indicatorInstanceId,
                    entryEvent,
                    runtimeSignal,
                ),
            ),
        );

        const results = await Promise.allSettled(intentPromises);
        let createdCount = 0;
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                createdCount += 1;
            }
        }

        return createdCount;
    }

    private async createIntentForBinding(
        binding: {
            id: string;
            accountId: string;
            name: string;
        },
        indicatorInstanceId: string,
        entryEvent: PersistedLiveSignalEvent,
        runtimeSignal: RuntimeSignalDraft,
    ) {
        const createdAt = new Date();

        try {
            const createdIntent = await this.prisma.tradingTradeIntent.create({
                data: {
                    accountId: binding.accountId,
                    bindingId: binding.id,
                    indicatorInstanceId,
                    signalEventId: entryEvent.savedEvent.id,
                    mode: TradingAutomationMode.AUTO_EXECUTE,
                    status: TradeIntentStatus.QUEUED,
                    eventType: entryEvent.savedEvent.eventType,
                    commandType: ExecutionCommandType.OPEN_MARKET,
                    symbol: runtimeSignal.symbol,
                    side: runtimeSignal.side,
                    entryPrice: new Prisma.Decimal(runtimeSignal.entryPrice),
                    stopLoss: new Prisma.Decimal(runtimeSignal.stopLoss),
                    takeProfit: runtimeSignal.takeProfit1 === null || runtimeSignal.takeProfit1 === undefined
                        ? null
                        : new Prisma.Decimal(runtimeSignal.takeProfit1),
                    lastQueuedAt: createdAt,
                    payloadJson: toInputJson({
                        signalExternalKey: runtimeSignal.externalKey ?? null,
                        eventLabel: entryEvent.savedEvent.label ?? null,
                        candleTime: entryEvent.savedEvent.candleTime.toISOString(),
                        entryTime: runtimeSignal.entryTime.toISOString(),
                        notes: runtimeSignal.notes ?? null,
                        executionConfigJson: runtimeSignal.executionConfigJson ?? null,
                        eventMetaJson: entryEvent.savedEvent.metaJson ?? null,
                        triggerSource: 'indicator-live-runner',
                    }),
                    statusReason: 'Queued for paper auto-execution worker processing.',
                },
            });

            await this.prisma.tradingAutomationBinding.update({
                where: { id: binding.id },
                data: {
                    lastTriggeredAt: createdAt,
                },
            });

            try {
                await this.autoExecutionPublisher?.enqueue({
                    tradeIntentId: createdIntent.id,
                });
            } catch (error) {
                await this.prisma.tradingTradeIntent.update({
                    where: { id: createdIntent.id },
                    data: {
                        status: TradeIntentStatus.FAILED,
                        completedAt: new Date(),
                        statusReason: error instanceof Error
                            ? `Failed to enqueue the paper trade intent: ${error.message}`
                            : 'Failed to enqueue the paper trade intent.',
                    },
                });
            }

            return createdIntent;
        } catch (error) {
            if (isPrismaDuplicateError(error)) {
                return null;
            }

            throw error;
        }
    }

    private serializeIntent(row: TradeIntentRow): TradingTradeIntentView {
        return {
            id: row.id,
            accountId: row.accountId,
            bindingId: row.bindingId,
            bindingName: row.binding.name,
            indicatorInstanceId: row.binding.indicatorInstance.id,
            indicatorName: row.binding.indicatorInstance.name,
            signalEventId: row.signalEventId,
            executionCommandId: row.executionCommand?.id ?? null,
            executionCommandStatus: row.executionCommand?.status ?? null,
            executionCommandError: row.executionCommand?.errorMessage ?? null,
            mode: row.mode,
            status: row.status,
            statusReason: row.statusReason ?? null,
            eventType: row.eventType,
            commandType: row.commandType,
            symbol: row.symbol,
            side: row.side ?? null,
            volume: toNumber(row.volume),
            entryPrice: toNumber(row.entryPrice),
            stopLoss: toNumber(row.stopLoss),
            takeProfit: toNumber(row.takeProfit),
            candleTime: row.signalEvent.candleTime.toISOString(),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            startedAt: row.startedAt?.toISOString() ?? null,
            completedAt: row.completedAt?.toISOString() ?? null,
            payloadJson: row.payloadJson ?? null,
        };
    }
}
