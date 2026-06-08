import { PrismaClient } from '@prisma/client';
import { TradingAccountActor } from './TradingAccountService';
import { computeMetrics, evaluateEligibility } from './SignalLiveEligibilityService';

export class PaperSetupServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly domain = 'trading.paper-setup',
    ) {
        super(message);
        this.name = 'PaperSetupServiceError';
    }
}

export interface PaperSetupInput {
    signalCode: string;
    signalVersion: number;
    riskPercent: number;
    symbol: string;
    timeframe: string;
}

export interface PaperSetupResult {
    instanceId: string;
    bindingId: string;
    accountId: string;
    signalCode: string;
    signalVersion: number;
    signalName: string;
}

const DEFAULT_EXECUTION_CONFIG = {
    stopLoss: { mode: 'SIGNAL_PRICE', value: null },
    takeProfit: { mode: 'SIGNAL_PRICE', value: null },
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    compoundEquity: false,
    positionSizing: { mode: 'RISK_BASED', value: null },
    tradeGuards: {
        dayLossCap: { maxNetR: 3, maxLosses: 3 },
        sessionLossCap: { maxNetR: null, maxLosses: null },
        maxDrawdownHalt: { maxDrawdownPct: 20 },
        minTradeSpacing: { minSpacingMinutes: null },
        equityCurveFilter: { action: 'HALF_RISK', emaTrades: 30 },
        entryBurstCooldown: { windowMinutes: null, cooldownMinutes: null, maxEntriesInWindow: null },
        lossStreakCooldown: { afterLosses: 5, cooldownMinutes: 480 },
        lossStreakThrottle: { steps: [] },
    },
};

export class PaperSetupService {
    constructor(private readonly prisma: PrismaClient) {}

    async setup(
        actor: TradingAccountActor,
        accountId: string,
        input: PaperSetupInput,
    ): Promise<PaperSetupResult> {
        // 1. Verify account exists and belongs to actor
        const account = await this.prisma.tradingAccount.findUnique({
            where: { id: accountId },
            select: { id: true, ownerUserId: true, accountMode: true, status: true },
        });

        if (!account || account.ownerUserId !== actor.id) {
            throw new PaperSetupServiceError(
                404,
                'ACCOUNT_NOT_FOUND',
                'Trading account not found.',
            );
        }

        // 2. Enforce PAPER mode
        if (account.accountMode !== 'PAPER') {
            throw new PaperSetupServiceError(
                409,
                'ACCOUNT_NOT_PAPER',
                'Paper setup is only available for PAPER mode accounts.',
            );
        }

        // 3. Verify signal definition exists
        const signalDef = await this.prisma.signalDefinition.findUnique({
            where: { code_version: { code: input.signalCode, version: input.signalVersion } },
        });

        if (!signalDef) {
            throw new PaperSetupServiceError(
                400,
                'SIGNAL_NOT_FOUND',
                `Signal ${input.signalCode} v${input.signalVersion} not found.`,
            );
        }

        // 4. Find latest completed backtest and evaluate eligibility
        const latestRun = await this.prisma.backtestRun.findFirst({
            where: {
                signalCode: input.signalCode,
                signalVersion: input.signalVersion,
                status: 'COMPLETED',
            },
            orderBy: { createdAt: 'desc' },
        });

        if (!latestRun) {
            throw new PaperSetupServiceError(
                400,
                'SIGNAL_NOT_ELIGIBLE',
                'This signal has no completed backtest. Run a backtest first.',
            );
        }

        const results = await this.prisma.backtestTradeResult.findMany({
            where: { backtestRunId: latestRun.id },
            select: {
                isOpen: true,
                win: true,
                rMultiple: true,
                maxDrawdownPct: true,
            },
        });

        const metrics = computeMetrics(results);
        const { state } = evaluateEligibility(metrics, latestRun.status);

        if (state !== 'live-eligible') {
            throw new PaperSetupServiceError(
                400,
                'SIGNAL_NOT_ELIGIBLE',
                `Signal is ${state}, not live-eligible. It must meet the backtest thresholds (PF ≥ 1.5, DD > -8%, ≥ 10 trades) before paper trading can be activated.`,
            );
        }

        // 5. Create IndicatorInstance
        const instanceName = `Paper: ${signalDef.name} ${input.symbol} ${input.timeframe}`;
        const instance = await this.prisma.indicatorInstance.create({
            data: {
                name: instanceName,
                signalCode: input.signalCode,
                signalVersion: input.signalVersion,
                symbol: input.symbol,
                timeframe: input.timeframe,
                parameterJson: { paperPhase: true },
                executionConfigJson: DEFAULT_EXECUTION_CONFIG,
                status: 'ACTIVE',
                stateVersion: 1,
            },
        });

        // 6. Create AutomationBinding (PENDING_APPROVAL — user must explicitly approve)
        const maxOpenPositions = 1;
        const riskConfig = {
            riskPercent: input.riskPercent,
            maxOpenPositions,
        };
        const guardrails = {
            maxOpenPositions,
            maxDailyLossPct: Math.round(input.riskPercent * 3 * 100) / 100,
            killSwitchDrawdownPct: 15,
        };

        const binding = await this.prisma.tradingAutomationBinding.create({
            data: {
                accountId,
                indicatorInstanceId: instance.id,
                name: instanceName,
                status: 'PENDING_APPROVAL',
                mode: 'AUTO_EXECUTE',
                approvalRequired: true,
                killSwitchActive: false,
                riskConfigJson: riskConfig,
                guardrailsJson: guardrails,
                createdByUserId: actor.id,
            },
        });

        return {
            instanceId: instance.id,
            bindingId: binding.id,
            accountId,
            signalCode: input.signalCode,
            signalVersion: input.signalVersion,
            signalName: signalDef.name,
        };
    }
}
