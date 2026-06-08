import { PrismaClient } from '@prisma/client';
import { getMarketSymbolAliases, normalizeMarketSymbol } from '../utils/symbols';

type AssetKey = 'BTC' | 'XAU' | 'XAG';
type RequestedTimeframe = '1D' | 'W' | 'MN1';

type AssetConfig = {
    key: AssetKey;
    seedSymbol: string;
};

type TimeframeConfig = {
    key: RequestedTimeframe;
    dbCandidates: string[];
    gapThresholdMs: number;
};

type CandleRow = {
    time: Date;
    symbol: string;
    timeframe: string;
    exchange: string;
    open: unknown;
    high: unknown;
    low: unknown;
    close: unknown;
    volume: unknown;
    quote_volume: unknown;
    trades: number | null;
    taker_buy_volume: unknown;
    is_closed: boolean;
};

type GroupSummary = {
    symbol: string;
    timeframe: string;
    exchange: string;
    count: number;
    firstTime: string;
    lastTime: string;
    closedCount: number;
    openCount: number;
};

type SampleCandle = {
    symbol: string;
    timeframe: string;
    exchange: string;
    time: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    quoteVolume: string | null;
    trades: number | null;
    takerBuyVolume: string | null;
    isClosed: boolean;
};

type GapSummary = {
    count: number;
    maxGapDays: number;
    samples: Array<{
        from: string;
        to: string;
        gapDays: number;
    }>;
};

type AuditEntry = {
    asset: AssetKey;
    canonicalSymbol: string;
    requestedTimeframe: RequestedTimeframe;
    dbTimeframeCandidates: string[];
    physicalRows: number;
    distinctTimestamps: number;
    firstTime: string | null;
    lastTime: string | null;
    hoursSinceLast: number | null;
    symbolsPresent: string[];
    groups: GroupSummary[];
    overlapTimestamps: string[];
    gaps: GapSummary;
    earliest: SampleCandle[];
    latest: SampleCandle[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const ASSETS: AssetConfig[] = [
    { key: 'BTC', seedSymbol: 'BTCUSD' },
    { key: 'XAU', seedSymbol: 'XAUUSD' },
    { key: 'XAG', seedSymbol: 'XAGUSD' },
];

const TIMEFRAMES: TimeframeConfig[] = [
    { key: '1D', dbCandidates: ['1D', '1d'], gapThresholdMs: 4 * DAY_MS },
    { key: 'W', dbCandidates: ['W', '1W', '1w'], gapThresholdMs: 10 * DAY_MS },
    { key: 'MN1', dbCandidates: ['MN1', '1M', '1mth'], gapThresholdMs: 45 * DAY_MS },
];

function parseArgs(argv: string[]) {
    const selectedAssets = new Set<AssetKey>(ASSETS.map((asset) => asset.key));
    const selectedTimeframes = new Set<RequestedTimeframe>(TIMEFRAMES.map((timeframe) => timeframe.key));
    let json = false;

    for (const arg of argv) {
        if (arg === '--json') {
            json = true;
            continue;
        }

        if (arg.startsWith('--assets=')) {
            selectedAssets.clear();
            for (const value of arg.slice('--assets='.length).split(',')) {
                const asset = value.trim().toUpperCase() as AssetKey;
                if (ASSETS.some((candidate) => candidate.key === asset)) {
                    selectedAssets.add(asset);
                }
            }
            continue;
        }

        if (arg.startsWith('--timeframes=')) {
            selectedTimeframes.clear();
            for (const value of arg.slice('--timeframes='.length).split(',')) {
                const timeframe = value.trim().toUpperCase() as RequestedTimeframe;
                if (TIMEFRAMES.some((candidate) => candidate.key === timeframe)) {
                    selectedTimeframes.add(timeframe);
                }
            }
        }
    }

    return {
        json,
        assets: ASSETS.filter((asset) => selectedAssets.has(asset.key)),
        timeframes: TIMEFRAMES.filter((timeframe) => selectedTimeframes.has(timeframe.key)),
    };
}

function toPrintableNumber(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value);
}

function toSampleCandle(row: CandleRow): SampleCandle {
    return {
        symbol: row.symbol,
        timeframe: row.timeframe,
        exchange: row.exchange,
        time: row.time.toISOString(),
        open: toPrintableNumber(row.open),
        high: toPrintableNumber(row.high),
        low: toPrintableNumber(row.low),
        close: toPrintableNumber(row.close),
        volume: toPrintableNumber(row.volume),
        quoteVolume: row.quote_volume === null ? null : toPrintableNumber(row.quote_volume),
        trades: row.trades,
        takerBuyVolume: row.taker_buy_volume === null ? null : toPrintableNumber(row.taker_buy_volume),
        isClosed: row.is_closed,
    };
}

function buildGroupSummaries(rows: CandleRow[]): GroupSummary[] {
    const groups = new Map<string, GroupSummary>();

    for (const row of rows) {
        const key = `${row.symbol}|${row.timeframe}|${row.exchange}`;
        const current = groups.get(key);

        if (!current) {
            groups.set(key, {
                symbol: row.symbol,
                timeframe: row.timeframe,
                exchange: row.exchange,
                count: 1,
                firstTime: row.time.toISOString(),
                lastTime: row.time.toISOString(),
                closedCount: row.is_closed ? 1 : 0,
                openCount: row.is_closed ? 0 : 1,
            });
            continue;
        }

        current.count += 1;
        current.lastTime = row.time.toISOString();
        if (row.is_closed) {
            current.closedCount += 1;
        } else {
            current.openCount += 1;
        }
    }

    return Array.from(groups.values()).sort((left, right) => (
        left.symbol.localeCompare(right.symbol)
        || left.timeframe.localeCompare(right.timeframe)
        || left.exchange.localeCompare(right.exchange)
    ));
}

function buildOverlapTimestamps(rows: CandleRow[]): string[] {
    const counts = new Map<string, number>();

    for (const row of rows) {
        const time = row.time.toISOString();
        counts.set(time, (counts.get(time) ?? 0) + 1);
    }

    return Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([time]) => time)
        .sort((left, right) => right.localeCompare(left));
}

function buildGapSummary(rows: CandleRow[], gapThresholdMs: number): GapSummary {
    const dedupedTimes = Array.from(new Set(rows.map((row) => row.time.getTime()))).sort((left, right) => left - right);
    const samples: GapSummary['samples'] = [];
    let maxGapDays = 0;

    for (let index = 1; index < dedupedTimes.length; index += 1) {
        const previous = dedupedTimes[index - 1];
        const current = dedupedTimes[index];
        const gapMs = current - previous;

        if (gapMs <= gapThresholdMs) {
            continue;
        }

        const gapDays = Number((gapMs / DAY_MS).toFixed(2));
        maxGapDays = Math.max(maxGapDays, gapDays);

        if (samples.length < 5) {
            samples.push({
                from: new Date(previous).toISOString(),
                to: new Date(current).toISOString(),
                gapDays,
            });
        }
    }

    return {
        count: samples.length === 0 ? 0 : dedupedTimes.reduce((total, current, index) => {
            if (index === 0) {
                return total;
            }

            return total + (current - dedupedTimes[index - 1] > gapThresholdMs ? 1 : 0);
        }, 0),
        maxGapDays,
        samples,
    };
}

function roundHoursSinceLast(lastTime: Date | null): number | null {
    if (!lastTime) {
        return null;
    }

    return Number(((Date.now() - lastTime.getTime()) / (60 * 60 * 1000)).toFixed(2));
}

async function auditEntry(
    prisma: PrismaClient,
    asset: AssetConfig,
    timeframe: TimeframeConfig,
): Promise<AuditEntry> {
    const aliases = getMarketSymbolAliases(asset.seedSymbol);
    const rows = await prisma.candle.findMany({
        where: {
            symbol: { in: aliases },
            timeframe: { in: timeframe.dbCandidates },
        },
        orderBy: [
            { time: 'asc' },
            { symbol: 'asc' },
            { exchange: 'asc' },
        ],
        select: {
            time: true,
            symbol: true,
            timeframe: true,
            exchange: true,
            open: true,
            high: true,
            low: true,
            close: true,
            volume: true,
            quote_volume: true,
            trades: true,
            taker_buy_volume: true,
            is_closed: true,
        },
    }) as CandleRow[];

    const firstRow = rows[0] ?? null;
    const lastRow = rows[rows.length - 1] ?? null;
    const distinctTimestamps = new Set(rows.map((row) => row.time.getTime()));

    return {
        asset: asset.key,
        canonicalSymbol: normalizeMarketSymbol(asset.seedSymbol),
        requestedTimeframe: timeframe.key,
        dbTimeframeCandidates: timeframe.dbCandidates,
        physicalRows: rows.length,
        distinctTimestamps: distinctTimestamps.size,
        firstTime: firstRow?.time.toISOString() ?? null,
        lastTime: lastRow?.time.toISOString() ?? null,
        hoursSinceLast: roundHoursSinceLast(lastRow?.time ?? null),
        symbolsPresent: Array.from(new Set(rows.map((row) => row.symbol))).sort((left, right) => left.localeCompare(right)),
        groups: buildGroupSummaries(rows),
        overlapTimestamps: buildOverlapTimestamps(rows),
        gaps: buildGapSummary(rows, timeframe.gapThresholdMs),
        earliest: rows.slice(0, 3).map(toSampleCandle),
        latest: rows.slice(-3).reverse().map(toSampleCandle),
    };
}

function printTextReport(entries: AuditEntry[]) {
    console.log(`Generated at UTC: ${new Date().toISOString()}`);
    console.log('');

    for (const entry of entries) {
        console.log(`${entry.asset} ${entry.requestedTimeframe}`);
        console.log(`  Canonical symbol: ${entry.canonicalSymbol}`);
        console.log(`  DB timeframe candidates: ${entry.dbTimeframeCandidates.join(', ')}`);
        console.log(`  Physical rows: ${entry.physicalRows}`);
        console.log(`  Distinct timestamps: ${entry.distinctTimestamps}`);
        console.log(`  Range: ${entry.firstTime ?? 'none'} -> ${entry.lastTime ?? 'none'}`);
        console.log(`  Hours since last: ${entry.hoursSinceLast ?? 'n/a'}`);
        console.log(`  Symbols present: ${entry.symbolsPresent.length > 0 ? entry.symbolsPresent.join(', ') : 'none'}`);

        if (entry.groups.length === 0) {
            console.log('  Groups: none');
        } else {
            console.log('  Groups:');
            for (const group of entry.groups) {
                console.log(
                    `    - ${group.symbol} | ${group.timeframe} | ${group.exchange} | ` +
                    `count=${group.count} | range=${group.firstTime} -> ${group.lastTime} | ` +
                    `closed=${group.closedCount} | open=${group.openCount}`,
                );
            }
        }

        console.log(`  Overlap timestamps across aliases: ${entry.overlapTimestamps.length}`);
        for (const overlap of entry.overlapTimestamps.slice(0, 5)) {
            console.log(`    - ${overlap}`);
        }

        console.log(`  Gap count above threshold: ${entry.gaps.count}`);
        console.log(`  Max gap days: ${entry.gaps.maxGapDays}`);
        for (const gap of entry.gaps.samples) {
            console.log(`    - ${gap.from} -> ${gap.to} (${gap.gapDays} days)`);
        }

        if (entry.earliest.length > 0) {
            console.log('  Earliest candles:');
            for (const candle of entry.earliest) {
                console.log(`    - ${candle.time} | ${candle.symbol} | close=${candle.close} | volume=${candle.volume}`);
            }
        }

        if (entry.latest.length > 0) {
            console.log('  Latest candles:');
            for (const candle of entry.latest) {
                console.log(`    - ${candle.time} | ${candle.symbol} | close=${candle.close} | volume=${candle.volume}`);
            }
        }

        console.log('');
    }
}

async function main() {
    const prisma = new PrismaClient();

    try {
        const options = parseArgs(process.argv.slice(2));
        const entries: AuditEntry[] = [];

        for (const asset of options.assets) {
            for (const timeframe of options.timeframes) {
                entries.push(await auditEntry(prisma, asset, timeframe));
            }
        }

        if (options.json) {
            console.log(JSON.stringify({
                generatedAt: new Date().toISOString(),
                entries,
            }, null, 2));
            return;
        }

        printTextReport(entries);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
