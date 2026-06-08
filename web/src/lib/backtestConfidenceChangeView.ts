import { BacktestTradeSummary } from "@/types/backtests";
import { EngineOverview } from "@/types/engine";
import { GeneratedBacktestDetail } from "@/types/signals";
import { BacktestDataQualityViewModel } from "@/lib/backtestDataQualityView";
import { BacktestValidationViewModel } from "@/lib/backtestValidationView";

export type BacktestConfidenceShiftState = "positive-shift" | "neutral" | "negative-shift";
export type BacktestPromotionReadinessState = "draft" | "validated" | "blocked" | "live-eligible";
export type BacktestConfidenceActionKind = "return-to-signals" | "compare-runs" | "open-reports";

export interface BacktestConfidenceChangeViewModel {
    confidenceLabel: string;
    confidenceState: BacktestConfidenceShiftState;
    narrative: string;
    promotionLabel: string;
    promotionState: BacktestPromotionReadinessState;
    permissionSummary: string;
    nextActionKind: BacktestConfidenceActionKind;
    nextActionLabel: string;
    nextActionDescription: string;
}

const STRONG_SAMPLE_THRESHOLD = 10;
const MIN_VALIDATED_SAMPLE = 5;
const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;

const getMetrics = ({
    runDetail,
    tradeSummary,
    overview,
}: {
    runDetail: GeneratedBacktestDetail | null;
    tradeSummary: BacktestTradeSummary | null;
    overview: EngineOverview | null;
}) => ({
    totalTrades: tradeSummary?.totalTrades ?? overview?.metrics.totalTrades ?? runDetail?.counts.results ?? 0,
    closedTrades: tradeSummary?.closedTrades ?? overview?.metrics.closedTrades ?? 0,
    openTrades: tradeSummary?.openTrades ?? overview?.metrics.openTrades ?? 0,
    netR: overview?.metrics.netR ?? tradeSummary?.netR ?? 0,
    profitFactor: overview?.metrics.profitFactor ?? 0,
    maxDrawdownPct: overview?.metrics.maxDrawdownPct ?? 0,
});

export const buildBacktestConfidenceChangeView = ({
    runDetail,
    tradeSummary,
    overview,
    validation,
    dataQuality,
}: {
    runDetail: GeneratedBacktestDetail | null;
    tradeSummary: BacktestTradeSummary | null;
    overview: EngineOverview | null;
    validation: BacktestValidationViewModel;
    dataQuality: BacktestDataQualityViewModel;
}): BacktestConfidenceChangeViewModel => {
    if (!runDetail) {
        return {
            confidenceLabel: "Confidence Still Insufficient",
            confidenceState: "neutral",
            narrative: "The validation outcome is still loading, so confidence should stay provisional until the run context is available.",
            promotionLabel: "Draft",
            promotionState: "draft",
            permissionSummary: "Research only until the validation context finishes loading.",
            nextActionKind: "return-to-signals",
            nextActionLabel: "Return To Signals",
            nextActionDescription: "Reopen the research workflow after the run context loads.",
        };
    }

    const metrics = getMetrics({ runDetail, tradeSummary, overview });
    const hasDataQualityRisk = dataQuality.state === "caution" || dataQuality.state === "blocked";
    const hasStrongPerformance = metrics.netR > 0 && metrics.profitFactor >= 1.2 && metrics.maxDrawdownPct > -10;
    const isLiveEligible = (
        !hasDataQualityRisk
        && validation.tone === "positive"
        && metrics.closedTrades >= STRONG_SAMPLE_THRESHOLD
        && metrics.openTrades === 0
        && metrics.netR > 0
        && metrics.profitFactor >= 1.5
        && metrics.maxDrawdownPct > -8
    );

    if (validation.tone === "blocked" || dataQuality.state === "blocked" || dataQuality.state === "caution" || metrics.netR <= 0 || metrics.profitFactor < 1 || metrics.maxDrawdownPct <= -15) {
        const blockingReason = dataQuality.warnings[0]
            ?? validation.warningFactors[0]
            ?? "blocking validation concerns remain unresolved";

        return {
            confidenceLabel: "Confidence Decreased",
            confidenceState: "negative-shift",
            narrative: `Confidence decreased because ${blockingReason.charAt(0).toLowerCase()}${blockingReason.slice(1)} This result should not be treated as promotion-ready evidence.`,
            promotionLabel: "Blocked",
            promotionState: "blocked",
            permissionSummary: "Promotion is blocked until the data-quality or performance issues are resolved.",
            nextActionKind: "return-to-signals",
            nextActionLabel: "Stop And Refine",
            nextActionDescription: "Return to the signal workflow and resolve the blocking issues before you rerun validation.",
        };
    }

    if (runDetail.status !== "COMPLETED" || validation.tone === "progress" || metrics.totalTrades === 0 || metrics.closedTrades < MIN_VALIDATED_SAMPLE) {
        return {
            confidenceLabel: "Confidence Still Insufficient",
            confidenceState: "neutral",
            narrative: `Confidence remains insufficient because only ${metrics.closedTrades} closed trade${metrics.closedTrades === 1 ? "" : "s"} are available, so the sample is still too thin to justify a stronger state.`,
            promotionLabel: "Draft",
            promotionState: "draft",
            permissionSummary: "The signal stays in draft research state until broader evidence is collected.",
            nextActionKind: "return-to-signals",
            nextActionLabel: "Refine Signal",
            nextActionDescription: "Adjust the setup or rerun the backtest before you treat this as validated evidence.",
        };
    }

    if (isLiveEligible) {
        return {
            confidenceLabel: "Confidence Increased",
            confidenceState: "positive-shift",
            narrative: `Confidence increased because the run closed ${metrics.closedTrades} trades at ${formatSigned(metrics.netR, "R")} with profit factor ${metrics.profitFactor.toFixed(2)} and no blocking data-quality warning. The result is strong enough to mark this signal live-eligible inside research review.`,
            promotionLabel: "Live-Eligible",
            promotionState: "live-eligible",
            permissionSummary: "Promotion review is available, but actual live activation still remains gated to the later Trading workflow.",
            nextActionKind: "open-reports",
            nextActionLabel: "Open Promotion Report",
            nextActionDescription: "Review the explainable report before you carry this signal toward live-readiness decisions.",
        };
    }

    if (hasStrongPerformance) {
        return {
            confidenceLabel: "Confidence Increased",
            confidenceState: "positive-shift",
            narrative: `Confidence increased because the run is constructive at ${formatSigned(metrics.netR, "R")} with profit factor ${metrics.profitFactor.toFixed(2)}, but it still needs broader comparison evidence before it should be marked live-eligible.`,
            promotionLabel: "Validated",
            promotionState: "validated",
            permissionSummary: "The signal can stay validated in research, but promotion should wait until comparison evidence is stronger.",
            nextActionKind: "compare-runs",
            nextActionLabel: "Compare Runs",
            nextActionDescription: "Check whether the same signal stays constructive across more windows before you promote anything.",
        };
    }

    return {
        confidenceLabel: "Confidence Still Insufficient",
        confidenceState: "neutral",
        narrative: "Confidence has not improved enough to change the research decision, so the signal should stay draft until stronger evidence or clearer failure signals appear.",
        promotionLabel: "Draft",
        promotionState: "draft",
        permissionSummary: "Research can continue, but there is not enough evidence yet to treat the signal as validated.",
        nextActionKind: "return-to-signals",
        nextActionLabel: "Refine Signal",
        nextActionDescription: "Return to the signal workflow and improve the setup before you rerun or compare results.",
    };
};
