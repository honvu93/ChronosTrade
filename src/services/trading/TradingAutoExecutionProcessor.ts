import { Prisma, PrismaClient, TradeIntentStatus } from '@prisma/client';
import { MT5BridgeClient } from './MT5BridgeClient';
import { TradingAccountService } from './TradingAccountService';
import { TradingExecutionService } from './TradingExecutionService';

const DEFAULT_PAPER_VOLUME = 0.01;
const MAX_INTENT_AGE_MS = 30_000; // 30 seconds
const MAX_PRICE_DEVIATION_PERCENT = 0.5;
const RETRYABLE_COMMAND_ERROR_CODES = new Set(['BRIDGE_UNREACHABLE', 'BRIDGE_TRANSPORT_FAILURE']);
const GUARDRAILS_CACHE_TTL_MS = 5_000;
const GUARDRAILS_STALE_MIRROR_MS = 60_000;

interface GuardrailsCacheEntry {
    positionCount: number;
    balance: number;
    equity: number;
    realizedPnlDay: number;
    fetchedAt: number;
}

interface ParsedGuardrails {
    maxOpenPositions: number | null;
    maxDailyLossPct: number | null;
    killSwitchDrawdownPct: number | null;
}

function parseGuardrailsJson(value: Prisma.JsonValue | null): ParsedGuardrails {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { maxOpenPositions: null, maxDailyLossPct: null, killSwitchDrawdownPct: null };
    }
    const obj = value as Record<string, unknown>;
    return {
        maxOpenPositions: readPositiveNumber(obj.maxOpenPositions),
        maxDailyLossPct: readPositiveNumber(obj.maxDailyLossPct),
        killSwitchDrawdownPct: readPositiveNumber(obj.killSwitchDrawdownPct),
    };
}

class RetryScheduledError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RetryScheduledError';
    }
}

const toNumber = (value: Prisma.Decimal | number | string | null | undefined): number | null => {
    if (value === null || value === undefined) {
        return null;
    }

    return Number(value);
};

function readPositiveNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value;
    }

    return null;
}

function resolvePaperVolume(riskConfigJson: Prisma.JsonValue | null): {
    volume: number;
    source: 'risk-config' | 'default';
} {
    if (
        riskConfigJson
        && typeof riskConfigJson === 'object'
        && !Array.isArray(riskConfigJson)
    ) {
        const source = riskConfigJson as Record<string, unknown>;
        const configured = readPositiveNumber(source.fixedVolume)
            ?? readPositiveNumber(source.volume)
            ?? readPositiveNumber(source.lotSize);

        if (configured !== null) {
            return {
                volume: configured,
                source: 'risk-config',
            };
        }
    }

    return {
        volume: DEFAULT_PAPER_VOLUME,
        source: 'default',
    };
}

export class TradingAutoExecutionProcessor {
    private readonly guardrailsCache = new Map<string, GuardrailsCacheEntry>();

    constructor(
        private readonly prisma: PrismaClient,
        private readonly tradingExecutionService: Pick<TradingExecutionService, 'createCommand'> = new TradingExecutionService(prisma),
        private readonly tradingAccountService: Pick<TradingAccountService, 'getBrokerContext'> = new TradingAccountService(prisma),
        private readonly bridgeClient: Pick<MT5BridgeClient, 'fetchQuote' | 'fetchPositions' | 'fetchSummary'> = new MT5BridgeClient(),
    ) { }

    async process(
        tradeIntentId: string,
        {
            attemptNumber = 1,
            maxAttempts = 1,
        }: {
            attemptNumber?: number;
            maxAttempts?: number;
        } = {},
    ): Promise<void> {
        // FAILED intents are intentionally re-processable: if an intent previously
        // failed (e.g. transient network issue), re-enqueuing allows the worker to
        // retry without requiring a new signal event.  The claim pattern below
        // prevents double-processing by atomically transitioning to PROCESSING.
        const claim = await this.prisma.tradingTradeIntent.updateMany({
            where: {
                id: tradeIntentId,
                status: {
                    in: ['QUEUED', 'FAILED'],
                },
            },
            data: {
                status: TradeIntentStatus.PROCESSING,
                startedAt: new Date(),
                statusReason: 'Paper auto-execution worker claimed the intent.',
            },
        });
        if (claim.count === 0) {
            return;
        }

        const intent = await this.prisma.tradingTradeIntent.findUnique({
            where: { id: tradeIntentId },
            include: {
                binding: {
                    include: {
                        account: {
                            select: {
                                ownerUserId: true,
                                accountMode: true,
                            },
                        },
                    },
                },
                executionCommand: {
                    select: {
                        id: true,
                        status: true,
                        errorCode: true,
                        errorMessage: true,
                    },
                },
            },
        });
        if (!intent) {
            return;
        }

        const intentAgeMs = Date.now() - intent.createdAt.getTime();
        if (intentAgeMs > MAX_INTENT_AGE_MS) {
            await this.rejectIntent(
                tradeIntentId,
                `The trade intent expired after ${Math.round(intentAgeMs / 1000)}s in the queue (max ${MAX_INTENT_AGE_MS / 1000}s).`,
            );
            return;
        }

        if (intent.executionCommand) {
            const hasRetryableFailure = intent.executionCommand.status === 'FAILED'
                && RETRYABLE_COMMAND_ERROR_CODES.has(intent.executionCommand.errorCode ?? '');

            if (!hasRetryableFailure) {
                await this.prisma.tradingTradeIntent.update({
                    where: { id: tradeIntentId },
                    data: {
                        status: intent.executionCommand.status === 'RECONCILED' || intent.executionCommand.status === 'COMPLETED'
                            ? TradeIntentStatus.EXECUTED
                            : intent.executionCommand.status === 'REJECTED'
                                ? TradeIntentStatus.REJECTED
                                : TradeIntentStatus.FAILED,
                        completedAt: new Date(),
                        statusReason: intent.executionCommand.errorMessage
                            ?? `Intent already linked to command ${intent.executionCommand.id}.`,
                    },
                });
                return;
            }
        }

        const binding = intent.binding;
        const account = binding.account;
        if (account.accountMode !== 'PAPER') {
            await this.rejectIntent(tradeIntentId, 'Auto-execution is available only for paper/demo MT5 accounts.');
            return;
        }

        if (binding.mode !== 'AUTO_EXECUTE') {
            await this.rejectIntent(tradeIntentId, 'The binding is not configured for AUTO_EXECUTE mode.');
            return;
        }

        if (binding.status !== 'ACTIVE') {
            await this.rejectIntent(tradeIntentId, 'The binding must be ACTIVE before the worker can auto-execute trades.');
            return;
        }

        if (binding.killSwitchActive) {
            await this.rejectIntent(tradeIntentId, 'The binding kill switch is active, so the worker failed closed.');
            return;
        }

        const guardrailBlock = await this.checkGuardrails(
            binding,
            account,
            intent.accountId,
        );
        if (guardrailBlock) {
            await this.rejectIntent(tradeIntentId, guardrailBlock);
            return;
        }

        if (intent.commandType !== 'OPEN_MARKET') {
            await this.rejectIntent(tradeIntentId, `Unsupported auto-execution command type ${intent.commandType}.`);
            return;
        }

        if (!intent.side) {
            await this.rejectIntent(tradeIntentId, 'The trade intent is missing a side and cannot be submitted.');
            return;
        }

        const volumeResolution = resolvePaperVolume(binding.riskConfigJson ?? null);

        if (intent.entryPrice !== null && intent.entryPrice !== undefined) {
            const currentPrice = await this.resolveCurrentPrice({
                accountId: intent.accountId,
                ownerUserId: account.ownerUserId,
                side: intent.side,
                symbol: intent.symbol,
            });

            if (currentPrice !== null) {
                const signalPrice = Number(intent.entryPrice);
                const deviationPercent = Math.abs((currentPrice - signalPrice) / signalPrice) * 100;

                if (deviationPercent > MAX_PRICE_DEVIATION_PERCENT) {
                    await this.rejectIntent(
                        tradeIntentId,
                        `Price deviation too high: signal at ${signalPrice}, current quote at ${currentPrice} (${deviationPercent.toFixed(2)}% > ${MAX_PRICE_DEVIATION_PERCENT}%).`,
                    );
                    return;
                }
            }
        }

        try {
            const command = await this.tradingExecutionService.createCommand(
                {
                    id: account.ownerUserId,
                    role: 'USER',
                },
                intent.accountId,
                {
                    commandType: 'OPEN_MARKET',
                    symbol: intent.symbol,
                    side: intent.side,
                    volume: volumeResolution.volume,
                    stopLoss: toNumber(intent.stopLoss),
                    takeProfit: toNumber(intent.takeProfit),
                    comment: `AUTO_EXECUTE ${binding.name} ${intent.signalEventId}`.slice(0, 255),
                    idempotencyKey: `trade-intent:${intent.id}`,
                    tradeIntentId: intent.id,
                },
                {
                    skipReconciliation: true,
                    retryFailedCommand: true,
                },
            );

            if (
                command.status === 'FAILED'
                && RETRYABLE_COMMAND_ERROR_CODES.has(command.errorCode ?? '')
                && attemptNumber < maxAttempts
            ) {
                const reason = command.errorMessage ?? 'Transient bridge failure.';
                await this.prisma.tradingTradeIntent.update({
                    where: { id: tradeIntentId },
                    data: {
                        volume: new Prisma.Decimal(volumeResolution.volume),
                        status: TradeIntentStatus.FAILED,
                        completedAt: null,
                        statusReason: `Retry ${attemptNumber}/${maxAttempts} scheduled after transient execution failure: ${reason}`,
                    },
                });
                throw new RetryScheduledError(reason);
            }

            await this.prisma.tradingTradeIntent.update({
                where: { id: tradeIntentId },
                data: {
                    volume: new Prisma.Decimal(volumeResolution.volume),
                    status: command.status === 'RECONCILED' || command.status === 'COMPLETED'
                        ? TradeIntentStatus.EXECUTED
                        : command.status === 'REJECTED'
                            ? TradeIntentStatus.REJECTED
                            : TradeIntentStatus.FAILED,
                    completedAt: new Date(),
                    statusReason: command.status === 'FAILED'
                        ? `Paper auto-execution failed after ${attemptNumber} of ${maxAttempts} attempts: ${command.errorMessage ?? 'Unknown bridge failure.'}`
                        : command.errorMessage
                            ?? (volumeResolution.source === 'default'
                                ? 'Paper auto-execution completed using the default 0.01 lot fallback.'
                                : 'Paper auto-execution completed through the approved command boundary.'),
                },
            });
        } catch (error) {
            if (error instanceof RetryScheduledError) {
                throw error;
            }

            if (attemptNumber < maxAttempts) {
                await this.prisma.tradingTradeIntent.update({
                    where: { id: tradeIntentId },
                    data: {
                        volume: new Prisma.Decimal(volumeResolution.volume),
                        status: TradeIntentStatus.FAILED,
                        completedAt: null,
                        statusReason: error instanceof Error
                            ? `Retry ${attemptNumber}/${maxAttempts} scheduled after processor failure: ${error.message}`
                            : `Retry ${attemptNumber}/${maxAttempts} scheduled after processor failure.`,
                    },
                });
                throw error;
            }

            await this.prisma.tradingTradeIntent.update({
                where: { id: tradeIntentId },
                data: {
                    volume: new Prisma.Decimal(volumeResolution.volume),
                    status: TradeIntentStatus.FAILED,
                    completedAt: new Date(),
                    statusReason: error instanceof Error
                        ? `Paper auto-execution failed after ${maxAttempts} attempts: ${error.message}`
                        : `Paper auto-execution failed after ${maxAttempts} attempts.`,
                },
            });
        }
    }

    private async fetchGuardrailsData(
        ownerUserId: string,
        accountId: string,
    ): Promise<GuardrailsCacheEntry | null> {
        const cached = this.guardrailsCache.get(accountId);
        if (cached && (Date.now() - cached.fetchedAt) < GUARDRAILS_CACHE_TTL_MS) {
            return cached;
        }

        try {
            const brokerContext = await this.tradingAccountService.getBrokerContext(
                { id: ownerUserId, role: 'USER' },
                accountId,
            );
            if (!brokerContext.credential) {
                return null;
            }

            const [positions, summary] = await Promise.all([
                this.bridgeClient.fetchPositions(brokerContext.credential),
                this.bridgeClient.fetchSummary(brokerContext.credential),
            ]);

            const entry: GuardrailsCacheEntry = {
                positionCount: positions.length,
                balance: summary.balance,
                equity: summary.equity,
                realizedPnlDay: summary.realizedPnlDay,
                fetchedAt: Date.now(),
            };
            this.guardrailsCache.set(accountId, entry);
            return entry;
        } catch {
            // Bridge unreachable — attempt local mirror fallback
        }

        try {
            const [openPositions, latestSnapshot] = await Promise.all([
                this.prisma.tradingPosition.count({
                    where: { accountId, status: 'OPEN' },
                }),
                this.prisma.tradingAccountSnapshot.findFirst({
                    where: { accountId },
                    orderBy: { capturedAt: 'desc' },
                    select: {
                        balance: true,
                        equity: true,
                        realizedPnlDay: true,
                        capturedAt: true,
                    },
                }),
            ]);

            if (!latestSnapshot) {
                return null;
            }

            const mirrorAgeMs = Date.now() - latestSnapshot.capturedAt.getTime();
            if (mirrorAgeMs > GUARDRAILS_STALE_MIRROR_MS) {
                return null;
            }

            return {
                positionCount: openPositions,
                balance: Number(latestSnapshot.balance),
                equity: Number(latestSnapshot.equity),
                realizedPnlDay: Number(latestSnapshot.realizedPnlDay),
                fetchedAt: latestSnapshot.capturedAt.getTime(),
            };
        } catch {
            return null;
        }
    }

    private async checkGuardrails(
        binding: {
            id: string;
            guardrailsJson: Prisma.JsonValue | null;
        },
        account: {
            ownerUserId: string;
        },
        accountId: string,
    ): Promise<string | null> {
        const guardrails = parseGuardrailsJson(binding.guardrailsJson ?? null);

        const hasAnyGuardrail = guardrails.maxOpenPositions !== null
            || guardrails.maxDailyLossPct !== null
            || guardrails.killSwitchDrawdownPct !== null;

        if (!hasAnyGuardrail) {
            return null;
        }

        const liveData = await this.fetchGuardrailsData(account.ownerUserId, accountId);

        if (!liveData) {
            return 'Guardrails check failed: MT5 bridge unreachable and local mirror is stale or missing. Intent rejected as a safety measure.';
        }

        if (guardrails.maxOpenPositions !== null && liveData.positionCount >= guardrails.maxOpenPositions) {
            return `Guardrail blocked: ${liveData.positionCount} open position(s) >= maxOpenPositions (${guardrails.maxOpenPositions}).`;
        }

        if (guardrails.maxDailyLossPct !== null && liveData.balance > 0 && liveData.realizedPnlDay < 0) {
            const dailyLossPct = Math.abs(liveData.realizedPnlDay) / liveData.balance * 100;
            if (dailyLossPct >= guardrails.maxDailyLossPct) {
                return `Guardrail blocked: daily loss ${dailyLossPct.toFixed(2)}% >= maxDailyLossPct (${guardrails.maxDailyLossPct}%).`;
            }
        }

        if (guardrails.killSwitchDrawdownPct !== null && liveData.balance > 0) {
            const drawdownPct = liveData.balance > liveData.equity
                ? (liveData.balance - liveData.equity) / liveData.balance * 100
                : 0;
            if (drawdownPct >= guardrails.killSwitchDrawdownPct) {
                const reason = `Kill switch auto-activated: drawdown ${drawdownPct.toFixed(2)}% >= killSwitchDrawdownPct (${guardrails.killSwitchDrawdownPct}%).`;
                await this.prisma.tradingAutomationBinding.update({
                    where: { id: binding.id },
                    data: {
                        killSwitchActive: true,
                        statusReason: reason,
                    },
                });
                return reason;
            }
        }

        return null;
    }

    private async resolveCurrentPrice(
        {
            accountId,
            ownerUserId,
            side,
            symbol,
        }: {
            accountId: string;
            ownerUserId: string;
            side: 'LONG' | 'SHORT';
            symbol: string;
        },
    ): Promise<number | null> {
        try {
            const account = await this.tradingAccountService.getBrokerContext(
                {
                    id: ownerUserId,
                    role: 'USER',
                },
                accountId,
            );
            if (!account.credential) {
                return null;
            }

            const quote = await this.bridgeClient.fetchQuote(account.credential, symbol);
            if (side === 'SHORT') {
                return quote.bid ?? quote.last ?? quote.ask ?? null;
            }

            return quote.ask ?? quote.last ?? quote.bid ?? null;
        } catch {
            return null;
        }
    }

    private async rejectIntent(tradeIntentId: string, reason: string) {
        await this.prisma.tradingTradeIntent.update({
            where: { id: tradeIntentId },
            data: {
                status: TradeIntentStatus.REJECTED,
                completedAt: new Date(),
                statusReason: reason,
            },
        });
    }
}
