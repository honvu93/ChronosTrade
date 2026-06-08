/**
 * Pure helpers for reading/writing market context (symbol + timeframe)
 * from/to URL search params. Framework-agnostic so they are easily unit-testable.
 */

export interface MarketContextParams {
  symbol: string | null;
  timeframe: string | null;
}

export function parseMarketContextFromSearchParams(
  searchParams: URLSearchParams,
): MarketContextParams {
  return {
    symbol: searchParams.get("symbol"),
    timeframe: searchParams.get("tf"),
  };
}

export function buildMarketContextSearchParams(
  symbol: string,
  timeframe: string,
  existing?: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(existing?.toString() ?? "");
  params.set("symbol", symbol);
  params.set("tf", timeframe);
  return params;
}
