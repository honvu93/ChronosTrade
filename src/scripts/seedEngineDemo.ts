import { ExitReason, PositionSide, PrismaClient, TradingSession } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const baseTime = new Date('2026-02-16T01:00:00.000Z');

async function seed() {
    const existingRun = await prisma.backtestRun.findFirst({
        where: { name: 'Engine Demo Run' },
    });

    if (existingRun) {
        console.log(`Engine demo data already exists: ${existingRun.id}`);
        return;
    }

    const trap = await prisma.strategy.upsert({
        where: { code: 'TRAP' },
        update: {},
        create: {
            code: 'TRAP',
            name: 'TRAP',
            description: 'Mean reversion setup for intraday reversals.',
        },
    });

    const curlMf = await prisma.strategy.upsert({
        where: { code: 'CURL_MF' },
        update: {},
        create: {
            code: 'CURL_MF',
            name: 'CURL_MF',
            description: 'Momentum continuation setup with market structure bias.',
        },
    });

    const exitRules = await Promise.all([
        prisma.exitRule.upsert({
            where: { code: 'SL_TP1' },
            update: {},
            create: {
                code: 'SL_TP1',
                name: 'SL -> TP1',
                description: 'Hard stop loss with fixed first target.',
                configJson: { tp: 1 },
            },
        }),
        prisma.exitRule.upsert({
            where: { code: 'SL_TP2' },
            update: {},
            create: {
                code: 'SL_TP2',
                name: 'SL -> TP2',
                description: 'Hard stop loss with fixed second target.',
                configJson: { tp: 2 },
            },
        }),
        prisma.exitRule.upsert({
            where: { code: 'TP1_TRAIL' },
            update: {},
            create: {
                code: 'TP1_TRAIL',
                name: 'TP1 Trail',
                description: 'Take partial at TP1 and trail the remainder.',
                configJson: { tp: 1, trailing: true },
            },
        }),
    ]);

    const run = await prisma.backtestRun.create({
        data: {
            name: 'Engine Demo Run',
            symbol: 'BTCUSD',
            timeframe: '1h',
            strategyId: curlMf.id,
            side: PositionSide.LONG,
            initialEquity: 10000,
            riskPercent: 2,
            notes: 'Synthetic data for the Engine workspace.',
            startedAt: baseTime,
            finishedAt: new Date(baseTime.getTime() + 14 * 24 * 60 * 60 * 1000),
        },
    });

    const signalSpecs = [
        { strategyId: trap.id, side: PositionSide.LONG, session: TradingSession.ASIAN, entryPrice: 62150, stopLoss: 61750, tp1: 62550, tp2: 62950 },
        { strategyId: curlMf.id, side: PositionSide.LONG, session: TradingSession.LONDON, entryPrice: 62840, stopLoss: 62450, tp1: 63280, tp2: 63610 },
        { strategyId: curlMf.id, side: PositionSide.SHORT, session: TradingSession.NY, entryPrice: 63420, stopLoss: 63810, tp1: 63010, tp2: 62680 },
        { strategyId: trap.id, side: PositionSide.LONG, session: TradingSession.ASIAN, entryPrice: 64010, stopLoss: 63640, tp1: 64420, tp2: 64860 },
        { strategyId: curlMf.id, side: PositionSide.LONG, session: TradingSession.NY, entryPrice: 64750, stopLoss: 64390, tp1: 65110, tp2: 65580 },
        { strategyId: trap.id, side: PositionSide.SHORT, session: TradingSession.LONDON, entryPrice: 65380, stopLoss: 65730, tp1: 65020, tp2: 64610 },
    ];

    const ruleTemplates: Record<string, { rMultiple: number; pnlUsd: number; maxDrawdownPct: number; win: boolean; isOpen?: boolean; exitReason: ExitReason }> = {
        SL_TP1: { rMultiple: 1.0, pnlUsd: 200, maxDrawdownPct: -3.8, win: true, exitReason: ExitReason.TAKE_PROFIT_1 },
        SL_TP2: { rMultiple: 1.8, pnlUsd: 360, maxDrawdownPct: -5.2, win: true, exitReason: ExitReason.TAKE_PROFIT_2 },
        TP1_TRAIL: { rMultiple: 1.35, pnlUsd: 270, maxDrawdownPct: -4.6, win: true, exitReason: ExitReason.TRAILING_STOP },
    };

    const lossOverrides = new Map<number, Partial<typeof ruleTemplates.SL_TP1>>([
        [2, { rMultiple: -1, pnlUsd: -200, maxDrawdownPct: -6.4, win: false, exitReason: ExitReason.STOP_LOSS }],
        [5, { rMultiple: -1, pnlUsd: -200, maxDrawdownPct: -5.8, win: false, exitReason: ExitReason.STOP_LOSS }],
    ]);

    const openOverrideIndex = 4;

    for (const [index, spec] of signalSpecs.entries()) {
        const entryTime = new Date(baseTime.getTime() + index * 18 * 60 * 60 * 1000);
        const signal = await prisma.signal.create({
            data: {
                symbol: 'BTCUSD',
                timeframe: '1h',
                side: spec.side,
                strategyId: spec.strategyId,
                session: spec.session,
                entryTime,
                entryPrice: spec.entryPrice,
                stopLoss: spec.stopLoss,
                takeProfit1: spec.tp1,
                takeProfit2: spec.tp2,
                notes: `Demo signal ${index + 1}`,
            },
        });

        for (const exitRule of exitRules) {
            const template = { ...ruleTemplates[exitRule.code] };
            if (lossOverrides.has(index) && exitRule.code !== 'TP1_TRAIL') {
                Object.assign(template, lossOverrides.get(index));
            }
            if (index === openOverrideIndex && exitRule.code === 'TP1_TRAIL') {
                template.rMultiple = 0.42;
                template.pnlUsd = 84;
                template.maxDrawdownPct = -2.1;
                template.win = false;
                template.isOpen = true;
                template.exitReason = ExitReason.OPEN;
            }

            const exitTime = template.isOpen ? null : new Date(entryTime.getTime() + (8 + index) * 60 * 60 * 1000);
            const exitPrice = template.isOpen
                ? null
                : spec.side === PositionSide.LONG
                    ? spec.entryPrice + template.rMultiple * Math.abs(spec.entryPrice - spec.stopLoss)
                    : spec.entryPrice - template.rMultiple * Math.abs(spec.entryPrice - spec.stopLoss);

            await prisma.backtestTradeResult.create({
                data: {
                    backtestRunId: run.id,
                    signalId: signal.id,
                    exitRuleId: exitRule.id,
                    resultSide: spec.side,
                    session: spec.session,
                    win: template.win,
                    isOpen: Boolean(template.isOpen),
                    rMultiple: template.rMultiple,
                    pnlUsd: template.pnlUsd,
                    maxDrawdownPct: template.maxDrawdownPct,
                    exitReason: template.exitReason,
                    exitTime,
                    exitPrice,
                    notes: `${exitRule.name} result for demo signal ${index + 1}`,
                },
            });
        }
    }

    console.log(`Engine demo data created for run ${run.id}`);
}

seed()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
