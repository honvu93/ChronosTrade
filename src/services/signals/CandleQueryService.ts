import { PrismaClient } from '@prisma/client';
import { CandleBar, CandleQueryInput } from './types';
import {
    dedupeMarketSymbolRowsByTime,
    getMarketSymbolAliases,
    normalizeMarketSymbol,
} from '../../utils/symbols';
import {
    getTimeframeAliases,
    normalizeTimeframe,
} from '../../utils/timeframes';

const toNumber = (value: unknown) => Number(value ?? 0);

const TIMEFRAME_MINUTES: Record<string, number> = {
    '1m': 1, '5m': 5, '15m': 15, '30m': 30,
    '1h': 60, '2h': 120, '3h': 180, '4h': 240,
    '12h': 720, '1d': 1440, '3d': 4320, '1w': 10080,
};

function resampleCandles(sourceBars: CandleBar[], targetTimeframe: string): CandleBar[] {
    const targetMinutes = TIMEFRAME_MINUTES[targetTimeframe];
    if (!targetMinutes) return [];
    const targetMs = targetMinutes * 60_000;

    const grouped = new Map<number, CandleBar[]>();
    for (const bar of sourceBars) {
        const bucket = Math.floor(bar.time.getTime() / targetMs) * targetMs;
        const list = grouped.get(bucket);
        if (list) { list.push(bar); } else { grouped.set(bucket, [bar]); }
    }

    const result: CandleBar[] = [];
    for (const [bucket, bars] of Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])) {
        if (bars.length === 0) continue;
        result.push({
            time: new Date(bucket),
            symbol: bars[0].symbol,
            timeframe: targetTimeframe,
            exchange: bars[0].exchange,
            open: bars[0].open,
            high: Math.max(...bars.map((b) => b.high)),
            low: Math.min(...bars.map((b) => b.low)),
            close: bars[bars.length - 1].close,
            volume: bars.reduce((s, b) => s + b.volume, 0),
            quoteVolume: bars[0].quoteVolume !== null ? bars.reduce((s, b) => s + (b.quoteVolume ?? 0), 0) : null,
            trades: bars[0].trades !== null ? bars.reduce((s, b) => s + (b.trades ?? 0), 0) : null,
            takerBuyVolume: bars[0].takerBuyVolume !== null ? bars.reduce((s, b) => s + (b.takerBuyVolume ?? 0), 0) : null,
            isClosed: bars[bars.length - 1].isClosed,
        });
    }
    return result;
}

export class CandleQueryService {
    constructor(private prisma: PrismaClient) { }

    public async getCandles(input: CandleQueryInput): Promise<CandleBar[]> {
        const canonicalSymbol = normalizeMarketSymbol(input.symbol);
        const symbolAliases = getMarketSymbolAliases(input.symbol);
        const canonicalTimeframe = normalizeTimeframe(input.timeframe);
        const timeframeAliases = getTimeframeAliases(input.timeframe);
        const rows = await this.prisma.candle.findMany({
            where: {
                symbol: symbolAliases.length === 1 ? symbolAliases[0] : { in: symbolAliases },
                timeframe: timeframeAliases.length === 1 ? timeframeAliases[0] : { in: timeframeAliases },
                time: {
                    gte: input.from,
                    lte: input.to,
                },
            },
            orderBy: { time: 'asc' },
            ...(input.limit ? { take: input.limit * symbolAliases.length * timeframeAliases.length } : {}),
        });
        const dedupedRows = dedupeMarketSymbolRowsByTime(rows, canonicalSymbol, {
            preferredTimeframeAliases: timeframeAliases,
        }).slice(0, input.limit ?? rows.length);

        const mapped = dedupedRows.map((row) => ({
            time: row.time,
            symbol: canonicalSymbol,
            timeframe: canonicalTimeframe,
            exchange: row.exchange,
            open: toNumber(row.open),
            high: toNumber(row.high),
            low: toNumber(row.low),
            close: toNumber(row.close),
            volume: toNumber(row.volume),
            quoteVolume: row.quote_volume !== null ? toNumber(row.quote_volume) : null,
            trades: row.trades,
            takerBuyVolume: row.taker_buy_volume !== null ? toNumber(row.taker_buy_volume) : null,
            isClosed: row.is_closed,
        }));

        // Auto-resample from smallest available timeframe if no data found
        if (mapped.length === 0 && TIMEFRAME_MINUTES[canonicalTimeframe] && TIMEFRAME_MINUTES[canonicalTimeframe] > 5) {
            const sourceTimeframe = '5m';
            const sourceBars = await this.getCandles({
                symbol: input.symbol,
                timeframe: sourceTimeframe,
                from: input.from,
                to: input.to,
            });
            if (sourceBars.length > 0) {
                const resampled = resampleCandles(sourceBars, canonicalTimeframe);
                return input.limit ? resampled.slice(0, input.limit) : resampled;
            }
        }

        return mapped;
    }

    public async getCandlesByTimeframes(input: Omit<CandleQueryInput, 'timeframe'> & { timeframes: string[] }) {
        const result: Record<string, CandleBar[]> = {};

        for (const timeframe of input.timeframes) {
            result[timeframe] = await this.getCandles({
                symbol: input.symbol,
                timeframe,
                from: input.from,
                to: input.to,
                limit: input.limit,
            });
        }

        return result;
    }
}
