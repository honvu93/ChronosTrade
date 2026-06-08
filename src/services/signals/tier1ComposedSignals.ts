import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { ComposedSignalDefinition } from './ComposedSignalPlugin';
import { validateComposedSignalDefinition } from './composedSignalValidation';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';

const SYSTEM_ACTOR = 'system:tier1-composed-signals';

type PersistedComposedSignalDefinition = ComposedSignalDefinition & {
    symbol?: string;
    timeframe?: string;
};

interface Tier1ComposedSignalSeed {
    code: string;
    version: number;
    name: string;
    category: string;
    description: string;
    composedBlocks: PersistedComposedSignalDefinition;
}

interface UpsertTier1ComposedSignalsResult {
    created: number;
    updated: number;
    skipped: string[];
}

const makeKey = (code: string, version: number) => `${code.toUpperCase()}@${version}`;

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const buildStableId = (input: string) => createHash('sha1')
    .update(input)
    .digest('hex')
    .slice(0, 12);

const regimeBullish = () => ({
    id: `regime_bull_${buildStableId('regime_bull')}`,
    indicatorId: 'MARKET_REGIME',
    conditionId: 'regime_trending_bullish',
    indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 },
    conditionParams: { adxThreshold: 25 },
});

const regimeBearish = () => ({
    id: `regime_bear_${buildStableId('regime_bear')}`,
    indicatorId: 'MARKET_REGIME',
    conditionId: 'regime_trending_bearish',
    indicatorParams: { adxPeriod: 14, atrPeriod: 14, emaFilterPeriod: 200 },
    conditionParams: { adxThreshold: 25 },
});

const emaPriceBelow = () => ({
    id: `ema_below_${buildStableId('ema_below')}`,
    indicatorId: 'EMA_CROSS',
    conditionId: 'price_below_ema',
    indicatorParams: { fastPeriod: 21, slowPeriod: 55 },
    conditionParams: {},
});

const rsiCrossAboveEma = () => ({
    id: `rsi_cross_up_${buildStableId('rsi_cross_up')}`,
    indicatorId: 'RSI',
    conditionId: 'crosses_above_ema',
    indicatorParams: { period: 14 },
    conditionParams: { emaPeriod: 9 },
});

const rsiCrossBelow50 = () => ({
    id: `rsi_cross_down_${buildStableId('rsi_cross_down')}`,
    indicatorId: 'RSI',
    conditionId: 'crosses_below',
    indicatorParams: { period: 14 },
    conditionParams: { threshold: 50 },
});

const bullishOrderBlock = () => ({
    id: `bullish_ob_${buildStableId('bullish_ob')}`,
    indicatorId: 'SMC',
    conditionId: 'price_in_bullish_ob',
    indicatorParams: { swingStrength: 3, lookback: 60 },
    conditionParams: {},
});

const fibGoldenZone = () => ({
    id: `fib_golden_zone_${buildStableId('fib_golden_zone')}`,
    indicatorId: 'FIBONACCI',
    conditionId: 'price_in_golden_zone',
    indicatorParams: { swingStrength: 3, lookback: 60, tolerance: 0.3 },
    conditionParams: {},
});

const buildTier1Seeds = (): Tier1ComposedSignalSeed[] => ([
    {
        code: 'SYS_T1_SAMPLE_OB_FIB_LONG',
        version: 1,
        name: 'Sample OB Fib Long',
        category: 'sample_confluence',
        description: 'A generic sample strategy combining Order Block and Fibonacci zone.',
        composedBlocks: {
            symbol: 'XAUUSD',
            timeframe: 'H1',
            matchMode: 'ALL',
            windowBars: 6,
            side: 'LONG',
            blocks: [
                regimeBullish(),
                bullishOrderBlock(),
                fibGoldenZone(),
                rsiCrossAboveEma(),
            ],
            stopLoss: { type: 'BELOW_STRUCTURE', value: 0.0015, lookback: 24 },
            takeProfit: { type: 'R_MULTIPLE', value: 3 },
            exitManagement: { profileCode: 'PARTIAL_1R_BE_R3' },
        },
    },
    {
        code: 'SYS_T1_SAMPLE_TREND_PULLBACK_SHORT',
        version: 1,
        name: 'Sample Trend Pullback Short',
        category: 'sample_trend_pullback',
        description: 'A generic sample strategy capturing trend pullback.',
        composedBlocks: {
            symbol: 'BTCUSD',
            timeframe: 'H1',
            matchMode: 'ALL',
            windowBars: 4,
            side: 'SHORT',
            blocks: [
                regimeBearish(),
                emaPriceBelow(),
                rsiCrossBelow50(),
            ],
            stopLoss: { type: 'BELOW_STRUCTURE', value: 0.0025, lookback: 18 },
            takeProfit: { type: 'R_MULTIPLE', value: 2 },
            exitManagement: { profileCode: 'BE_1R_TP_2R' },
        },
    },
]);

export function getTier1ComposedSignalSeeds(): Tier1ComposedSignalSeed[] {
    return jsonClone(buildTier1Seeds());
}

export async function upsertTier1ComposedSignals(
    prisma: PrismaClient,
    blockRegistry: TechIndicatorRegistry,
): Promise<UpsertTier1ComposedSignalsResult> {
    const seeds = getTier1ComposedSignalSeeds();

    for (const seed of seeds) {
        const issues = validateComposedSignalDefinition(seed.composedBlocks, blockRegistry);
        if (issues.length > 0) {
            throw new Error(`Tier 1 composed signal ${seed.code}@${seed.version} is invalid:\n${issues.map((issue) => `- ${issue.message}`).join('\n')}`);
        }
    }

    const existingRows = await prisma.signalDefinition.findMany({
        where: {
            code: { in: seeds.map((seed) => seed.code) },
        },
        select: {
            id: true,
            code: true,
            version: true,
            createdBy: true,
        },
    });

    const existingByKey = new Map(
        existingRows.map((row) => [makeKey(row.code, row.version), row]),
    );

    let created = 0;
    let updated = 0;
    const skipped: string[] = [];

    for (const seed of seeds) {
        const key = makeKey(seed.code, seed.version);
        const existing = existingByKey.get(key);

        if (existing && existing.createdBy !== SYSTEM_ACTOR) {
            skipped.push(key);
            continue;
        }

        const indicatorIds = Array.from(new Set(seed.composedBlocks.blocks.map((block) => block.indicatorId)));
        const commonData = {
            name: seed.name,
            category: seed.category,
            description: seed.description,
            parameterSchema: {} as Prisma.InputJsonValue,
            indicatorSchema: { blocks: indicatorIds } as Prisma.InputJsonValue,
            eventSchema: {
                profileCode: seed.composedBlocks.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
                systemManaged: true,
            } as Prisma.InputJsonValue,
            composedBlocks: seed.composedBlocks as unknown as Prisma.InputJsonValue,
            isComposed: true,
            isActive: true,
        };

        if (existing) {
            await prisma.signalDefinition.update({
                where: { id: existing.id },
                data: commonData,
            });
            updated += 1;
            continue;
        }

        await prisma.signalDefinition.create({
            data: {
                code: seed.code,
                version: seed.version,
                createdBy: SYSTEM_ACTOR,
                ...commonData,
            },
        });
        created += 1;
    }

    return { created, updated, skipped };
}
