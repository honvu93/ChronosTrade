export type DataFreshnessState = "loading" | "fresh" | "stale" | "gap" | "error";

/** Expected candle duration per timeframe in milliseconds. */
const TIMEFRAME_MS: Record<string, number> = {
  "1m":  60_000,
  "5m":  5  * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h":  60 * 60_000,
  "2h":  2  * 60 * 60_000,
  "3h":  3  * 60 * 60_000,
  "4h":  4  * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d":  24 * 60 * 60_000,
  "1w":  7  * 24 * 60 * 60_000,
  "1M":  30 * 24 * 60 * 60_000,
};

/** Returns the expected bar duration in ms for a given timeframe string (falls back to 1m). */
export function getTimeframeMs(timeframe: string): number {
  return TIMEFRAME_MS[timeframe] ?? 60_000;
}

/**
 * Classifies market data freshness based on how old the latest candle is relative
 * to the expected bar cadence of the selected timeframe.
 *
 * - fresh:  age ≤ 2× bar duration  (data is up to date)
 * - stale:  age ≤ 20× bar duration (data exists but may be delayed)
 * - gap:    age > 20× bar duration OR no data (coverage is incomplete / unavailable)
 */
export function classifyFreshness(
  latestTimestamp: string | null,
  timeframe: string,
  now: Date = new Date(),
): DataFreshnessState {
  if (!latestTimestamp) return "gap";

  const tfMs = getTimeframeMs(timeframe);
  const ageMs = now.getTime() - new Date(latestTimestamp).getTime();

  if (ageMs <= 2 * tfMs)  return "fresh";
  if (ageMs <= 20 * tfMs) return "stale";
  return "gap";
}

export interface FreshnessLabel {
  /** Short UI label (e.g. "Fresh", "Stale", "Gap"). */
  label: string;
  /** One-sentence description shown in persistent warning banners. */
  description: string;
}

/** Returns display text for a freshness state (text-only, no colour/icon). */
export function getFreshnessLabel(state: DataFreshnessState): FreshnessLabel {
  switch (state) {
    case "fresh":
      return {
        label: "Fresh",
        description: "Market data is up to date.",
      };
    case "stale":
      return {
        label: "Stale",
        description: "Market data may be delayed - latest candle is older than expected.",
      };
    case "gap":
      return {
        label: "Gap",
        description: "Recent candles are missing or delayed for this symbol and timeframe.",
      };
    case "error":
      return {
        label: "Unknown",
        description: "Unable to determine data freshness - sync status check failed.",
      };
    case "loading":
    default:
      return {
        label: "Loading",
        description: "Checking data freshness…",
      };
  }
}
