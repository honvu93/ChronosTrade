import { PositionSide } from '@prisma/client';
import {
    EntryFillRequest,
    ExecutionConfigInput,
    ExecutionConfigResolved,
    ExitFillRequest,
    FillResult,
    ORDER_TIMING_VALUES,
    POSITION_SIZING_MODE_VALUES,
    PositionSizingRequest,
    PositionSizingResult,
    RMultipleRequest,
    RMultipleResult,
    STOP_LOSS_MODE_VALUES,
    StopLossResolutionRequest,
    StopLossResolutionResult,
    TAKE_PROFIT_MODE_VALUES,
    TakeProfitResolutionRequest,
    TakeProfitResolutionResult,
    TradePnlRequest,
    TradePnlResult,
} from './types';

const round = (value: number, digits = 8) => Number(value.toFixed(digits));
const epsilon = 1e-8;

const ensurePositive = (value: number | null | undefined, field: string) => {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${field} must be a positive number`);
    }

    return value;
};

const ensurePositiveInteger = (value: number | null | undefined, field: string) => {
    const normalized = ensurePositive(value, field);
    if (!Number.isInteger(normalized)) {
        throw new Error(`${field} must be a positive integer`);
    }

    return normalized;
};

const resolveAccountAmount = (mode: 'FIXED_AMOUNT' | 'ACCOUNT_PERCENT', value: number, initialEquity: number) => {
    const normalizedValue = ensurePositive(value, `${mode} value`);
    if (mode === 'FIXED_AMOUNT') {
        return normalizedValue;
    }

    return (initialEquity * normalizedValue) / 100;
};

export class ExecutionModelService {
    public resolveConfig(input?: ExecutionConfigInput): ExecutionConfigResolved {
        const orderTiming = input?.orderTiming ?? 'NEXT_BAR_OPEN';
        if (!ORDER_TIMING_VALUES.includes(orderTiming)) {
            throw new Error(`Unsupported orderTiming ${orderTiming}`);
        }

        const stopLossMode = input?.stopLoss?.mode ?? 'SIGNAL_PRICE';
        if (!STOP_LOSS_MODE_VALUES.includes(stopLossMode)) {
            throw new Error(`Unsupported stopLoss mode ${stopLossMode}`);
        }

        const takeProfitMode = input?.takeProfit?.mode ?? 'SIGNAL_PRICE';
        if (!TAKE_PROFIT_MODE_VALUES.includes(takeProfitMode)) {
            throw new Error(`Unsupported takeProfit mode ${takeProfitMode}`);
        }

        const positionSizingMode = input?.positionSizing?.mode ?? 'RISK_BASED';
        if (!POSITION_SIZING_MODE_VALUES.includes(positionSizingMode)) {
            throw new Error(`Unsupported positionSizing mode ${positionSizingMode}`);
        }

        if (stopLossMode !== 'SIGNAL_PRICE') {
            ensurePositive(input?.stopLoss?.value ?? null, 'stopLoss.value');
        }

        if (takeProfitMode !== 'SIGNAL_PRICE') {
            ensurePositive(input?.takeProfit?.value ?? null, 'takeProfit.value');
        }

        if (positionSizingMode !== 'RISK_BASED') {
            ensurePositive(input?.positionSizing?.value ?? null, 'positionSizing.value');
        }

        if (positionSizingMode === 'RISK_BASED' && stopLossMode !== 'SIGNAL_PRICE') {
            throw new Error('positionSizing.mode=RISK_BASED requires stopLoss.mode=SIGNAL_PRICE');
        }

        const lossStreakSteps = (input?.tradeGuards?.lossStreakThrottle?.steps ?? [])
            .map((step, index) => ({
                afterLosses: ensurePositiveInteger(step.afterLosses, `tradeGuards.lossStreakThrottle.steps[${index}].afterLosses`),
                riskPercent: ensurePositive(step.riskPercent, `tradeGuards.lossStreakThrottle.steps[${index}].riskPercent`),
            }))
            .sort((left, right) => left.afterLosses - right.afterLosses);

        const lossStreakCooldown = input?.tradeGuards?.lossStreakCooldown;
        const resolvedLossStreakCooldown = {
            afterLosses: lossStreakCooldown?.afterLosses ?? null,
            cooldownMinutes: lossStreakCooldown?.cooldownMinutes ?? null,
        };
        if (resolvedLossStreakCooldown.afterLosses !== null) {
            ensurePositiveInteger(resolvedLossStreakCooldown.afterLosses, 'tradeGuards.lossStreakCooldown.afterLosses');
        }
        if (resolvedLossStreakCooldown.cooldownMinutes !== null) {
            ensurePositiveInteger(resolvedLossStreakCooldown.cooldownMinutes, 'tradeGuards.lossStreakCooldown.cooldownMinutes');
        }
        if ((resolvedLossStreakCooldown.afterLosses === null) !== (resolvedLossStreakCooldown.cooldownMinutes === null)) {
            throw new Error('tradeGuards.lossStreakCooldown requires both afterLosses and cooldownMinutes');
        }

        const resolveLossCap = (scope: 'sessionLossCap' | 'dayLossCap') => {
            const config = input?.tradeGuards?.[scope];
            const maxLosses = config?.maxLosses ?? null;
            const maxNetR = config?.maxNetR ?? null;

            if (maxLosses !== null) {
                ensurePositiveInteger(maxLosses, `tradeGuards.${scope}.maxLosses`);
            }
            if (maxNetR !== null) {
                ensurePositive(maxNetR, `tradeGuards.${scope}.maxNetR`);
            }

            return {
                maxLosses,
                maxNetR,
            };
        };

        const equityCurveFilterInput = input?.tradeGuards?.equityCurveFilter;
        const resolvedEquityCurveFilter = {
            emaTrades: equityCurveFilterInput?.emaTrades ?? null,
            action: equityCurveFilterInput?.action ?? null,
        };
        if (resolvedEquityCurveFilter.emaTrades !== null) {
            ensurePositiveInteger(resolvedEquityCurveFilter.emaTrades, 'tradeGuards.equityCurveFilter.emaTrades');
            if (resolvedEquityCurveFilter.emaTrades < 2) {
                throw new Error('tradeGuards.equityCurveFilter.emaTrades must be at least 2');
            }
        }
        if (resolvedEquityCurveFilter.action !== null && !['BLOCK', 'HALF_RISK'].includes(resolvedEquityCurveFilter.action)) {
            throw new Error('tradeGuards.equityCurveFilter.action must be BLOCK or HALF_RISK');
        }
        if ((resolvedEquityCurveFilter.emaTrades === null) !== (resolvedEquityCurveFilter.action === null)) {
            throw new Error('tradeGuards.equityCurveFilter requires both emaTrades and action');
        }

        const maxDrawdownHaltInput = input?.tradeGuards?.maxDrawdownHalt;
        const resolvedMaxDrawdownHalt = {
            maxDrawdownPct: maxDrawdownHaltInput?.maxDrawdownPct ?? null,
        };
        if (resolvedMaxDrawdownHalt.maxDrawdownPct !== null) {
            ensurePositive(resolvedMaxDrawdownHalt.maxDrawdownPct, 'tradeGuards.maxDrawdownHalt.maxDrawdownPct');
        }

        const minTradeSpacingInput = input?.tradeGuards?.minTradeSpacing;
        const resolvedMinTradeSpacing = {
            minSpacingMinutes: minTradeSpacingInput?.minSpacingMinutes ?? null,
        };
        if (resolvedMinTradeSpacing.minSpacingMinutes !== null) {
            ensurePositive(resolvedMinTradeSpacing.minSpacingMinutes, 'tradeGuards.minTradeSpacing.minSpacingMinutes');
        }

        const entryBurstInput = input?.tradeGuards?.entryBurstCooldown;
        const resolvedEntryBurst = {
            maxEntriesInWindow: entryBurstInput?.maxEntriesInWindow ?? null,
            windowMinutes: entryBurstInput?.windowMinutes ?? null,
            cooldownMinutes: entryBurstInput?.cooldownMinutes ?? null,
        };
        if (resolvedEntryBurst.maxEntriesInWindow !== null) {
            ensurePositiveInteger(resolvedEntryBurst.maxEntriesInWindow, 'tradeGuards.entryBurstCooldown.maxEntriesInWindow');
        }
        if (resolvedEntryBurst.windowMinutes !== null) {
            ensurePositive(resolvedEntryBurst.windowMinutes, 'tradeGuards.entryBurstCooldown.windowMinutes');
        }
        if (resolvedEntryBurst.cooldownMinutes !== null) {
            ensurePositive(resolvedEntryBurst.cooldownMinutes, 'tradeGuards.entryBurstCooldown.cooldownMinutes');
        }
        const burstFieldCount = [resolvedEntryBurst.maxEntriesInWindow, resolvedEntryBurst.windowMinutes, resolvedEntryBurst.cooldownMinutes]
            .filter((v) => v !== null).length;
        if (burstFieldCount > 0 && burstFieldCount < 3) {
            throw new Error('tradeGuards.entryBurstCooldown requires all three fields: maxEntriesInWindow, windowMinutes, cooldownMinutes');
        }

        return {
            entryFeeBps: input?.entryFeeBps ?? 0,
            exitFeeBps: input?.exitFeeBps ?? 0,
            entrySlippageBps: input?.entrySlippageBps ?? 0,
            exitSlippageBps: input?.exitSlippageBps ?? 0,
            orderTiming,
            stopLoss: {
                mode: stopLossMode,
                value: input?.stopLoss?.value ?? null,
            },
            takeProfit: {
                mode: takeProfitMode,
                value: input?.takeProfit?.value ?? null,
            },
            positionSizing: {
                mode: positionSizingMode,
                value: input?.positionSizing?.value ?? null,
                maxQuantity: input?.positionSizing?.maxQuantity ?? null,
            },
            tradeGuards: {
                lossStreakThrottle: {
                    steps: lossStreakSteps,
                },
                lossStreakCooldown: resolvedLossStreakCooldown,
                sessionLossCap: resolveLossCap('sessionLossCap'),
                dayLossCap: resolveLossCap('dayLossCap'),
                equityCurveFilter: resolvedEquityCurveFilter,
                maxDrawdownHalt: resolvedMaxDrawdownHalt,
                minTradeSpacing: resolvedMinTradeSpacing,
                entryBurstCooldown: resolvedEntryBurst,
            },
            compoundEquity: input?.compoundEquity ?? false,
        };
    }

    public getEntryFill(request: EntryFillRequest): FillResult {
        const slipFraction = request.config.entrySlippageBps / 10_000;
        const adjustedPrice = request.side === PositionSide.LONG
            ? request.rawPrice * (1 + slipFraction)
            : request.rawPrice * (1 - slipFraction);

        return {
            adjustedPrice: round(adjustedPrice),
            feeFraction: request.config.entryFeeBps / 10_000,
        };
    }

    public getExitFill(request: ExitFillRequest): FillResult {
        const slipFraction = request.config.exitSlippageBps / 10_000;
        const adjustedPrice = request.side === PositionSide.LONG
            ? request.rawPrice * (1 - slipFraction)
            : request.rawPrice * (1 + slipFraction);

        return {
            adjustedPrice: round(adjustedPrice),
            feeFraction: request.config.exitFeeBps / 10_000,
        };
    }

    public resolvePositionSizing(request: PositionSizingRequest): PositionSizingResult {
        const entryPrice = ensurePositive(request.entryPrice, 'entryPrice');
        const initialEquity = ensurePositive(request.initialEquity, 'initialEquity');

        let quantity = 0;
        if (request.config.positionSizing.mode === 'RISK_BASED') {
            const stopDistance = Math.abs(entryPrice - request.stopLossPrice);
            if (stopDistance <= epsilon) {
                throw new Error('Cannot resolve RISK_BASED position sizing when stopLoss equals entryPrice');
            }

            quantity = ensurePositive(request.riskAmountUsd, 'riskAmountUsd') / stopDistance;
        } else if (request.config.positionSizing.mode === 'FIXED_QUANTITY') {
            quantity = ensurePositive(request.config.positionSizing.value, 'positionSizing.value');
        } else {
            const notionalUsd = resolveAccountAmount('ACCOUNT_PERCENT', request.config.positionSizing.value!, initialEquity);
            quantity = notionalUsd / entryPrice;
        }

        // Apply volume cap (e.g. maxQuantity: 100 → 1 lot XAU)
        if (request.config.positionSizing.maxQuantity !== null && quantity > request.config.positionSizing.maxQuantity) {
            quantity = request.config.positionSizing.maxQuantity;
        }

        const notionalUsd = quantity * entryPrice;
        return {
            quantity: round(quantity, 8),
            notionalUsd: round(notionalUsd, 8),
            accountUsageUsd: round(notionalUsd, 8),
            accountUsagePct: round((notionalUsd / initialEquity) * 100, 6),
        };
    }

    public resolveStopLoss(request: StopLossResolutionRequest): StopLossResolutionResult {
        if (request.config.stopLoss.mode === 'SIGNAL_PRICE') {
            return {
                stopLossPrice: round(request.signalStopLossPrice),
                configuredRiskAmountUsd: null,
            };
        }

        const quantity = ensurePositive(request.positionQuantity ?? null, 'positionQuantity');
        const riskAmountUsd = resolveAccountAmount(
            request.config.stopLoss.mode,
            request.config.stopLoss.value!,
            request.initialEquity,
        );
        const stopDistance = riskAmountUsd / quantity;
        const stopLossPrice = request.side === PositionSide.LONG
            ? request.entryPrice - stopDistance
            : request.entryPrice + stopDistance;

        return {
            stopLossPrice: round(stopLossPrice),
            configuredRiskAmountUsd: round(riskAmountUsd, 8),
        };
    }

    public resolveTakeProfit(request: TakeProfitResolutionRequest): TakeProfitResolutionResult {
        if (request.config.takeProfit.mode === 'SIGNAL_PRICE') {
            return {
                takeProfitPrice: request.signalTakeProfitPrice ?? null,
                configuredTargetAmountUsd: null,
            };
        }

        if (request.config.takeProfit.mode === 'R_MULTIPLE') {
            const multiple = ensurePositive(request.config.takeProfit.value, 'takeProfit.value');
            const stopDistance = Math.abs(request.entryPrice - request.stopLossPrice);
            if (stopDistance <= epsilon) {
                throw new Error('Cannot resolve takeProfit.mode=R_MULTIPLE when stopLoss equals entryPrice');
            }

            const takeProfitPrice = request.side === PositionSide.LONG
                ? request.entryPrice + stopDistance * multiple
                : request.entryPrice - stopDistance * multiple;

            return {
                takeProfitPrice: round(takeProfitPrice),
                configuredTargetAmountUsd: null,
            };
        }

        const quantity = ensurePositive(request.positionQuantity ?? null, 'positionQuantity');
        const targetAmountUsd = resolveAccountAmount(
            request.config.takeProfit.mode,
            request.config.takeProfit.value!,
            request.initialEquity,
        );
        const priceDistance = targetAmountUsd / quantity;
        const takeProfitPrice = request.side === PositionSide.LONG
            ? request.entryPrice + priceDistance
            : request.entryPrice - priceDistance;

        return {
            takeProfitPrice: round(takeProfitPrice),
            configuredTargetAmountUsd: round(targetAmountUsd, 8),
        };
    }

    public calculateNetPnl(request: TradePnlRequest): TradePnlResult {
        const quantity = ensurePositive(request.quantity, 'quantity');
        const entryFill = this.getEntryFill({
            side: request.side,
            rawPrice: request.entryPrice,
            config: request.config,
        });
        const exitFill = this.getExitFill({
            side: request.side,
            rawPrice: request.exitPrice,
            config: request.config,
        });

        const grossPnlUsd = request.side === PositionSide.LONG
            ? (exitFill.adjustedPrice - entryFill.adjustedPrice) * quantity
            : (entryFill.adjustedPrice - exitFill.adjustedPrice) * quantity;
        const feeUsd = (entryFill.adjustedPrice * entryFill.feeFraction + exitFill.adjustedPrice * exitFill.feeFraction) * quantity;
        const netPnlUsd = grossPnlUsd - feeUsd;

        return {
            grossPnlUsd: round(grossPnlUsd, 6),
            feeUsd: round(feeUsd, 6),
            netPnlUsd: round(netPnlUsd, 6),
            entryFillPrice: entryFill.adjustedPrice,
            exitFillPrice: exitFill.adjustedPrice,
        };
    }

    public calculateNetR(request: RMultipleRequest): RMultipleResult {
        const quantity = request.quantity ?? 1;
        const pnl = this.calculateNetPnl({
            side: request.side,
            entryPrice: request.entryPrice,
            exitPrice: request.exitPrice,
            quantity,
            config: request.config,
        });
        const stopPnl = this.calculateNetPnl({
            side: request.side,
            entryPrice: request.entryPrice,
            exitPrice: request.stopLoss,
            quantity,
            config: request.config,
        });
        const riskAmountUsd = request.riskAmountUsd && request.riskAmountUsd > 0
            ? request.riskAmountUsd
            : Math.max(Math.abs(stopPnl.netPnlUsd), epsilon);
        const grossR = pnl.grossPnlUsd / riskAmountUsd;
        const feeR = pnl.feeUsd / riskAmountUsd;

        return {
            grossR: round(grossR, 6),
            feeR: round(feeR, 6),
            netR: round(pnl.netPnlUsd / riskAmountUsd, 6),
            grossPnlUsd: pnl.grossPnlUsd,
            feeUsd: pnl.feeUsd,
            netPnlUsd: pnl.netPnlUsd,
            riskAmountUsd: round(riskAmountUsd, 6),
        };
    }
}
