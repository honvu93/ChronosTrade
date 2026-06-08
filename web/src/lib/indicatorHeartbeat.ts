import { DateTime } from "luxon";
import { getTimeframeMs } from "./freshnessUtils";

const MIN_HEARTBEAT_THRESHOLD_MS = 15 * 60_000;

const normalizeIndicatorTimeframe = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
        return "1m";
    }

    const mt5AliasMap: Record<string, string> = {
        M1: "1m",
        M5: "5m",
        M15: "15m",
        M30: "30m",
        H1: "1h",
        H2: "2h",
        H3: "3h",
        H4: "4h",
        H12: "12h",
        D1: "1d",
        W1: "1w",
        MN1: "1M",
    };

    return mt5AliasMap[trimmed.toUpperCase()] ?? trimmed;
};

export const getIndicatorHeartbeatThresholdMs = (timeframe: string) => (
    Math.max(MIN_HEARTBEAT_THRESHOLD_MS, getTimeframeMs(normalizeIndicatorTimeframe(timeframe)) * 2)
);

export const isIndicatorHeartbeatStale = (
    lastProcessedCandleTime: string | null | undefined,
    timeframe: string,
    now: DateTime = DateTime.now(),
) => {
    if (!lastProcessedCandleTime) {
        return false;
    }

    const lastUpdate = DateTime.fromISO(lastProcessedCandleTime);
    if (!lastUpdate.isValid) {
        return false;
    }

    return now.toMillis() - lastUpdate.toMillis() > getIndicatorHeartbeatThresholdMs(timeframe);
};
