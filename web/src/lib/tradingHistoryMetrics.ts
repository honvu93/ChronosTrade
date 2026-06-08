import type { TradingWorkspaceDeal } from "../types/trading";

function round(value: number, digits = 6) {
    return Number(value.toFixed(digits));
}

export interface TradingHistoryMetricsView {
    rangeLabel: string;
    sourceLabel: string;
    shownDeals: number;
    wins: number;
    losses: number;
    flat: number;
    winRate: number | null;
    netPnl: number;
    totalVolume: number;
    pnlAccent: "up" | "down" | "neutral";
}

export function buildTradingHistoryMetricsView({
    deals,
    hasActiveFilter,
    rangeSummary,
}: {
    deals: TradingWorkspaceDeal[];
    hasActiveFilter: boolean;
    rangeSummary: string | null;
}): TradingHistoryMetricsView {
    let wins = 0;
    let losses = 0;
    let flat = 0;
    let netPnl = 0;
    let totalVolume = 0;

    for (const deal of deals) {
        netPnl += deal.realizedPnl;
        totalVolume += deal.volume;

        if (deal.realizedPnl > 0) {
            wins += 1;
            continue;
        }

        if (deal.realizedPnl < 0) {
            losses += 1;
            continue;
        }

        flat += 1;
    }

    const decisiveDeals = wins + losses;

    return {
        rangeLabel: rangeSummary ?? "Default bounded snapshot",
        sourceLabel: hasActiveFilter
            ? "Metrics reflect the mirrored deals returned for the selected UTC range."
            : "Metrics reflect the default bounded mirrored-history snapshot now loaded in the workspace.",
        shownDeals: deals.length,
        wins,
        losses,
        flat,
        winRate: decisiveDeals > 0 ? round((wins / decisiveDeals) * 100, 4) : null,
        netPnl: round(netPnl, 2),
        totalVolume: round(totalVolume, 6),
        pnlAccent: netPnl > 0 ? "up" : netPnl < 0 ? "down" : "neutral",
    };
}
