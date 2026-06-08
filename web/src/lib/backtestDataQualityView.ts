import { classifyFreshness, DataFreshnessState, getTimeframeMs } from "@/lib/freshnessUtils";
import { GeneratedBacktestDetail } from "@/types/signals";

export interface BacktestSyncStatusSnapshot {
    symbol: string;
    timeframe: string;
    oldest: string | null;
    latest: string | null;
    totalCandles: number;
}

export interface BacktestRangeCoverageSnapshot {
    candlesInRange: number;
    expectedCandles: number;
    gapCount: number;
    missingBars: number;
}

export type BacktestDataQualityState = "loading" | "healthy" | "caution" | "blocked";

export interface BacktestDataQualityViewModel {
    state: BacktestDataQualityState;
    heading: string;
    summary: string;
    warnings: string[];
    freshnessState: DataFreshnessState;
}

const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "n/a");
const isWeekendUtc = (timestampMs: number) => {
    const day = new Date(timestampMs).getUTCDay();
    return day === 0 || day === 6;
};

export const buildBacktestRangeCoverage = ({
    candleTimes,
    startedAt,
    finishedAt,
    timeframe,
}: {
    candleTimes: string[];
    startedAt: string;
    finishedAt: string | null;
    timeframe: string;
}): BacktestRangeCoverageSnapshot => {
    const timeframeMs = getTimeframeMs(timeframe);
    const runStartMs = new Date(startedAt).getTime();
    const runEndMs = new Date(finishedAt ?? startedAt).getTime();
    const endExclusiveMs = runEndMs + timeframeMs;
    const orderedTimes = Array.from(
        new Set(
            candleTimes
                .map((value) => new Date(value).getTime())
                .filter((value) => Number.isFinite(value))
                .filter((value) => value >= runStartMs && value < endExclusiveMs),
        ),
    ).sort((left, right) => left - right);

    let gapCount = 0;
    let missingBars = 0;

    for (let index = 1; index < orderedTimes.length; index += 1) {
        const previous = orderedTimes[index - 1];
        const current = orderedTimes[index];
        const rawMissingBars = Math.max(Math.floor((current - previous) / timeframeMs) - 1, 0);

        if (rawMissingBars <= 0) {
            continue;
        }

        let unexpectedMissingBars = 0;
        for (let step = 1; step <= rawMissingBars; step += 1) {
            const missingTimestamp = previous + (step * timeframeMs);
            if (!isWeekendUtc(missingTimestamp)) {
                unexpectedMissingBars += 1;
            }
        }

        if (unexpectedMissingBars > 0) {
            gapCount += 1;
            missingBars += unexpectedMissingBars;
        }
    }

    return {
        candlesInRange: orderedTimes.length,
        expectedCandles: Math.max(Math.floor((endExclusiveMs - runStartMs) / timeframeMs), 1),
        gapCount,
        missingBars,
    };
};

export const buildBacktestDataQualityView = ({
    runDetail,
    syncStatus,
    rangeCoverage,
    isLoading,
    error,
    now = new Date(),
}: {
    runDetail: GeneratedBacktestDetail | null;
    syncStatus: BacktestSyncStatusSnapshot | null;
    rangeCoverage: BacktestRangeCoverageSnapshot | null;
    isLoading: boolean;
    error: string | null;
    now?: Date;
}): BacktestDataQualityViewModel => {
    if (!runDetail || isLoading) {
        return {
            state: "loading",
            heading: "Checking data quality",
            summary: "Verifying whether the run window is fully covered by the available dataset.",
            warnings: [],
            freshnessState: "loading",
        };
    }

    if (error) {
        return {
            state: "caution",
            heading: "Data quality could not be verified",
            summary: "The validation surface could not confirm coverage or freshness for this run, so confidence should remain provisional.",
            warnings: [error],
            freshnessState: "error",
        };
    }

    if (!syncStatus || syncStatus.totalCandles <= 0 || !syncStatus.latest || !syncStatus.oldest) {
        return {
            state: "blocked",
            heading: "No dataset coverage is available for this run",
            summary: "The stored market data does not cover this symbol and timeframe well enough to trust the validation result.",
            warnings: [
                `No stored candles were available for ${runDetail.symbol} ${runDetail.timeframe} when the validation check ran.`,
            ],
            freshnessState: "gap",
        };
    }

    const timeframeMs = getTimeframeMs(runDetail.timeframe);
    const runStartMs = new Date(runDetail.startedAt).getTime();
    const runEndMs = new Date(runDetail.finishedAt ?? runDetail.startedAt).getTime();
    const oldestMs = new Date(syncStatus.oldest).getTime();
    const latestMs = new Date(syncStatus.latest).getTime();
    const freshnessState = classifyFreshness(syncStatus.latest, runDetail.timeframe, now);
    const warnings: string[] = [];

    const hasLeadingCoverageGap = runStartMs + (2 * timeframeMs) < oldestMs;
    const hasTrailingCoverageGap = runEndMs - (2 * timeframeMs) > latestMs;
    const touchesLatestBoundary = Math.abs(runEndMs - latestMs) <= 2 * timeframeMs;

    if (hasLeadingCoverageGap) {
        warnings.push(
            `Requested run start ${formatDateTime(runDetail.startedAt)} is earlier than the earliest stored candle ${formatDateTime(syncStatus.oldest)}.`,
        );
    }

    if (hasTrailingCoverageGap) {
        warnings.push(
            `Requested run end ${formatDateTime(runDetail.finishedAt)} extends beyond the latest stored candle ${formatDateTime(syncStatus.latest)}.`,
        );
    }

    if (touchesLatestBoundary && freshnessState === "stale") {
        warnings.push(
            `The latest stored candle for ${runDetail.symbol} ${runDetail.timeframe} is stale relative to today, so recent-edge confidence should be reduced.`,
        );
    }

    if (touchesLatestBoundary && freshnessState === "gap") {
        warnings.push(
            `The latest stored candle for ${runDetail.symbol} ${runDetail.timeframe} leaves a material recent-edge gap for this reviewed window.`,
        );
    }

    if (rangeCoverage?.candlesInRange === 0) {
        warnings.push(
            `No candles were returned for the reviewed run window even though the broader dataset exists for ${runDetail.symbol} ${runDetail.timeframe}.`,
        );
    }

    if (rangeCoverage && rangeCoverage.gapCount > 0) {
        warnings.push(
            `Detected ${rangeCoverage.gapCount} unexpected data gap${rangeCoverage.gapCount === 1 ? "" : "s"} inside the reviewed window (${rangeCoverage.missingBars} missing candle${rangeCoverage.missingBars === 1 ? "" : "s"} relative to ${rangeCoverage.expectedCandles} expected).`,
        );
    }

    if (warnings.length === 0) {
        return {
            state: "healthy",
            heading: "Dataset coverage looks consistent",
            summary: "No boundary or freshness issues were detected for this reviewed run window.",
            warnings: [],
            freshnessState,
        };
    }

    if (
        hasLeadingCoverageGap
        || hasTrailingCoverageGap
        || freshnessState === "gap"
        || (rangeCoverage?.candlesInRange === 0)
        || Boolean(rangeCoverage && rangeCoverage.gapCount > 0)
    ) {
        return {
            state: "blocked",
            heading: "Data coverage gaps reduce confidence in this run",
            summary: "This validation result overlaps incomplete stored market data, so treat the outcome as provisional until the run is repeated inside a covered window.",
            warnings,
            freshnessState,
        };
    }

    return {
        state: "caution",
        heading: "Stale data warning",
        summary: "This run reaches the current data frontier, but the stored candles are not fresh enough to support stronger confidence.",
        warnings,
        freshnessState,
    };
};
