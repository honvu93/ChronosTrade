import { BacktestTradeSummary } from "@/types/backtests";
import { EngineOverview } from "@/types/engine";
import { GeneratedBacktestDetail } from "@/types/signals";

export type BacktestValidationTone = "positive" | "neutral" | "caution" | "blocked" | "progress";
export type BacktestValidationAction = "review-trades" | "return-to-signals";

export interface BacktestValidationViewModel {
    tone: BacktestValidationTone;
    stateLabel: string;
    heading: string;
    summary: string;
    recommendedAction: BacktestValidationAction;
    recommendedActionLabel: string;
    recommendedActionDescription: string;
    evidenceDrivers: string[];
    warningFactors: string[];
    researchNote: string;
}

const MIN_CLOSED_TRADES_FOR_CONFIDENCE = 5;

const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;

export const buildBacktestValidationView = ({
    runDetail,
    tradeSummary,
    overview,
}: {
    runDetail: GeneratedBacktestDetail | null;
    tradeSummary: BacktestTradeSummary | null;
    overview: EngineOverview | null;
}): BacktestValidationViewModel => {
    if (!runDetail) {
        return {
            tone: "progress",
            stateLabel: "Loading",
            heading: "Loading the run summary and validation context.",
            summary: "Wait for the persisted run context before drawing any conclusions from this backtest.",
            recommendedAction: "return-to-signals",
            recommendedActionLabel: "Return To Signals",
            recommendedActionDescription: "Open the generated backtest workspace again once this run is available.",
            evidenceDrivers: [],
            warningFactors: [],
            researchNote: "Live-readiness remains gated outside this research summary.",
        };
    }

    const totalTrades = tradeSummary?.totalTrades ?? overview?.metrics.totalTrades ?? runDetail.counts.results;
    const closedTrades = tradeSummary?.closedTrades ?? overview?.metrics.closedTrades ?? Math.max(totalTrades - (tradeSummary?.openTrades ?? overview?.metrics.openTrades ?? 0), 0);
    const openTrades = tradeSummary?.openTrades ?? overview?.metrics.openTrades ?? 0;
    const netR = overview?.metrics.netR ?? tradeSummary?.netR ?? 0;
    const winRate = overview?.metrics.winRate ?? tradeSummary?.winRate ?? 0;
    const profitFactor = overview?.metrics.profitFactor ?? 0;
    const expectancy = overview?.metrics.expectancy ?? 0;
    const maxDrawdownPct = overview?.metrics.maxDrawdownPct ?? 0;
    const signalCount = overview?.metrics.signalCount ?? runDetail.counts.signals;

    const evidenceDrivers = [
        `Signal context preserved: ${runDetail.signalCode}@${runDetail.signalVersion} on ${runDetail.symbol} ${runDetail.timeframe}.`,
    ];
    const warningFactors: string[] = [];

    if (totalTrades > 0) {
        evidenceDrivers.push(`${totalTrades} persisted trade result${totalTrades === 1 ? "" : "s"} are available for deeper review.`);
    }

    if (signalCount > 0) {
        evidenceDrivers.push(`${signalCount} generated signal${signalCount === 1 ? "" : "s"} fed this run.`);
    }

    if (netR > 0) {
        evidenceDrivers.push(`Closed-trade performance is net positive at ${formatSigned(netR, "R")}.`);
    }

    if (profitFactor >= 1.2) {
        evidenceDrivers.push(`Profit factor is ${profitFactor.toFixed(2)}, which is constructive but still not enough on its own.`);
    }

    if (expectancy > 0) {
        evidenceDrivers.push(`Expectancy is positive at ${formatSigned(expectancy, "R")} per closed trade.`);
    }

    if (winRate > 0 && closedTrades > 0) {
        evidenceDrivers.push(`Win rate is ${winRate.toFixed(2)}% across ${closedTrades} closed trades.`);
    }

    if (closedTrades > 0 && closedTrades < MIN_CLOSED_TRADES_FOR_CONFIDENCE) {
        warningFactors.push(`Only ${closedTrades} closed trades are available, so confidence should stay provisional.`);
    }

    if (netR <= 0 && closedTrades > 0) {
        warningFactors.push(`Net performance is ${formatSigned(netR, "R")}, so the current setup needs deeper investigation.`);
    }

    if (profitFactor > 0 && profitFactor < 1) {
        warningFactors.push(`Profit factor is ${profitFactor.toFixed(2)}, which means losses still outweigh gains.`);
    }

    if (maxDrawdownPct <= -10) {
        warningFactors.push(`Max drawdown reached ${maxDrawdownPct.toFixed(2)}%, so the run may still be too fragile to trust.`);
    }

    if (openTrades > 0) {
        warningFactors.push(`${openTrades} trade${openTrades === 1 ? "" : "s"} remained open at the end of the range, so the aggregate result is not fully settled.`);
    }

    if (runDetail.errorMessage) {
        warningFactors.push(runDetail.errorMessage);
    }

    if (runDetail.status === "FAILED") {
        return {
            tone: "blocked",
            stateLabel: "Blocked",
            heading: "The run did not finish cleanly, so validation is blocked.",
            summary: "Resolve the execution failure and rerun before you interpret this backtest as evidence.",
            recommendedAction: "return-to-signals",
            recommendedActionLabel: "Return To Signals",
            recommendedActionDescription: "Go back to the generated backtest workspace, fix the setup, and rerun.",
            evidenceDrivers,
            warningFactors,
            researchNote: "Live-readiness remains gated outside this research summary.",
        };
    }

    if (runDetail.status !== "COMPLETED") {
        return {
            tone: "progress",
            stateLabel: "Validating",
            heading: "The backtest is still running, so this summary is not final yet.",
            summary: "Wait for the run to complete before deciding whether to inspect evidence, compare runs, or rerun.",
            recommendedAction: "return-to-signals",
            recommendedActionLabel: "Return To Signals",
            recommendedActionDescription: "You can monitor or reopen the generated workspace while execution finishes.",
            evidenceDrivers,
            warningFactors,
            researchNote: "Live-readiness remains gated outside this research summary.",
        };
    }

    if (totalTrades === 0 || closedTrades === 0) {
        return {
            tone: "neutral",
            stateLabel: "Insufficient Evidence",
            heading: "The run finished, but it did not produce enough closed-trade evidence yet.",
            summary: "Adjust the signal or expand the historical window before treating this as a meaningful validation result.",
            recommendedAction: "return-to-signals",
            recommendedActionLabel: "Return To Signals",
            recommendedActionDescription: "Refine the setup or rerun with a better sample before escalating this signal.",
            evidenceDrivers,
            warningFactors,
            researchNote: "Live-readiness remains gated outside this research summary.",
        };
    }

    if (netR > 0 && profitFactor >= 1.2 && closedTrades >= MIN_CLOSED_TRADES_FOR_CONFIDENCE && maxDrawdownPct > -10) {
        return {
            tone: "positive",
            stateLabel: "Promising",
            heading: "Promising summary, but keep this run in research review.",
            summary: "The aggregate performance is constructive, and the next safe step is to inspect the trade-level evidence before comparing or promoting anything.",
            recommendedAction: "review-trades",
            recommendedActionLabel: "Review Trade Evidence",
            recommendedActionDescription: "Use the trade ledger and trace surfaces below before any broader validation decision.",
            evidenceDrivers,
            warningFactors,
            researchNote: "Live-readiness remains gated outside this research summary.",
        };
    }

    if (netR <= 0 || profitFactor < 1 || maxDrawdownPct <= -15) {
        return {
            tone: "caution",
            stateLabel: "Needs Caution",
            heading: "Caution flags are visible in the summary results.",
            summary: "The run completed, but the aggregate result does not yet support stronger confidence. Inspect the losing trades before you rerun or compare anything.",
            recommendedAction: "review-trades",
            recommendedActionLabel: "Inspect Losing Trades",
            recommendedActionDescription: "Use the trade ledger below to see where confidence broke down.",
            evidenceDrivers,
            warningFactors,
            researchNote: "Live-readiness remains gated outside this research summary.",
        };
    }

    return {
        tone: "neutral",
        stateLabel: "Insufficient Evidence",
        heading: "The summary is readable, but the sample is still too thin for a confident call.",
        summary: "Treat this run as directional only until you inspect the underlying trades and compare it with more evidence.",
        recommendedAction: "review-trades",
        recommendedActionLabel: "Review Trade Evidence",
        recommendedActionDescription: "Inspect the ledger and trace context before deciding whether this signal is worth another pass.",
        evidenceDrivers,
        warningFactors,
        researchNote: "Live-readiness remains gated outside this research summary.",
    };
};
