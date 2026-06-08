import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { SignalBacktestExecutionService } from '../services/signals/SignalBacktestExecutionService';
import { SignalBacktestRunService } from '../services/signals/SignalBacktestRunService';
import { createDefaultBlockRegistry } from '../services/signals/blocks/createDefaultBlockRegistry';
import { ExecutionConfigInput, TradeGuardConfigInput } from '../services/signals/types';
import { upsertTier1ComposedSignals } from '../services/signals/tier1ComposedSignals';

dotenv.config();

export const XAU_SYMBOL = 'XAUUSD';
export const FULL_RANGE_FROM = '2019-01-01T00:00:00.000Z';
export const FULL_RANGE_TO = '2026-03-14T23:59:59.999Z';
export const INITIAL_EQUITY = 10_000;
export const DEFAULT_RISK_PERCENT = 1.5;

export const BASE_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

export const LOOSE_GUARDS: TradeGuardConfigInput = {
    lossStreakCooldown: { afterLosses: 4, cooldownMinutes: 360 },
    dayLossCap: { maxLosses: 4, maxNetR: 4 },
    equityCurveFilter: { emaTrades: 25, action: 'HALF_RISK' },
    maxDrawdownHalt: { maxDrawdownPct: 12 },
    minTradeSpacing: { minSpacingMinutes: 60 },
};

export interface DiagnosticSpec {
    slug: string;
    label: string;
    signalCode: string;
    signalVersion: number;
    timeframe: string;
    from: string;
    to: string;
    executionConfig: ExecutionConfigInput;
    riskPercent?: number;
    notes: string;
    parameters?: Record<string, unknown>;
}

export interface DiagnosticMetrics {
    runId: string;
    trades: number;
    winRate: number;
    profitFactor: number | null;
    netPnl: number;
    equityDD: number;
    avgR: number;
    expectancy: number;
    maxConsecutiveLosses: number;
}

export function withGuards(guards: TradeGuardConfigInput): ExecutionConfigInput {
    return {
        ...BASE_EXECUTION_CONFIG,
        tradeGuards: guards,
    };
}

export function computeMetrics(rows: Array<{ pnlUsd: number; rMultiple: number; win: boolean; isOpen: boolean }>): Omit<DiagnosticMetrics, 'runId'> {
    const closed = rows.filter((row) => !row.isOpen);

    if (closed.length === 0) {
        return {
            trades: 0,
            winRate: 0,
            profitFactor: null,
            netPnl: 0,
            equityDD: 0,
            avgR: 0,
            expectancy: 0,
            maxConsecutiveLosses: 0,
        };
    }

    const wins = closed.filter((row) => row.win).length;
    const netPnl = closed.reduce((sum, row) => sum + row.pnlUsd, 0);
    const grossWins = closed.filter((row) => row.win).reduce((sum, row) => sum + row.pnlUsd, 0);
    const grossLosses = Math.abs(closed.filter((row) => !row.win).reduce((sum, row) => sum + row.pnlUsd, 0));
    const profitFactor = grossLosses > 0
        ? Math.round((grossWins / grossLosses) * 100) / 100
        : (grossWins > 0 ? 999 : null);

    let equity = INITIAL_EQUITY;
    let peak = INITIAL_EQUITY;
    let maxDd = 0;
    let currentLossStreak = 0;
    let maxLossStreak = 0;

    for (const row of closed) {
        equity += row.pnlUsd;
        if (equity > peak) {
            peak = equity;
        }
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDd) {
            maxDd = dd;
        }

        if (row.win) {
            currentLossStreak = 0;
        } else {
            currentLossStreak += 1;
            if (currentLossStreak > maxLossStreak) {
                maxLossStreak = currentLossStreak;
            }
        }
    }

    const avgR = closed.reduce((sum, row) => sum + row.rMultiple, 0) / closed.length;

    return {
        trades: closed.length,
        winRate: Math.round((wins / closed.length) * 10000) / 100,
        profitFactor,
        netPnl: Math.round(netPnl * 100) / 100,
        equityDD: Math.round(maxDd * 10000) / 10000,
        avgR: Math.round(avgR * 10000) / 10000,
        expectancy: Math.round((netPnl / closed.length) * 100) / 100,
        maxConsecutiveLosses: maxLossStreak,
    };
}

export async function ensureTier1Signals(prisma: PrismaClient): Promise<void> {
    const blockRegistry = createDefaultBlockRegistry();
    await upsertTier1ComposedSignals(prisma, blockRegistry);
}

export async function executeDiagnosticSpec(
    prisma: PrismaClient,
    backtests: SignalBacktestRunService,
    execution: SignalBacktestExecutionService,
    spec: DiagnosticSpec,
): Promise<DiagnosticMetrics> {
    const created = await backtests.createGeneratedBacktest({
        signalCode: spec.signalCode,
        signalVersion: spec.signalVersion,
        symbol: XAU_SYMBOL,
        timeframe: spec.timeframe,
        dateRange: { from: spec.from, to: spec.to },
        executionConfig: spec.executionConfig,
        initialEquity: INITIAL_EQUITY,
        riskPercent: spec.riskPercent ?? DEFAULT_RISK_PERCENT,
        notes: spec.notes,
        parameters: spec.parameters ?? {},
    });

    await execution.executeRun(created.backtestRunId);

    const rows = await prisma.backtestTradeResult.findMany({
        where: { backtestRunId: created.backtestRunId },
        select: {
            pnlUsd: true,
            rMultiple: true,
            win: true,
            isOpen: true,
        },
        orderBy: { exitTime: 'asc' },
    });

    const normalizedRows = rows.map((row) => ({
        pnlUsd: Number(row.pnlUsd),
        rMultiple: Number(row.rMultiple),
        win: row.win,
        isOpen: row.isOpen,
    }));

    return {
        runId: created.backtestRunId,
        ...computeMetrics(normalizedRows),
    };
}

export function resolvePriorityArtifactDir(): string {
    const baseDir = process.env.XAU_PRIORITY_ARTIFACT_DIR
        ? path.resolve(process.env.XAU_PRIORITY_ARTIFACT_DIR)
        : path.resolve('.artifacts', 'priority-backtests');

    fs.mkdirSync(baseDir, { recursive: true });
    return baseDir;
}

export function writeArtifactPair(baseDir: string, fileStem: string, payload: unknown, markdown: string): { jsonPath: string; markdownPath: string } {
    const jsonPath = path.join(baseDir, `${fileStem}.json`);
    const markdownPath = path.join(baseDir, `${fileStem}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    fs.writeFileSync(markdownPath, markdown);

    return { jsonPath, markdownPath };
}
