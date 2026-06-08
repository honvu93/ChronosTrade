import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LEGACY_SYMBOL = 'BTCUSDC';
const TARGET_SYMBOL = 'BTCUSD';
const MT5_EXCHANGE = 'MT5';

type CountRow = {
    symbol: string;
    exchange: string;
    bars: number;
};

async function fetchCounts(): Promise<CountRow[]> {
    return prisma.$queryRawUnsafe(`
        SELECT
            symbol,
            exchange,
            COUNT(*)::int AS bars
        FROM price_candles
        WHERE symbol IN ('${LEGACY_SYMBOL}', '${TARGET_SYMBOL}')
          AND exchange = '${MT5_EXCHANGE}'
        GROUP BY symbol, exchange
        ORDER BY symbol, exchange
    `);
}

async function migrateCandles() {
    await prisma.$executeRawUnsafe(
        `
        INSERT INTO price_candles (
            time,
            symbol,
            timeframe,
            exchange,
            open,
            high,
            low,
            close,
            volume,
            quote_volume,
            trades,
            taker_buy_volume,
            is_closed
        )
        SELECT
            time,
            $1,
            timeframe,
            exchange,
            open,
            high,
            low,
            close,
            volume,
            quote_volume,
            trades,
            taker_buy_volume,
            is_closed
        FROM price_candles
        WHERE symbol = $2
          AND exchange = $3
        ON CONFLICT (time, symbol, timeframe, exchange)
        DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            quote_volume = EXCLUDED.quote_volume,
            trades = EXCLUDED.trades,
            taker_buy_volume = EXCLUDED.taker_buy_volume,
            is_closed = EXCLUDED.is_closed
        `,
        TARGET_SYMBOL,
        LEGACY_SYMBOL,
        MT5_EXCHANGE,
    );

    return prisma.$executeRawUnsafe(
        `
        DELETE FROM price_candles
        WHERE symbol = $1
          AND exchange = $2
        `,
        LEGACY_SYMBOL,
        MT5_EXCHANGE,
    );
}

async function migrateSecondaryTables() {
    const [backtestRuns, signals, optimizationJobs] = await Promise.all([
        prisma.backtestRun.updateMany({
            where: { symbol: LEGACY_SYMBOL },
            data: { symbol: TARGET_SYMBOL },
        }),
        prisma.signal.updateMany({
            where: { symbol: LEGACY_SYMBOL },
            data: { symbol: TARGET_SYMBOL },
        }),
        prisma.signalOptimizationJob.updateMany({
            where: { symbol: LEGACY_SYMBOL },
            data: { symbol: TARGET_SYMBOL },
        }),
    ]);

    return {
        backtestRuns: backtestRuns.count,
        signals: signals.count,
        optimizationJobs: optimizationJobs.count,
    };
}

async function main() {
    const before = await fetchCounts();
    const deletedLegacyRows = await migrateCandles();
    const secondary = await migrateSecondaryTables();
    const after = await fetchCounts();

    console.log(JSON.stringify({
        legacySymbol: LEGACY_SYMBOL,
        targetSymbol: TARGET_SYMBOL,
        exchange: MT5_EXCHANGE,
        before,
        deletedLegacyRows,
        secondary,
        after,
    }, null, 2));
}

main()
    .catch(async (error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
