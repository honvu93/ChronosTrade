export interface CandleCoverageInput {
    from: Date;
    to: Date;
    timeframeMinutes: number;
    actualBarCount: number;
    sufficientThresholdPct?: number;
    symbol?: string;
    timeframe?: string;
}

export interface CandleCoverageResult {
    expectedBars: number;
    actualBars: number;
    coveragePct: number;
    sufficient: boolean;
    message: string;
}

const DEFAULT_SUFFICIENT_THRESHOLD = 80;

/**
 * Computes candle data coverage for a requested date range.
 * Returns coverage percentage and whether it meets the minimum threshold.
 */
export function computeCandleCoverage(input: CandleCoverageInput): CandleCoverageResult {
    const rangeMs = input.to.getTime() - input.from.getTime();
    const barMs = input.timeframeMinutes * 60_000;
    const expectedBars = Math.floor(rangeMs / barMs);
    const actualBars = input.actualBarCount;
    const coveragePct = expectedBars > 0 ? Math.round((actualBars / expectedBars) * 100) : 0;
    const threshold = input.sufficientThresholdPct ?? DEFAULT_SUFFICIENT_THRESHOLD;
    const sufficient = coveragePct >= threshold;

    const symbol = input.symbol ?? 'unknown';
    const timeframe = input.timeframe ?? 'unknown';
    const fromStr = input.from.toISOString().slice(0, 10);
    const toStr = input.to.toISOString().slice(0, 10);

    const message = sufficient
        ? `Data coverage ${coveragePct}% for ${symbol} ${timeframe} ${fromStr} to ${toStr} (${actualBars}/${expectedBars} bars).`
        : `Insufficient data coverage (${coveragePct}%) for ${symbol} ${timeframe} ${fromStr} to ${toStr}. Expected ${expectedBars} bars, found ${actualBars}. Please adjust your date range.`;

    return { expectedBars, actualBars, coveragePct, sufficient, message };
}
