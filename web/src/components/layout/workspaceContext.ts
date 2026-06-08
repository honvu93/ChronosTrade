export interface WorkspaceContextState {
  symbol: string;
  timeframe: string;
}

export interface WorkspaceContextSummary {
  workspaceLabel: string;
  contextLabel: string;
  symbol: string;
  timeframe: string;
  timeframeLabel: string;
}

import { AppLocale, DEFAULT_APP_LOCALE } from "@/lib/appLocale";
import { getTranslationCatalog } from "@/lib/translations";

export const AVAILABLE_TIMEFRAMES = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "3h",
  "4h",
  "12h",
  "1d",
  "1w",
  "1M",
] as const;

export type SupportedTimeframe = (typeof AVAILABLE_TIMEFRAMES)[number];

const TIMEFRAME_LABELS: Record<string, string> = {
  "1m": "1 Minute",
  "5m": "5 Minutes",
  "15m": "15 Minutes",
  "30m": "30 Minutes",
  "1h": "1 Hour",
  "2h": "2 Hours",
  "3h": "3 Hours",
  "4h": "4 Hours",
  "12h": "12 Hours",
  "1d": "1 Day",
  "1w": "1 Week",
  "1M": "1 Month",
};

export function getTimeframeLabel(timeframe: string, locale: AppLocale = DEFAULT_APP_LOCALE): string {
  const translated = getTranslationCatalog(locale).workspace.timeframeLabels[timeframe];
  return translated ?? TIMEFRAME_LABELS[timeframe] ?? timeframe.toUpperCase();
}

export function getChartWorkspaceContext(
  state: WorkspaceContextState,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): WorkspaceContextSummary {
  const copy = getTranslationCatalog(locale);
  const symbol = state.symbol || "-";
  const timeframe = state.timeframe || "-";
  const timeframeLabel = getTimeframeLabel(timeframe, locale);
  return {
    workspaceLabel: copy.workspace.chartWorkspace,
    contextLabel:
      state.symbol && state.timeframe
        ? `${symbol} / ${timeframeLabel}`
        : copy.workspace.primaryMarketContext,
    symbol,
    timeframe,
    timeframeLabel,
  };
}
