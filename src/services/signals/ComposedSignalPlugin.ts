import { ExitReason, PositionSide, SignalEventType, TradingSession } from '@prisma/client';
import { createHash } from 'crypto';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';
import {
    CandleBar,
    ExecutionConfigResolved,
    RuntimeLogicTraceDraft,
    RuntimeResultDraft,
    RuntimeSignalDraft,
    RuntimeSignalEventDraft,
    SignalBarContext,
    SignalInitializationContext,
    SignalPlugin,
    SignalPluginDefinition,
    SignalRunOutput,
    SignalStepResult,
    compressDecisionLog,
} from './types';
import { DecisionLogCollector } from './decisionLogCollector';
import { applyExitProfileOverrides, ExitProfileOverrides } from './exitProfileOverrides';

// ─── Composed Signal Definition (stored in DB as composed_blocks JSON) ───────

export interface ComposedBlockConfig {
    /** Unique ID within this composition, e.g. "rsi_oversold" */
    id: string;
    /** Which TechIndicatorBlock to use, e.g. "RSI", "EMA_CROSS" */
    indicatorId: string;
    /** Which condition from that block to check, e.g. "value_below" */
    conditionId: string;
    /** Params for the indicator itself (period, fastPeriod...) */
    indicatorParams: Record<string, unknown>;
    /** Params for the specific condition (threshold, lookback...) */
    conditionParams: Record<string, unknown>;
    /** Optional: use a different timeframe for this block. Defaults to base timeframe. */
    timeframe?: string;
}

export type MatchMode = 'ALL' | 'ANY' | 'SEQUENCE';

export interface ComposedStopLossConfig {
    /**
     * BELOW_STRUCTURE: SL below lowest low (LONG) / above highest high (SHORT) in lookback bars
     * FIXED_PERCENT:   SL at entry ± value%
     */
    type: 'BELOW_STRUCTURE' | 'FIXED_PERCENT';
    /** Meaning depends on type: buffer fraction for BELOW_STRUCTURE, percent fraction for FIXED_PERCENT */
    value: number;
    /** Lookback bars for BELOW_STRUCTURE (default 20) */
    lookback?: number;
    /** Optional: Buffer stop by multiplier * ATR */
    atrBufferMultiplier?: number;
    /** Optional: ATR period for buffering (default 14) */
    atrPeriod?: number;
}

export interface ComposedTakeProfitConfig {
    /**
     * R_MULTIPLE:   TP at entry + risk * value (e.g. value=2.0 = 2R)
     * FIXED_PERCENT: TP at entry ± value%
     */
    type: 'R_MULTIPLE' | 'FIXED_PERCENT';
    value: number;
}

export interface ComposedExitManagementConfig {
    profileCode: ComposedExitStrategyCode;
    maxBarsInTrade?: number;
}

export interface ComposedSignalAreaGuardConfig {
    maxSignalsPerArea: number;
    resetBars?: number;
    priceDistanceR?: number;
}

export interface ComposedEntryManagementConfig {
    signalAreaGuard?: ComposedSignalAreaGuardConfig;
}

export interface ComposedSignalLineage {
    relationship: 'REFINEMENT';
    parentSignalId: string;
    parentCode: string;
    parentVersion: number;
    parentName: string;
}

export interface ComposedSignalDefinition {
    /** ALL: every block must fire within windowBars. ANY: first block to fire triggers. SEQUENCE: blocks must fire in order. */
    matchMode: MatchMode;
    /**
     * Maximum bar gap between the first and last condition firing.
     * windowBars=1 means all conditions must fire on the same bar.
     */
    windowBars: number;
    side: 'LONG' | 'SHORT';
    blocks: ComposedBlockConfig[];
    stopLoss: ComposedStopLossConfig;
    takeProfit: ComposedTakeProfitConfig;
    entryManagement?: ComposedEntryManagementConfig;
    exitManagement?: ComposedExitManagementConfig;
    lineage?: ComposedSignalLineage;
}

// ─── Plugin State ─────────────────────────────────────────────────────────────

interface ComposedState {
    /** Each block entry's state, keyed by ComposedBlockConfig.id */
    blockStates: Record<string, unknown>;
    /**
     * Tracks when each block last fired: blockEntry.id → barIndex.
     * Entries are purged when they become older than windowBars.
     */
    conditionWindow: Record<string, number>;
    signalArea: SignalAreaState | null;
    lastEmittedMatchSignature?: string | null;
}

interface SignalAreaState {
    anchorPrice: number;
    riskDistance: number;
    startedAtIndex: number;
    lastActivityIndex: number;
    emittedSignals: number;
}

interface ResolvedSignalAreaGuard {
    maxSignalsPerArea: number;
    resetBars: number;
    priceDistanceR: number;
}

interface GuardedTradeSnapshot {
    entryTime: Date;
    exitTime: Date;
    netR: number;
    pnlUsd: number;
}

interface TradeGuardState {
    rawConsecutiveLosses: number;
    consecutiveLosses: number;
    sessionLosses: number;
    sessionNetR: number;
    dayLosses: number;
    dayNetR: number;
    effectiveRiskPercent: number;
    cooldownActiveUntil: Date | null;
    blockedReasons: string[];
    currentEquity: number;
    equityPeak: number;
    currentDrawdownPct: number;
    equityEma: number | null;
}

export type ComposedExitStrategyCode =
    | 'HARD_SIGNAL_TP'
    | 'FIXED_1R'
    | 'FIXED_2R'
    | 'BE_1R_TP_2R'
    | 'PARTIAL_1R_BE_R3'
    | 'BE_1R_TRAIL_2R_3R'
    | 'BE_1R_PARTIAL_2R_TRAIL'
    | 'PARTIAL_1R_BE_SWING_TRAIL'
    | 'XAU_NY_CLOSE'
    | 'TIME_24';

interface ComposedTrailStage {
    triggerR: number;
    stopToR: number;
}

interface ComposedExitProfile {
    code: ComposedExitStrategyCode;
    name: string;
    description: string;
    targetR: number | null;
    breakEvenAtR: number | null;
    partialAtR: number | null;
    partialCloseFraction: number;
    trailStages: ComposedTrailStage[];
    maxBarsInTrade: number | null;
    trailByStructureLookback?: number | null;
    exitAtNyClose?: boolean | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Binary-search for the last bar in `bars` whose time <= `target`.
 * Returns the index, or -1 if none found.
 */
function findLastBarIndexAtOrBefore(bars: CandleBar[], target: Date): number {
    const t = target.getTime();
    let lo = 0;
    let hi = bars.length - 1;
    let result = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (bars[mid].time.getTime() <= t) {
            result = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return result;
}

function calcStopLoss(
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    config: ComposedStopLossConfig,
    bars: CandleBar[],
    currentIndex: number,
): number {
    const lookback = Math.min(config.lookback ?? 20, currentIndex);
    const start = currentIndex - lookback;
    const slice = bars.slice(start, currentIndex + 1);

    if (config.type === 'BELOW_STRUCTURE') {
        const buffer = config.value ?? 0.002;
        let baseStop = 0;
        if (side === 'LONG') {
            const lowestLow = Math.min(...slice.map(b => b.low));
            baseStop = lowestLow * (1 - buffer);
        } else {
            const highestHigh = Math.max(...slice.map(b => b.high));
            baseStop = highestHigh * (1 + buffer);
        }

        if (config.atrBufferMultiplier && config.atrBufferMultiplier > 0) {
            const atrPeriod = config.atrPeriod ?? 14;
            const atrSlice = bars.slice(Math.max(0, currentIndex - atrPeriod), currentIndex + 1);
            if (atrSlice.length > 1) {
                const trs = atrSlice.map((b, i) => {
                    if (i === 0) return b.high - b.low;
                    const prev = atrSlice[i - 1];
                    return Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close));
                });
                const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
                const atrBuffer = atr * config.atrBufferMultiplier;
                return side === 'LONG' ? baseStop - atrBuffer : baseStop + atrBuffer;
            }
        }
        return baseStop;
    }

    // FIXED_PERCENT
    const pct = config.value ?? 0.005;
    return side === 'LONG' ? entryPrice * (1 - pct) : entryPrice * (1 + pct);
}

function calcTakeProfit(
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    stopLossPrice: number,
    config: ComposedTakeProfitConfig,
): number {
    const risk = Math.abs(entryPrice - stopLossPrice);

    if (config.type === 'R_MULTIPLE') {
        const multiple = config.value ?? 2.0;
        return side === 'LONG'
            ? entryPrice + risk * multiple
            : entryPrice - risk * multiple;
    }

    // FIXED_PERCENT
    const pct = config.value ?? 0.01;
    return side === 'LONG' ? entryPrice * (1 + pct) : entryPrice * (1 - pct);
}

function deriveStrategyCode(definitionCode: string): string {
    const normalized = definitionCode
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (normalized.length <= 40) {
        return normalized;
    }

    const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 8).toUpperCase();
    return `${normalized.slice(0, 31)}_${digest}`;
}

const COMPOSED_EXIT_PROFILES: Record<ComposedExitStrategyCode, ComposedExitProfile> = {
    HARD_SIGNAL_TP: {
        code: 'HARD_SIGNAL_TP',
        name: 'Hard SL / Signal TP',
        description: 'Hard stop loss and the signal-defined take profit.',
        targetR: null,
        breakEvenAtR: null,
        partialAtR: null,
        partialCloseFraction: 0,
        trailStages: [],
        maxBarsInTrade: null,
    },
    FIXED_1R: {
        code: 'FIXED_1R',
        name: 'Hard SL / 1R',
        description: 'Hard stop loss with a fixed 1R target (1:1 risk-reward).',
        targetR: 1,
        breakEvenAtR: null,
        partialAtR: null,
        partialCloseFraction: 0,
        trailStages: [],
        maxBarsInTrade: null,
    },
    FIXED_2R: {
        code: 'FIXED_2R',
        name: 'Hard SL / 2R',
        description: 'Hard stop loss with a fixed 2R target.',
        targetR: 2,
        breakEvenAtR: null,
        partialAtR: null,
        partialCloseFraction: 0,
        trailStages: [],
        maxBarsInTrade: null,
    },
    BE_1R_TP_2R: {
        code: 'BE_1R_TP_2R',
        name: 'Move BE at 1R / TP 2R',
        description: 'Move stop to break-even after 1R, then target 2R.',
        targetR: 2,
        breakEvenAtR: 1,
        partialAtR: null,
        partialCloseFraction: 0,
        trailStages: [],
        maxBarsInTrade: null,
    },
    PARTIAL_1R_BE_R3: {
        code: 'PARTIAL_1R_BE_R3',
        name: '50% at 1R / BE / TP 3R',
        description: 'Take 50% at 1R, move stop to break-even, target 3R on the remainder.',
        targetR: 3,
        breakEvenAtR: 1,
        partialAtR: 1,
        partialCloseFraction: 0.5,
        trailStages: [],
        maxBarsInTrade: null,
    },
    BE_1R_TRAIL_2R_3R: {
        code: 'BE_1R_TRAIL_2R_3R',
        name: 'Move BE at 1R / Trail at 2R and 3R',
        description: 'Move stop to break-even at 1R, then ratchet stop to 1R at 2R and 2R at 3R.',
        targetR: null,
        breakEvenAtR: 1,
        partialAtR: null,
        partialCloseFraction: 0,
        trailStages: [
            { triggerR: 2, stopToR: 1 },
            { triggerR: 3, stopToR: 2 },
        ],
        maxBarsInTrade: null,
    },
    BE_1R_PARTIAL_2R_TRAIL: {
        code: 'BE_1R_PARTIAL_2R_TRAIL',
        name: '3-Stage: BE 1R → 50% at 2R → Trail',
        description: 'Move stop to break-even at 1R, take 50% profit at 2R, then progressively trail the remainder.',
        targetR: null,
        breakEvenAtR: 1,
        partialAtR: 2,
        partialCloseFraction: 0.5,
        trailStages: [
            { triggerR: 3, stopToR: 2 },
            { triggerR: 4, stopToR: 3 },
            { triggerR: 5, stopToR: 4 },
            { triggerR: 6, stopToR: 5 },
        ],
        maxBarsInTrade: null,
    },
    TIME_24: {
        code: 'TIME_24',
        name: 'Time Stop 24 Bars',
        description: 'Hold until stop, target, or force-close after 24 bars.',
        targetR: 1.5,
        breakEvenAtR: null,
        partialAtR: null,
        partialCloseFraction: 0,
        trailStages: [],
        maxBarsInTrade: 24,
    },
    PARTIAL_1R_BE_SWING_TRAIL: {
        code: 'PARTIAL_1R_BE_SWING_TRAIL',
        name: '50% at 1R / BE / Swing Trail',
        description: 'Take 50% profit at 1R, move stop to BE, then trail behind the last 12 bars structure.',
        targetR: null,
        breakEvenAtR: 1,
        partialAtR: 1,
        partialCloseFraction: 0.5,
        trailStages: [],
        maxBarsInTrade: null,
        trailByStructureLookback: 12,
    },
    XAU_NY_CLOSE: {
        code: 'XAU_NY_CLOSE',
        name: 'TP 2R / Force Close NY End',
        description: 'Targets 2R, but force closes at 21:00 UTC (NY session end) to avoid swap/rollover risks.',
        targetR: 2,
        breakEvenAtR: 1,
        partialAtR: null,
        partialCloseFraction: 0,
        trailStages: [],
        maxBarsInTrade: null,
        exitAtNyClose: true,
    },
};

const resolveComposedExitProfile = (
    parameters: Record<string, unknown>,
    defaultProfileCode?: ComposedExitStrategyCode,
): ComposedExitProfile => {
    const raw = typeof parameters.exitStrategy === 'string'
        ? parameters.exitStrategy.trim().toUpperCase()
        : defaultProfileCode ?? '';

    const profile = (raw && raw in COMPOSED_EXIT_PROFILES)
        ? COMPOSED_EXIT_PROFILES[raw as ComposedExitStrategyCode]
        : COMPOSED_EXIT_PROFILES.HARD_SIGNAL_TP;

    const overrides = (parameters.exitProfileOverrides && typeof parameters.exitProfileOverrides === 'object')
        ? parameters.exitProfileOverrides as ExitProfileOverrides
        : {} as ExitProfileOverrides;

    // Legacy support: maxBarsInTrade as top-level parameter
    if (typeof parameters.maxBarsInTrade === 'number' && overrides.maxBarsInTrade === undefined) {
        overrides.maxBarsInTrade = parameters.maxBarsInTrade;
    }

    return applyExitProfileOverrides(profile, overrides) as ComposedExitProfile;
};

const resolveSession = (time: Date): TradingSession => {
    const hour = time.getUTCHours();
    if (hour < 8) return TradingSession.ASIAN;
    if (hour < 13) return TradingSession.LONDON;
    return TradingSession.NY;
};

const round = (value: number, digits = 6) => Number(value.toFixed(digits));

const roundMoney = (value: number) => Number(value.toFixed(2));

const appendNote = (current: string | null | undefined, extra: string) => (
    current && current.trim().length > 0 ? `${current} | ${extra}` : extra
);

const resolveSignalAreaGuard = (
    config?: ComposedSignalAreaGuardConfig | null,
): ResolvedSignalAreaGuard | null => {
    if (!config) {
        return null;
    }

    return {
        maxSignalsPerArea: config.maxSignalsPerArea,
        resetBars: config.resetBars ?? 24,
        priceDistanceR: config.priceDistanceR ?? 1,
    };
};

const isSameSignalArea = (
    area: SignalAreaState,
    currentIndex: number,
    entryPrice: number,
    riskDistance: number,
    guard: ResolvedSignalAreaGuard,
) => {
    if (currentIndex - area.lastActivityIndex > guard.resetBars) {
        return false;
    }

    const referenceRiskDistance = Math.max(area.riskDistance, riskDistance);
    const maxDistance = referenceRiskDistance * guard.priceDistanceR;
    return Math.abs(entryPrice - area.anchorPrice) <= maxDistance;
};

const buildUtcDayKey = (time: Date) => time.toISOString().slice(0, 10);

const buildUtcSessionKey = (time: Date) => `${buildUtcDayKey(time)}:${resolveSession(time)}`;

const buildExitRuleCode = (profile: ComposedExitProfile) => `CMP_${profile.code}`;

const buildTargetPriceFromR = (side: PositionSide, entryPrice: number, riskDistance: number, targetR: number) => (
    side === PositionSide.LONG
        ? entryPrice + riskDistance * targetR
        : entryPrice - riskDistance * targetR
);

const tightenStopFromR = (
    side: PositionSide,
    entryPrice: number,
    riskDistance: number,
    currentStop: number,
    stopToR: number,
) => {
    const candidate = buildTargetPriceFromR(side, entryPrice, riskDistance, stopToR);

    if (side === PositionSide.LONG) {
        return Math.max(currentStop, candidate);
    }

    return Math.min(currentStop, candidate);
};

const barHitsStop = (bar: CandleBar, side: PositionSide, stopPrice: number) => (
    side === PositionSide.LONG ? bar.low <= stopPrice : bar.high >= stopPrice
);

const barHitsTarget = (bar: CandleBar, side: PositionSide, targetPrice: number) => (
    side === PositionSide.LONG ? bar.high >= targetPrice : bar.low <= targetPrice
);

const getUnfavorableMovePct = (bar: CandleBar, side: PositionSide, entryPrice: number) => (
    side === PositionSide.LONG
        ? ((bar.low - entryPrice) / entryPrice) * 100
        : ((entryPrice - bar.high) / entryPrice) * 100
);

const computeEquityEma = (equityPoints: number[], period: number): number | null => {
    if (equityPoints.length < period) {
        return null;
    }
    const k = 2 / (period + 1);
    let ema = equityPoints.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    for (let index = period; index < equityPoints.length; index += 1) {
        ema = equityPoints[index] * k + ema * (1 - k);
    }
    return ema;
};

const resolveTradeGuardState = (
    executionConfig: ExecutionConfigResolved,
    baseRiskPercent: number,
    closedTrades: GuardedTradeSnapshot[],
    entryTime: Date,
    initialEquity: number,
): TradeGuardState => {
    const eligibleClosed = closedTrades
        .filter((trade) => trade.exitTime.getTime() <= entryTime.getTime())
        .sort((left, right) => left.exitTime.getTime() - right.exitTime.getTime());
    const sessionKey = buildUtcSessionKey(entryTime);
    const dayKey = buildUtcDayKey(entryTime);
    const sessionClosed = eligibleClosed.filter((trade) => buildUtcSessionKey(trade.entryTime) === sessionKey);
    const dayClosed = eligibleClosed.filter((trade) => buildUtcDayKey(trade.entryTime) === dayKey);

    let rawConsecutiveLosses = 0;
    let lastLossExitTime: Date | null = null;
    for (let index = eligibleClosed.length - 1; index >= 0; index -= 1) {
        if (eligibleClosed[index].netR >= 0) {
            break;
        }
        rawConsecutiveLosses += 1;
        lastLossExitTime = lastLossExitTime ?? eligibleClosed[index].exitTime;
    }

    let consecutiveLosses = rawConsecutiveLosses;
    let cooldownActiveUntil: Date | null = null;
    const lossStreakCooldown = executionConfig.tradeGuards.lossStreakCooldown;
    if (
        lossStreakCooldown.afterLosses !== null
        && lossStreakCooldown.cooldownMinutes !== null
        && rawConsecutiveLosses >= lossStreakCooldown.afterLosses
        && lastLossExitTime
    ) {
        cooldownActiveUntil = new Date(lastLossExitTime.getTime() + (lossStreakCooldown.cooldownMinutes * 60 * 1000));
        if (entryTime.getTime() < cooldownActiveUntil.getTime()) {
            consecutiveLosses = lossStreakCooldown.afterLosses;
        } else {
            consecutiveLosses = 0;
            cooldownActiveUntil = null;
        }
    }

    const sessionLosses = sessionClosed.filter((trade) => trade.netR < 0).length;
    const sessionNetR = sessionClosed.reduce((sum, trade) => sum + trade.netR, 0);
    const dayLosses = dayClosed.filter((trade) => trade.netR < 0).length;
    const dayNetR = dayClosed.reduce((sum, trade) => sum + trade.netR, 0);

    // ─── Equity curve tracking ───────────────────────────────────────────────
    let currentEquity = initialEquity;
    let equityPeak = initialEquity;
    const equityPoints: number[] = [initialEquity];
    for (const trade of eligibleClosed) {
        currentEquity += trade.pnlUsd;
        equityPeak = Math.max(equityPeak, currentEquity);
        equityPoints.push(currentEquity);
    }
    const currentDrawdownPct = equityPeak > 0
        ? ((equityPeak - currentEquity) / equityPeak) * 100
        : 0;

    // ─── Equity curve EMA ────────────────────────────────────────────────────
    const ecf = executionConfig.tradeGuards.equityCurveFilter;
    const equityEma = ecf.emaTrades !== null
        ? computeEquityEma(equityPoints, ecf.emaTrades)
        : null;

    // ─── Risk adjustments ────────────────────────────────────────────────────
    let effectiveRiskPercent = baseRiskPercent;
    for (const step of executionConfig.tradeGuards.lossStreakThrottle.steps) {
        if (consecutiveLosses >= step.afterLosses) {
            effectiveRiskPercent = Math.min(effectiveRiskPercent, step.riskPercent);
        }
    }

    // Equity curve filter: HALF_RISK action
    if (ecf.action === 'HALF_RISK' && equityEma !== null && currentEquity < equityEma) {
        effectiveRiskPercent = round(effectiveRiskPercent / 2, 4);
    }

    const blockedReasons: string[] = [];
    if (cooldownActiveUntil) {
        blockedReasons.push(
            `loss_streak_cooldown:${rawConsecutiveLosses}/${lossStreakCooldown.afterLosses}:until:${cooldownActiveUntil.toISOString()}`,
        );
    }

    const sessionLossCap = executionConfig.tradeGuards.sessionLossCap;
    if (sessionLossCap.maxLosses !== null && sessionLosses >= sessionLossCap.maxLosses) {
        blockedReasons.push(`session_max_losses:${sessionLosses}/${sessionLossCap.maxLosses}`);
    }
    if (sessionLossCap.maxNetR !== null && sessionNetR <= -sessionLossCap.maxNetR) {
        blockedReasons.push(`session_max_net_r:${round(sessionNetR, 4)}/-${sessionLossCap.maxNetR}`);
    }

    const dayLossCap = executionConfig.tradeGuards.dayLossCap;
    if (dayLossCap.maxLosses !== null && dayLosses >= dayLossCap.maxLosses) {
        blockedReasons.push(`day_max_losses:${dayLosses}/${dayLossCap.maxLosses}`);
    }
    if (dayLossCap.maxNetR !== null && dayNetR <= -dayLossCap.maxNetR) {
        blockedReasons.push(`day_max_net_r:${round(dayNetR, 4)}/-${dayLossCap.maxNetR}`);
    }

    // ─── Equity Curve Filter: BLOCK action ───────────────────────────────────
    if (ecf.action === 'BLOCK' && equityEma !== null && currentEquity < equityEma) {
        blockedReasons.push(
            `equity_curve_filter:equity=${round(currentEquity, 2)}<ema=${round(equityEma, 2)}`,
        );
    }

    // ─── Max Drawdown Halt ───────────────────────────────────────────────────
    const maxDdHalt = executionConfig.tradeGuards.maxDrawdownHalt;
    if (maxDdHalt.maxDrawdownPct !== null && currentDrawdownPct >= maxDdHalt.maxDrawdownPct) {
        blockedReasons.push(
            `max_drawdown_halt:dd=${round(currentDrawdownPct, 2)}%>=limit=${maxDdHalt.maxDrawdownPct}%`,
        );
    }

    // ─── Min Trade Spacing ───────────────────────────────────────────────────
    const spacing = executionConfig.tradeGuards.minTradeSpacing;
    if (spacing.minSpacingMinutes !== null && eligibleClosed.length > 0) {
        const lastExit = eligibleClosed[eligibleClosed.length - 1].exitTime;
        const minutesSinceLastExit = (entryTime.getTime() - lastExit.getTime()) / 60_000;
        if (minutesSinceLastExit < spacing.minSpacingMinutes) {
            blockedReasons.push(
                `min_trade_spacing:${round(minutesSinceLastExit, 0)}min<${spacing.minSpacingMinutes}min`,
            );
        }
    }

    // ─── Entry Burst Cooldown ────────────────────────────────────────────────
    const burst = executionConfig.tradeGuards.entryBurstCooldown;
    if (burst.maxEntriesInWindow !== null && burst.windowMinutes !== null && burst.cooldownMinutes !== null) {
        // Use ALL closedTrades (not eligibleClosed) so we see trades still open at entryTime
        const todayEntries = closedTrades
            .filter((t) => t.entryTime.getTime() <= entryTime.getTime() && buildUtcDayKey(t.entryTime) === dayKey)
            .sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime());

        const windowMs = burst.windowMinutes * 60_000;
        const cooldownMs = burst.cooldownMinutes * 60_000;
        let burstTrades: GuardedTradeSnapshot[] | null = null;

        // Sliding window: find the latest burst of N entries within windowMinutes
        for (let i = burst.maxEntriesInWindow - 1; i < todayEntries.length; i += 1) {
            const windowStart = todayEntries[i - burst.maxEntriesInWindow + 1].entryTime;
            const windowEnd = todayEntries[i].entryTime;
            if (windowEnd.getTime() - windowStart.getTime() <= windowMs) {
                burstTrades = todayEntries.slice(i - burst.maxEntriesInWindow + 1, i + 1);
            }
        }

        if (burstTrades) {
            const burstEndTime = burstTrades[burstTrades.length - 1].entryTime;
            const cooldownExpiry = new Date(burstEndTime.getTime() + cooldownMs);
            const anyBurstTradeExited = burstTrades.some((t) => t.exitTime.getTime() <= entryTime.getTime());
            const stillInCooldown = entryTime.getTime() < cooldownExpiry.getTime();

            if (stillInCooldown && !anyBurstTradeExited) {
                blockedReasons.push(
                    `entry_burst_cooldown:${burst.maxEntriesInWindow}_in_${burst.windowMinutes}min:until:${cooldownExpiry.toISOString()}`,
                );
            }
        }
    }

    return {
        rawConsecutiveLosses,
        consecutiveLosses,
        sessionLosses,
        sessionNetR: round(sessionNetR, 4),
        dayLosses,
        dayNetR: round(dayNetR, 4),
        effectiveRiskPercent: round(effectiveRiskPercent, 4),
        cooldownActiveUntil,
        blockedReasons,
        currentEquity: round(currentEquity, 2),
        equityPeak: round(equityPeak, 2),
        currentDrawdownPct: round(currentDrawdownPct, 4),
        equityEma: equityEma !== null ? round(equityEma, 2) : null,
    };
};

const buildManagementEvent = (input: {
    signalExternalKey: string;
    eventType: SignalEventType;
    candleTime: Date;
    price: number;
    label: string;
    metaJson?: Record<string, unknown>;
}): RuntimeSignalEventDraft => ({
    signalExternalKey: input.signalExternalKey,
    eventType: input.eventType,
    candleTime: input.candleTime,
    price: round(input.price, 4),
    label: input.label,
    metaJson: input.metaJson ?? null,
});

const buildManagementTrace = (input: {
    signalExternalKey: string;
    eventType: SignalEventType;
    candleTime: Date;
    ruleId: string;
    notes: string;
    priceJson?: Record<string, unknown>;
    thresholdJson?: Record<string, unknown>;
}): RuntimeLogicTraceDraft => ({
    signalExternalKey: input.signalExternalKey,
    eventType: input.eventType,
    candleTime: input.candleTime,
    ruleId: input.ruleId,
    notes: input.notes,
    priceJson: input.priceJson ?? null,
    thresholdJson: input.thresholdJson ?? null,
});

function checkMatch(
    matchMode: MatchMode,
    windowBars: number,
    blocks: ComposedBlockConfig[],
    conditionWindow: Record<string, number>,
    currentIndex: number,
): boolean {
    const allIds = blocks.map(b => b.id);

    // Purge expired entries before check (mutates conditionWindow in place, caller passes copy)
    for (const id of allIds) {
        if (id in conditionWindow && currentIndex - conditionWindow[id] >= windowBars) {
            delete conditionWindow[id];
        }
    }

    switch (matchMode) {
        case 'ALL':
            return allIds.every(id => id in conditionWindow);

        case 'ANY':
            return allIds.some(id => id in conditionWindow);

        case 'SEQUENCE': {
            if (!allIds.every(id => id in conditionWindow)) return false;
            // Check that barIndices are non-decreasing in blocks[] order
            for (let i = 1; i < allIds.length; i++) {
                if (conditionWindow[allIds[i]] < conditionWindow[allIds[i - 1]]) return false;
            }
            return true;
        }

        default:
            return false;
    }
}

function buildMatchSignature(
    parts: string[],
    bar: CandleBar,
): string {
    if (parts.length === 0) {
        return `base:${bar.time.getTime()}`;
    }

    return parts.join('|');
}

// ─── ComposedSignalPlugin ─────────────────────────────────────────────────────

/**
 * A SignalPlugin that executes user-composed logic stored as JSON in the database.
 * Integrates with the existing BacktestRunner and LiveRunner without any changes.
 *
 * One instance is created per signal_definitions row where is_composed=true.
 * The composedDef is loaded from the composed_blocks column.
 */
export class ComposedSignalPlugin implements SignalPlugin<Record<string, unknown>, ComposedState> {
    public readonly definition: SignalPluginDefinition;

    constructor(
        private readonly composedDef: ComposedSignalDefinition,
        private readonly blockRegistry: TechIndicatorRegistry,
        code: string,
        version: number,
        name: string,
    ) {
        this.definition = { code, version, name };
    }

    getRequiredTimeframes(_params: Record<string, unknown>, baseTimeframe: string): string[] {
        const extra = this.composedDef.blocks
            .map(b => b.timeframe)
            .filter((tf): tf is string => !!tf && tf !== baseTimeframe);
        return [...new Set(extra)];
    }

    private resolveBlockParams(
        blockEntry: ComposedBlockConfig,
        parameters: Record<string, unknown>,
    ): Record<string, unknown> {
        const overrides = parameters.blockParamOverrides as Record<string, Record<string, unknown>> | undefined;
        const blockOverrides = overrides?.[blockEntry.id];
        if (!blockOverrides || typeof blockOverrides !== 'object') {
            return blockEntry.indicatorParams as Record<string, unknown>;
        }
        return { ...blockEntry.indicatorParams, ...blockOverrides };
    }

    initialize(ctx: SignalInitializationContext<Record<string, unknown>>): ComposedState {
        const blockStates: Record<string, unknown> = {};

        for (const blockEntry of this.composedDef.blocks) {
            const block = this.blockRegistry.get(blockEntry.indicatorId);
            if (!block) {
                throw new Error(
                    `[ComposedSignalPlugin:${this.definition.code}] Block "${blockEntry.indicatorId}" not found in registry`,
                );
            }
            const tf = blockEntry.timeframe ?? ctx.timeframe;
            const bars = ctx.barsByTimeframe[tf] ?? ctx.baseBars;
            blockStates[blockEntry.id] = block.initialize(
                bars,
                this.resolveBlockParams(blockEntry, ctx.parameters),
                ctx.services,
            );
        }

        return { blockStates, conditionWindow: {}, signalArea: null, lastEmittedMatchSignature: null };
    }

    onBar(ctx: SignalBarContext<Record<string, unknown>, ComposedState>): SignalStepResult<ComposedState> | null {
        const { bar, index, state, baseBars } = ctx;

        const newBlockStates: Record<string, unknown> = { ...state.blockStates };
        // Work on a shallow copy so we can mutate during purge
        const conditionWindow: Record<string, number> = { ...state.conditionWindow };
        const matchSignatureParts: string[] = [];

        const traces: RuntimeLogicTraceDraft[] = [];

        // ── Evaluate each block ──────────────────────────────────────────────
        for (const blockEntry of this.composedDef.blocks) {
            const block = this.blockRegistry.get(blockEntry.indicatorId);
            if (!block) continue;

            const tf = blockEntry.timeframe ?? ctx.timeframe;
            const tfBars = ctx.barsByTimeframe[tf] ?? ctx.baseBars;
            const tfIndex = findLastBarIndexAtOrBefore(tfBars, bar.time);
            if (tfIndex < 0) continue;

            const tfBar = tfBars[tfIndex];
            const tfPrevBar = tfIndex > 0 ? tfBars[tfIndex - 1] : null;

            const result = block.evaluate(
                tfBar,
                tfPrevBar,
                tfBars,
                tfIndex,
                state.blockStates[blockEntry.id],
                this.resolveBlockParams(blockEntry, ctx.parameters),
                blockEntry.conditionId,
                blockEntry.conditionParams,
                ctx.services,
            );

            newBlockStates[blockEntry.id] = result.state;

            matchSignatureParts.push(`${blockEntry.id}:${tfBar.time.getTime()}:${result.isActive ? 1 : 0}`);

            if (result.isActive) {
                conditionWindow[blockEntry.id] = index;
            }

            // Build trace entry for this block evaluation
            const isHtfBlock = tf !== ctx.timeframe;
            const alignmentData = isHtfBlock ? {
                alignment: {
                    timeframe: tf,
                    barTime: tfBar.time.toISOString(),
                    barIndex: tfIndex,
                    gapMs: bar.time.getTime() - tfBar.time.getTime(),
                },
            } : {};
            traces.push({
                signalExternalKey: '',   // filled in if signal fires
                eventType: 'ENTRY',
                candleTime: bar.time,
                ruleId: `${blockEntry.id}:${blockEntry.conditionId}`,
                indicatorJson: result.values as Record<string, unknown>,
                thresholdJson: { ...blockEntry.conditionParams, ...alignmentData },
                notes: result.isActive ? 'CONDITION_MET' : 'CONDITION_NOT_MET',
            });
        }

        // ── Check match ──────────────────────────────────────────────────────
        const matched = checkMatch(
            this.composedDef.matchMode,
            this.composedDef.windowBars,
            this.composedDef.blocks,
            conditionWindow,
            index,
        );

        const signalAreaGuard = resolveSignalAreaGuard(this.composedDef.entryManagement?.signalAreaGuard);
        const currentSignalArea = state.signalArea;
        const currentMatchSignature = buildMatchSignature(matchSignatureParts, bar);
        const newState: ComposedState = {
            blockStates: newBlockStates,
            conditionWindow,
            signalArea: currentSignalArea,
            lastEmittedMatchSignature: state.lastEmittedMatchSignature ?? null,
        };

        if (!matched) {
            return { state: newState };
        }

        if (newState.lastEmittedMatchSignature === currentMatchSignature) {
            return { state: newState };
        }

        // ── Build signal ─────────────────────────────────────────────────────
        const side = this.composedDef.side as PositionSide;
        const entryPrice = bar.close;
        const stopLossPrice = calcStopLoss(
            this.composedDef.side,
            entryPrice,
            this.composedDef.stopLoss,
            baseBars,
            index,
        );
        const takeProfitPrice = calcTakeProfit(
            this.composedDef.side,
            entryPrice,
            stopLossPrice,
            this.composedDef.takeProfit,
        );
        const riskDistance = Math.abs(entryPrice - stopLossPrice);

        let nextSignalArea = currentSignalArea;
        if (signalAreaGuard) {
            const canReuseArea = nextSignalArea
                ? isSameSignalArea(nextSignalArea, index, entryPrice, riskDistance, signalAreaGuard)
                : false;

            nextSignalArea = canReuseArea
                ? {
                    ...nextSignalArea!,
                    lastActivityIndex: index,
                }
                : {
                    anchorPrice: entryPrice,
                    riskDistance,
                    startedAtIndex: index,
                    lastActivityIndex: index,
                    emittedSignals: 0,
                };

            if (nextSignalArea.emittedSignals >= signalAreaGuard.maxSignalsPerArea) {
                return {
                    state: {
                        blockStates: newBlockStates,
                        conditionWindow: {},
                        signalArea: nextSignalArea,
                        lastEmittedMatchSignature: newState.lastEmittedMatchSignature,
                    },
                };
            }
        }

        const externalKey = `${this.definition.code}v${this.definition.version}_${bar.time.getTime()}`;

        const signal: RuntimeSignalDraft = {
            symbol: ctx.symbol,
            timeframe: ctx.timeframe,
            side,
            strategyCode: deriveStrategyCode(this.definition.code),
            entryTime: bar.time,
            entryPrice,
            stopLoss: stopLossPrice,
            takeProfit1: takeProfitPrice,
            externalKey,
            definitionCode: this.definition.code,
            definitionVersion: this.definition.version,
            notes: `Composed signal: ${this.composedDef.blocks.map(b => `${b.indicatorId}:${b.conditionId}`).join(', ')}`,
        };

        if (signalAreaGuard && nextSignalArea) {
            nextSignalArea = {
                ...nextSignalArea,
                emittedSignals: nextSignalArea.emittedSignals + 1,
                lastActivityIndex: index,
            };
            signal.notes = appendNote(
                signal.notes,
                `area:${nextSignalArea.emittedSignals}/${signalAreaGuard.maxSignalsPerArea}`,
            );
        }

        const events: RuntimeSignalEventDraft[] = [
            {
                signalExternalKey: externalKey,
                eventType: 'ENTRY',
                candleTime: bar.time,
                price: entryPrice,
                label: `${this.composedDef.matchMode} match`,
                metaJson: {
                    stopLoss: stopLossPrice,
                    takeProfit: takeProfitPrice,
                    blocksMatched: Object.keys(conditionWindow),
                    signalArea: signalAreaGuard && nextSignalArea
                        ? {
                            startedAtIndex: nextSignalArea.startedAtIndex,
                            emittedSignals: nextSignalArea.emittedSignals,
                            maxSignalsPerArea: signalAreaGuard.maxSignalsPerArea,
                            resetBars: signalAreaGuard.resetBars,
                            priceDistanceR: signalAreaGuard.priceDistanceR,
                        }
                        : null,
                },
            },
        ];

        // Update externalKey on traces
        const finalTraces: RuntimeLogicTraceDraft[] = traces.map(t => ({
            ...t,
            signalExternalKey: externalKey,
            stateAfter: JSON.stringify({ conditionWindow }),
        }));

        // Clear window after match to prevent duplicate entries on adjacent bars
        const clearedWindow: Record<string, number> = {};

        return {
            state: {
                blockStates: newBlockStates,
                conditionWindow: clearedWindow,
                signalArea: nextSignalArea,
                lastEmittedMatchSignature: currentMatchSignature,
            },
            signal,
            events,
            traces: finalTraces,
        };
    }

    // finalize handles lifecycle management such as break-even, trailing stops, and time-based exits.
    finalize(
        ctx: SignalInitializationContext<Record<string, unknown>> & {
            finalState: ComposedState;
            output: SignalRunOutput;
        },
    ): Partial<SignalRunOutput> | null {
        const profile = resolveComposedExitProfile(ctx.parameters, this.composedDef.exitManagement?.profileCode);
        const additionalEvents: RuntimeSignalEventDraft[] = [];
        const additionalTraces: RuntimeLogicTraceDraft[] = [];
        const results: RuntimeResultDraft[] = [];
        const exitRuleCode = buildExitRuleCode(profile);
        const closedTrades: GuardedTradeSnapshot[] = [];

        for (const signal of ctx.output.signals) {
            if (!signal.externalKey) {
                continue;
            }

            const detectionIndex = ctx.baseBars.findIndex((bar) => bar.time.getTime() === signal.entryTime.getTime());
            if (detectionIndex < 0) {
                continue;
            }

            const entryIndex = ctx.executionConfig.orderTiming === 'NEXT_BAR_OPEN'
                ? detectionIndex + 1
                : detectionIndex;
            if (entryIndex < 0 || entryIndex >= ctx.baseBars.length) {
                continue;
            }

            const side = signal.side;
            const entryBar = ctx.baseBars[entryIndex];
            const entryRawPrice = ctx.executionConfig.orderTiming === 'NEXT_BAR_OPEN'
                ? entryBar.open
                : signal.entryPrice;
            const tradeGuardState = resolveTradeGuardState(
                ctx.executionConfig,
                ctx.riskPercent,
                closedTrades,
                entryBar.time,
                ctx.initialEquity,
            );
            const equityForSizing = ctx.executionConfig.compoundEquity
                ? Math.max(tradeGuardState.currentEquity, ctx.initialEquity * 0.1)
                : ctx.initialEquity;
            const effectiveRiskUsd = (equityForSizing * tradeGuardState.effectiveRiskPercent) / 100;
            signal.executionConfigJson = {
                ...(signal.executionConfigJson ?? {}),
                resolvedRiskPercent: tradeGuardState.effectiveRiskPercent,
                tradeGuards: {
                    baseRiskPercent: round(ctx.riskPercent, 4),
                    effectiveRiskPercent: tradeGuardState.effectiveRiskPercent,
                    rawConsecutiveLosses: tradeGuardState.rawConsecutiveLosses,
                    consecutiveLosses: tradeGuardState.consecutiveLosses,
                    cooldownActiveUntil: tradeGuardState.cooldownActiveUntil?.toISOString() ?? null,
                    sessionLosses: tradeGuardState.sessionLosses,
                    sessionNetR: tradeGuardState.sessionNetR,
                    dayLosses: tradeGuardState.dayLosses,
                    dayNetR: tradeGuardState.dayNetR,
                    blockedReasons: tradeGuardState.blockedReasons,
                    currentEquity: tradeGuardState.currentEquity,
                    equityPeak: tradeGuardState.equityPeak,
                    currentDrawdownPct: tradeGuardState.currentDrawdownPct,
                    equityEma: tradeGuardState.equityEma,
                },
            };

            if (tradeGuardState.blockedReasons.length > 0) {
                const blockedLabel = tradeGuardState.blockedReasons.join(', ');
                signal.notes = appendNote(signal.notes, `blocked:${blockedLabel}`);
                additionalEvents.push(buildManagementEvent({
                    signalExternalKey: signal.externalKey,
                    eventType: SignalEventType.FAIL,
                    candleTime: entryBar.time,
                    price: entryRawPrice,
                    label: 'RISK BLOCK',
                    metaJson: {
                        blockedReasons: tradeGuardState.blockedReasons,
                        effectiveRiskPercent: tradeGuardState.effectiveRiskPercent,
                        consecutiveLosses: tradeGuardState.consecutiveLosses,
                        sessionLosses: tradeGuardState.sessionLosses,
                        sessionNetR: tradeGuardState.sessionNetR,
                        dayLosses: tradeGuardState.dayLosses,
                        dayNetR: tradeGuardState.dayNetR,
                    },
                }));
                additionalTraces.push(buildManagementTrace({
                    signalExternalKey: signal.externalKey,
                    eventType: SignalEventType.FAIL,
                    candleTime: entryBar.time,
                    ruleId: 'entry_blocked_by_trade_guard',
                    notes: `Entry blocked by trade guards: ${blockedLabel}.`,
                    priceJson: {
                        entryPrice: round(entryRawPrice, 4),
                        effectiveRiskPercent: tradeGuardState.effectiveRiskPercent,
                    },
                    thresholdJson: {
                        blockedReasons: tradeGuardState.blockedReasons,
                    },
                }));
                // Phantom trade: advance equity EMA so ECF/DD_HALT can eventually unblock
                const hasEcfOrDdBlock = tradeGuardState.blockedReasons.some(
                    (r) => r.startsWith('equity_curve_filter:') || r.startsWith('max_drawdown_halt:'),
                );
                if (hasEcfOrDdBlock) {
                    closedTrades.push({
                        entryTime: entryBar.time,
                        exitTime: entryBar.time,
                        netR: 0,
                        pnlUsd: 0,
                    });
                }
                continue;
            }

            if (tradeGuardState.effectiveRiskPercent < ctx.riskPercent) {
                signal.notes = appendNote(signal.notes, `risk:${tradeGuardState.effectiveRiskPercent}%`);
                additionalEvents.push(buildManagementEvent({
                    signalExternalKey: signal.externalKey,
                    eventType: SignalEventType.ENTRY_CONFIRMED,
                    candleTime: entryBar.time,
                    price: entryRawPrice,
                    label: `RISK ${tradeGuardState.effectiveRiskPercent}%`,
                    metaJson: {
                        baseRiskPercent: round(ctx.riskPercent, 4),
                        effectiveRiskPercent: tradeGuardState.effectiveRiskPercent,
                        consecutiveLosses: tradeGuardState.consecutiveLosses,
                    },
                }));
                additionalTraces.push(buildManagementTrace({
                    signalExternalKey: signal.externalKey,
                    eventType: SignalEventType.ENTRY_CONFIRMED,
                    candleTime: entryBar.time,
                    ruleId: 'loss_streak_risk_throttle',
                    notes: `Risk was throttled to ${tradeGuardState.effectiveRiskPercent}% after ${tradeGuardState.consecutiveLosses} consecutive losses.`,
                    priceJson: {
                        entryPrice: round(entryRawPrice, 4),
                        effectiveRiskPercent: tradeGuardState.effectiveRiskPercent,
                    },
                    thresholdJson: {
                        consecutiveLosses: tradeGuardState.consecutiveLosses,
                    },
                }));
            }
            const preResolvedSizing = ctx.executionConfig.positionSizing.mode === 'RISK_BASED'
                ? null
                : ctx.services.executionModel.resolvePositionSizing({
                    side,
                    entryPrice: entryRawPrice,
                    stopLossPrice: signal.stopLoss,
                    initialEquity: equityForSizing,
                    riskAmountUsd: effectiveRiskUsd,
                    config: ctx.executionConfig,
                });
            const resolvedStopLoss = ctx.services.executionModel.resolveStopLoss({
                side,
                entryPrice: entryRawPrice,
                signalStopLossPrice: signal.stopLoss,
                initialEquity: equityForSizing,
                positionQuantity: preResolvedSizing?.quantity ?? null,
                config: ctx.executionConfig,
            });
            const positionSizing = preResolvedSizing || ctx.services.executionModel.resolvePositionSizing({
                side,
                entryPrice: entryRawPrice,
                stopLossPrice: resolvedStopLoss.stopLossPrice,
                initialEquity: equityForSizing,
                riskAmountUsd: resolvedStopLoss.configuredRiskAmountUsd ?? effectiveRiskUsd,
                config: ctx.executionConfig,
            });
            const totalRiskAmountUsd = Math.max(
                resolvedStopLoss.configuredRiskAmountUsd
                    ?? Math.abs(ctx.services.executionModel.calculateNetPnl({
                        side,
                        entryPrice: entryRawPrice,
                        exitPrice: resolvedStopLoss.stopLossPrice,
                        quantity: positionSizing.quantity,
                        config: ctx.executionConfig,
                    }).netPnlUsd),
                0.01,
            );
            const riskDistance = Math.abs(entryRawPrice - resolvedStopLoss.stopLossPrice);
            if (riskDistance <= 0) {
                continue;
            }

            const signalTarget = signal.takeProfit1 ?? null;
            // Trailing stages tighten the stop; they must not suppress a signal-defined TP.
            const targetPrice = profile.targetR === null
                ? signalTarget
                : buildTargetPriceFromR(side, entryRawPrice, riskDistance, profile.targetR);
            const breakEvenTriggerPrice = profile.breakEvenAtR === null
                ? null
                : buildTargetPriceFromR(side, entryRawPrice, riskDistance, profile.breakEvenAtR);
            const partialTargetPrice = profile.partialAtR === null
                ? null
                : buildTargetPriceFromR(side, entryRawPrice, riskDistance, profile.partialAtR);
            const lastIndex = profile.maxBarsInTrade === null
                ? ctx.baseBars.length - 1
                : Math.min(ctx.baseBars.length - 1, entryIndex + profile.maxBarsInTrade - 1);

            let activeStop = resolvedStopLoss.stopLossPrice;
            let movedToBreakeven = false;
            let partialTaken = false;
            let remainingFraction = 1;
            let weightedExitPrice = 0;
            let realizedNetR = 0;
            let realizedPnlUsd = 0;
            let maxDrawdownPct = 0;
            let exitTime: Date | null = null;
            let finalExitReason: ExitReason = ExitReason.EXPIRATION;
            let hasTrailingStop = false;
            const triggeredTrailStages = new Set<number>();
            const notes: string[] = [profile.name, `risk:${tradeGuardState.effectiveRiskPercent}%`];
            if (tradeGuardState.consecutiveLosses > 0) {
                notes.push(`streak:${tradeGuardState.consecutiveLosses}L`);
            }

            const realizeExit = (price: number, closeFraction: number) => {
                const closedBefore = 1 - remainingFraction;
                const metrics = ctx.services.executionModel.calculateNetR({
                    side,
                    entryPrice: entryRawPrice,
                    exitPrice: price,
                    stopLoss: resolvedStopLoss.stopLossPrice,
                    quantity: positionSizing.quantity * closeFraction,
                    riskAmountUsd: totalRiskAmountUsd,
                    config: ctx.executionConfig,
                });

                realizedNetR += metrics.netR;
                realizedPnlUsd += metrics.netPnlUsd;
                weightedExitPrice += price * closeFraction;
                return weightedExitPrice / Math.max(closedBefore + closeFraction, closeFraction);
            };

            let finalExitPrice: number | null = null;
            const dlCollector = new DecisionLogCollector();
            const dlSnapshot = () => ({
                activeStop, remainingFraction, realizedNetR,
                movedToBreakeven, partialTaken, maxDrawdownPct,
            });

            for (let index = entryIndex; index <= lastIndex && remainingFraction > 0; index += 1) {
                const bar = ctx.baseBars[index];
                maxDrawdownPct = Math.min(
                    maxDrawdownPct,
                    getUnfavorableMovePct(bar, side, entryRawPrice),
                );

                dlCollector.startBar(index, bar.time, {
                    open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume ?? 0,
                }, {
                    activeStop, remainingFraction, realizedNetR,
                    movedToBreakeven, partialTaken, maxDrawdownPct,
                });

                const slHit = barHitsStop(bar, side, activeStop);
                dlCollector.recordCondition('SL', slHit);
                if (slHit) {
                    finalExitPrice = realizeExit(activeStop, remainingFraction);
                    remainingFraction = 0;
                    exitTime = bar.time;
                    finalExitReason = hasTrailingStop
                        ? ExitReason.TRAILING_STOP
                        : movedToBreakeven && round(activeStop, 4) === round(entryRawPrice, 4)
                            ? ExitReason.BREAK_EVEN
                            : ExitReason.STOP_LOSS;

                    additionalEvents.push(buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.STOP_HIT,
                        candleTime: bar.time,
                        price: activeStop,
                        label: finalExitReason === ExitReason.BREAK_EVEN
                            ? 'BE EXIT'
                            : finalExitReason === ExitReason.TRAILING_STOP
                                ? 'TRAIL STOP'
                                : 'STOP',
                        metaJson: { stopPrice: round(activeStop, 4) },
                    }));
                    additionalTraces.push(buildManagementTrace({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.STOP_HIT,
                        candleTime: bar.time,
                        ruleId: finalExitReason === ExitReason.BREAK_EVEN
                            ? 'breakeven_stop_hit'
                            : finalExitReason === ExitReason.TRAILING_STOP
                                ? 'trailing_stop_hit'
                                : 'stop_hit',
                        notes: finalExitReason === ExitReason.BREAK_EVEN
                            ? 'Position closed at break-even.'
                            : finalExitReason === ExitReason.TRAILING_STOP
                                ? 'Position closed by trailing stop.'
                                : 'Position closed at stop loss.',
                        priceJson: {
                            stopPrice: round(activeStop, 4),
                            remainingFraction: 0,
                        },
                    }));
                    dlCollector.endBar('CLOSE', dlSnapshot());
                    break;
                }

                const partialHit = !partialTaken && partialTargetPrice !== null && barHitsTarget(bar, side, partialTargetPrice);
                dlCollector.recordCondition('PARTIAL', partialHit, partialTaken || partialTargetPrice === null);
                if (partialHit) {
                    const closeFraction = Math.min(remainingFraction, profile.partialCloseFraction);
                    if (closeFraction > 0) {
                        finalExitPrice = realizeExit(partialTargetPrice, closeFraction);
                        remainingFraction -= closeFraction;
                        partialTaken = true;
                        notes.push(`partial:${round(closeFraction * 100, 2)}%@1R`);

                        additionalEvents.push(buildManagementEvent({
                            signalExternalKey: signal.externalKey,
                            eventType: SignalEventType.TP1_HIT,
                            candleTime: bar.time,
                            price: partialTargetPrice,
                            label: 'PARTIAL',
                            metaJson: {
                                closeFraction: round(closeFraction, 4),
                                remainingFraction: round(remainingFraction, 4),
                            },
                        }));
                        additionalTraces.push(buildManagementTrace({
                            signalExternalKey: signal.externalKey,
                            eventType: SignalEventType.TP1_HIT,
                            candleTime: bar.time,
                            ruleId: 'partial_take_profit',
                            notes: 'Partial take profit was executed.',
                            priceJson: {
                                targetPrice: round(partialTargetPrice, 4),
                                closeFraction: round(closeFraction, 4),
                                remainingFraction: round(remainingFraction, 4),
                            },
                        }));
                    }
                }

                const beHit = !movedToBreakeven && breakEvenTriggerPrice !== null && barHitsTarget(bar, side, breakEvenTriggerPrice);
                dlCollector.recordCondition('BE', beHit, movedToBreakeven || breakEvenTriggerPrice === null);
                if (beHit) {
                    movedToBreakeven = true;
                    activeStop = entryRawPrice;
                    notes.push('be:armed');

                    additionalEvents.push(buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.MOVE_SL_BE,
                        candleTime: bar.time,
                        price: activeStop,
                        label: 'BE',
                        metaJson: {
                            triggerPrice: round(breakEvenTriggerPrice, 4),
                            stopPrice: round(activeStop, 4),
                        },
                    }));
                    additionalTraces.push(buildManagementTrace({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.MOVE_SL_BE,
                        candleTime: bar.time,
                        ruleId: 'move_stop_to_breakeven',
                        notes: 'Stop loss was moved to break-even.',
                        priceJson: {
                            triggerPrice: round(breakEvenTriggerPrice, 4),
                            stopPrice: round(activeStop, 4),
                        },
                    }));
                }

                let anyTrailTriggered = false;
                for (let trailIndex = 0; trailIndex < profile.trailStages.length; trailIndex += 1) {
                    if (triggeredTrailStages.has(trailIndex)) {
                        continue;
                    }

                    const stage = profile.trailStages[trailIndex];
                    const triggerPrice = buildTargetPriceFromR(side, entryRawPrice, riskDistance, stage.triggerR);
                    if (!barHitsTarget(bar, side, triggerPrice)) {
                        continue;
                    }

                    const nextStop = tightenStopFromR(
                        side,
                        entryRawPrice,
                        riskDistance,
                        activeStop,
                        stage.stopToR,
                    );

                    triggeredTrailStages.add(trailIndex);
                    anyTrailTriggered = true;
                    if (round(nextStop, 6) === round(activeStop, 6)) {
                        continue;
                    }

                    activeStop = nextStop;
                    hasTrailingStop = true;
                    notes.push(`trail:${stage.triggerR}R->${stage.stopToR}R`);

                    additionalEvents.push(buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: trailIndex === 0 ? SignalEventType.TRAIL_START : SignalEventType.TRAIL_UPDATE,
                        candleTime: bar.time,
                        price: activeStop,
                        label: `TRAIL ${stage.triggerR}R`,
                        metaJson: {
                            triggerR: stage.triggerR,
                            stopToR: stage.stopToR,
                            triggerPrice: round(triggerPrice, 4),
                            stopPrice: round(activeStop, 4),
                        },
                    }));
                    additionalTraces.push(buildManagementTrace({
                        signalExternalKey: signal.externalKey,
                        eventType: trailIndex === 0 ? SignalEventType.TRAIL_START : SignalEventType.TRAIL_UPDATE,
                        candleTime: bar.time,
                        ruleId: `trail_stop_${stage.triggerR}r_to_${stage.stopToR}r`,
                        notes: `Trailing stop tightened after ${stage.triggerR}R progress, locking ${stage.stopToR}R.`,
                        priceJson: {
                            triggerPrice: round(triggerPrice, 4),
                            stopPrice: round(activeStop, 4),
                            triggerR: stage.triggerR,
                            stopToR: stage.stopToR,
                        },
                    }));
                }
                dlCollector.recordCondition('TRAIL', anyTrailTriggered, profile.trailStages.length === 0);

                if (profile.trailByStructureLookback && movedToBreakeven && index > entryIndex) {
                    const lookback = profile.trailByStructureLookback;
                    const start = Math.max(0, index - lookback);
                    const slice = ctx.baseBars.slice(start, index);
                    
                    let structureStop = activeStop;
                    if (side === PositionSide.LONG) {
                        const lowest = Math.min(...slice.map(b => b.low));
                        structureStop = Math.max(activeStop, lowest);
                    } else {
                        const highest = Math.max(...slice.map(b => b.high));
                        structureStop = Math.min(activeStop, highest);
                    }

                    if (round(structureStop, 6) !== round(activeStop, 6)) {
                        activeStop = structureStop;
                        hasTrailingStop = true;
                        notes.push(`trail:swing:${lookback}`);
                        additionalEvents.push(buildManagementEvent({
                            signalExternalKey: signal.externalKey,
                            eventType: SignalEventType.TRAIL_UPDATE,
                            candleTime: bar.time,
                            price: activeStop,
                            label: 'SWING TRAIL',
                            metaJson: { stopPrice: round(activeStop, 4), lookback },
                        }));
                        additionalTraces.push(buildManagementTrace({
                            signalExternalKey: signal.externalKey,
                            eventType: SignalEventType.TRAIL_UPDATE,
                            candleTime: bar.time,
                            ruleId: `swing_trailing_stop_${lookback}`,
                            notes: `Swing trailing stop tightened using the prior ${lookback} bars.`,
                            priceJson: {
                                stopPrice: round(activeStop, 4),
                                lookback,
                            },
                        }));
                    }
                    dlCollector.recordCondition('SWING_TRAIL', true);
                } else {
                    dlCollector.recordCondition('SWING_TRAIL', false, !profile.trailByStructureLookback || !movedToBreakeven);
                }

                const tpHit = remainingFraction > 0 && targetPrice !== null && barHitsTarget(bar, side, targetPrice);
                dlCollector.recordCondition('TP', tpHit, remainingFraction <= 0 || targetPrice === null);
                if (tpHit) {
                    finalExitPrice = realizeExit(targetPrice!, remainingFraction);
                    remainingFraction = 0;
                    exitTime = bar.time;
                    finalExitReason = partialTaken ? ExitReason.TAKE_PROFIT_2 : ExitReason.TAKE_PROFIT_1;

                    additionalEvents.push(buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: partialTaken ? SignalEventType.TP2_HIT : SignalEventType.TP1_HIT,
                        candleTime: bar.time,
                        price: targetPrice,
                        label: partialTaken ? 'TP2' : 'TP1',
                        metaJson: { targetPrice: round(targetPrice, 4) },
                    }));
                    additionalTraces.push(buildManagementTrace({
                        signalExternalKey: signal.externalKey,
                        eventType: partialTaken ? SignalEventType.TP2_HIT : SignalEventType.TP1_HIT,
                        candleTime: bar.time,
                        ruleId: partialTaken ? 'final_take_profit' : 'take_profit',
                        notes: 'Position closed at take profit.',
                        priceJson: {
                            targetPrice: round(targetPrice!, 4),
                            remainingFraction: 0,
                        },
                    }));
                    dlCollector.endBar('CLOSE', dlSnapshot());
                    break;
                }

                if (profile.exitAtNyClose && remainingFraction > 0) {
                    const hour = bar.time.getUTCHours();
                    const nyCloseHit = hour >= 21;
                    dlCollector.recordCondition('NY_CLOSE', nyCloseHit, !profile.exitAtNyClose);
                    if (nyCloseHit) {
                        finalExitPrice = realizeExit(bar.close, remainingFraction);
                        remainingFraction = 0;
                        exitTime = bar.time;
                        finalExitReason = ExitReason.EXPIRATION;

                        additionalEvents.push(buildManagementEvent({
                            signalExternalKey: signal.externalKey,
                            eventType: SignalEventType.EXPIRATION,
                            candleTime: bar.time,
                            price: bar.close,
                            label: 'NY CLOSE',
                            metaJson: { exitPrice: round(bar.close, 4) },
                        }));
                        additionalTraces.push(buildManagementTrace({
                            signalExternalKey: signal.externalKey,
                            eventType: SignalEventType.EXPIRATION,
                            candleTime: bar.time,
                            ruleId: 'ny_session_close',
                            notes: 'Position closed at NY end (21:00 UTC).',
                            priceJson: { exitPrice: round(bar.close, 4) },
                        }));
                        dlCollector.endBar('CLOSE', dlSnapshot());
                        break;
                    }
                } else {
                    dlCollector.recordCondition('NY_CLOSE', false, !profile.exitAtNyClose);
                }

                const timeStopHit = profile.maxBarsInTrade !== null && index === lastIndex && remainingFraction > 0;
                dlCollector.recordCondition('TIME_STOP', timeStopHit, profile.maxBarsInTrade === null);
                if (timeStopHit) {
                    finalExitPrice = realizeExit(bar.close, remainingFraction);
                    remainingFraction = 0;
                    exitTime = bar.time;
                    finalExitReason = ExitReason.EXPIRATION;

                    additionalEvents.push(buildManagementEvent({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.EXPIRATION,
                        candleTime: bar.time,
                        price: bar.close,
                        label: 'TIME',
                        metaJson: {
                            maxBarsInTrade: profile.maxBarsInTrade,
                            exitPrice: round(bar.close, 4),
                        },
                    }));
                    additionalTraces.push(buildManagementTrace({
                        signalExternalKey: signal.externalKey,
                        eventType: SignalEventType.EXPIRATION,
                        candleTime: bar.time,
                        ruleId: 'time_stop',
                        notes: 'Position force-closed by time stop.',
                        priceJson: {
                            exitPrice: round(bar.close, 4),
                            maxBarsInTrade: profile.maxBarsInTrade,
                        },
                    }));
                    dlCollector.endBar('CLOSE', dlSnapshot());
                }

                // End bar with the most significant action if not already ended by a break/close above.
                // Priority: PARTIAL_CLOSE > MOVE_SL > HOLD. When partial + BE both fire on the
                // same bar, PARTIAL_CLOSE wins because it changes position size. The BE state change
                // is visible in the next bar's stateSnapshot (movedToBreakeven: true).
                if (partialHit && !slHit && !tpHit) {
                    dlCollector.endBar('PARTIAL_CLOSE', dlSnapshot());
                } else if ((beHit || anyTrailTriggered) && !slHit && !tpHit && !timeStopHit) {
                    dlCollector.endBar('MOVE_SL', dlSnapshot());
                } else if (!slHit && !tpHit && !timeStopHit) {
                    dlCollector.endBar('HOLD', dlSnapshot());
                }
            }

            if (!exitTime && remainingFraction > 0) {
                // Skip force-close: trades that never hit a real exit (SL/TP/trailing)
                // should not be counted as realized results.
                continue;
            }

            if (!exitTime || finalExitPrice === null) {
                continue;
            }

            results.push({
                signalExternalKey: signal.externalKey,
                exitRuleCode,
                exitRuleName: profile.name,
                exitRuleConfigJson: {
                    profileCode: profile.code,
                    description: profile.description,
                    targetR: profile.targetR,
                    breakEvenAtR: profile.breakEvenAtR,
                    partialAtR: profile.partialAtR,
                    partialCloseFraction: profile.partialCloseFraction,
                    trailStages: profile.trailStages.map((stage) => ({
                        triggerR: stage.triggerR,
                        stopToR: stage.stopToR,
                    })),
                    maxBarsInTrade: profile.maxBarsInTrade,
                    trailByStructureLookback: profile.trailByStructureLookback ?? null,
                    exitAtNyClose: profile.exitAtNyClose ?? false,
                },
                resultSide: side,
                session: signal.session || resolveSession(exitTime),
                win: realizedNetR > 0,
                isOpen: false,
                rMultiple: round(realizedNetR),
                pnlUsd: roundMoney(realizedPnlUsd),
                maxDrawdownPct: round(maxDrawdownPct, 4),
                exitReason: finalExitReason,
                exitTime,
                exitPrice: round(finalExitPrice, 4),
                notes: notes.join(' | '),
                decisionLog: compressDecisionLog(dlCollector.getLog()),
            });
            closedTrades.push({
                entryTime: entryBar.time,
                exitTime,
                netR: round(realizedNetR),
                pnlUsd: roundMoney(realizedPnlUsd),
            });
        }

        return {
            events: additionalEvents,
            traces: additionalTraces,
            results,
        };
    }
}
