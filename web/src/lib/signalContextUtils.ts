/**
 * Maps a market-store timeframe string (e.g. "1h") to the composed-signal
 * composer timeframe format (e.g. "H1").
 *
 * Market store uses lowercase shorthand; the signal composer uses the
 * MT5-aligned uppercase notation supported by the backend.
 */
const MARKET_TO_SIGNAL_TIMEFRAME: Record<string, string> = {
  "1m":  "M1",
  "5m":  "M5",
  "15m": "M15",
  "30m": "M30",
  "1h":  "H1",
  "4h":  "H4",
  "1d":  "D1",
};

/** Fallback timeframe used when the market store value cannot be mapped. */
export const DEFAULT_SIGNAL_TIMEFRAME = "H1";

/**
 * Converts a market-store timeframe string into the signal-composer
 * timeframe format. Falls back to "H1" for unmapped values.
 *
 * @example
 * mapMarketTimeframe("1h")  // → "H1"
 * mapMarketTimeframe("4h")  // → "H4"
 * mapMarketTimeframe("???") // → "H1" (fallback)
 */
export function mapMarketTimeframe(tf: string): string {
  return MARKET_TO_SIGNAL_TIMEFRAME[tf] ?? DEFAULT_SIGNAL_TIMEFRAME;
}
