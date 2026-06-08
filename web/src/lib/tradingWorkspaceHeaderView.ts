import { TradingWorkspaceTab } from "@/types/trading";

const tabLabels: Record<TradingWorkspaceTab, string> = {
    overview: "Overview",
    eligibility: "Eligibility",
    positions: "Positions",
    orders: "Orders",
    history: "History",
    automation: "Automation",
    external: "External Action",
    audit: "Audit",
};

export interface TradingWorkspaceHeaderView {
    badges: string[];
}

export function buildTradingWorkspaceHeaderView({
    landingLabel,
    marketSymbol,
    timeframe,
    accountLabel,
    accountMode,
    syncLabel,
    activeTab,
}: {
    landingLabel: string;
    marketSymbol: string;
    timeframe: string;
    accountLabel: string;
    accountMode: "LIVE" | "PAPER";
    syncLabel: string;
    activeTab: TradingWorkspaceTab;
}): TradingWorkspaceHeaderView {
    return {
        badges: [
            landingLabel,
            `Focus ${marketSymbol} / ${timeframe}`,
            `Account ${accountLabel}`,
            accountMode === "PAPER" ? "Paper / Demo" : "Live",
            `Tab ${tabLabels[activeTab]}`,
            syncLabel,
        ],
    };
}
