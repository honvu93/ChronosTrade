import { EngineOverview } from "@/types/engine";
import { ExecutionConfigView, GeneratedBacktestDetail } from "@/types/signals";

type ComparisonTone = "positive" | "negative" | "neutral";
type EvidenceState = "baseline" | "constructive" | "weaker" | "suspicious";

export interface BacktestComparisonMetric {
    label: string;
    value: string;
    delta: string | null;
    tone: ComparisonTone;
}

export interface BacktestRunComparisonEntry {
    runId: string;
    runName: string;
    signalLabel: string;
    contextLabel: string;
    evidenceLabel: string;
    evidenceState: EvidenceState;
    warnings: string[];
    executionSummary: string;
    parameterSummary: string;
    exitProfileCode: string | null;
    compositeScore: number;
    metrics: BacktestComparisonMetric[];
}

const formatNumber = (value: number, digits = 2) => value.toFixed(digits);
const formatPercent = (value: number) => `${value.toFixed(2)}%`;
const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;

const describeMode = (mode: string, value: number | null | undefined) => {
    if (mode === "SIGNAL_PRICE") return "Strategy default";
    if (mode === "FIXED_AMOUNT") return `Fixed $${value ?? 0}`;
    if (mode === "ACCOUNT_PERCENT") return `${value ?? 0}% account`;
    if (mode === "R_MULTIPLE") return `${value ?? 0}R`;
    if (mode === "FIXED_QUANTITY") return `Qty ${value ?? 0}`;
    if (mode === "RISK_BASED") return "Risk based";
    return mode;
};

const summarizeExecution = (config: ExecutionConfigView | null) => {
    if (!config) return "Strategy defaults";

    return [
        `SL ${describeMode(config.stopLoss.mode, config.stopLoss.value)}`,
        `TP ${describeMode(config.takeProfit.mode, config.takeProfit.value)}`,
        `Size ${describeMode(config.positionSizing.mode, config.positionSizing.value)}`,
    ].join(" | ");
};

const summarizeParameters = (parameters: Record<string, unknown> | null) => {
    if (!parameters) return "No parameter overrides";

    const entries = Object.entries(parameters);
    if (entries.length === 0) return "No parameter overrides";

    const preview = entries.slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`);
    return `${preview.join(" | ")}${entries.length > 3 ? ` | +${entries.length - 3} more` : ""}`;
};

const extractExitProfileCode = (params: Record<string, unknown> | null): string | null => {
    if (!params) return null;
    const exitStrategy = params.exitStrategy;
    return typeof exitStrategy === "string" ? exitStrategy : null;
};

/**
 * Composite score for exit profile comparison ranking.
 * Higher = better. Weights: win rate (30%), profit factor (30%), expectancy (20%), drawdown (20%).
 */
const computeCompositeScore = (metrics: {
    winRate: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdownPct: number;
}): number => {
    const wrScore = Math.min(metrics.winRate / 100, 1);
    const pfScore = Math.min(metrics.profitFactor / 3, 1);
    const expScore = Math.max(0, Math.min((metrics.expectancy + 1) / 2, 1));
    const ddScore = Math.max(0, 1 - Math.abs(metrics.maxDrawdownPct) / 30);
    return Number((wrScore * 0.3 + pfScore * 0.3 + expScore * 0.2 + ddScore * 0.2).toFixed(4));
};

const getOverviewMetrics = (overview: EngineOverview | null, run: GeneratedBacktestDetail) => ({
    signalCount: overview?.metrics.signalCount ?? run.counts.signals,
    totalTrades: overview?.metrics.totalTrades ?? run.counts.results,
    closedTrades: overview?.metrics.closedTrades ?? run.counts.results,
    openTrades: overview?.metrics.openTrades ?? 0,
    winRate: overview?.metrics.winRate ?? 0,
    profitFactor: overview?.metrics.profitFactor ?? 0,
    expectancy: overview?.metrics.expectancy ?? 0,
    netR: overview?.metrics.netR ?? 0,
    netUsd: overview?.metrics.netUsd ?? 0,
    maxDrawdownPct: overview?.metrics.maxDrawdownPct ?? 0,
});

const getEvidenceState = ({
    run,
    overview,
    isBaseline,
}: {
    run: GeneratedBacktestDetail;
    overview: EngineOverview | null;
    isBaseline: boolean;
}) => {
    if (isBaseline) {
        return {
            label: "Baseline",
            state: "baseline" as const,
            warnings: [] as string[],
        };
    }

    const metrics = getOverviewMetrics(overview, run);
    const warnings: string[] = [];

    if (run.status !== "COMPLETED") {
        warnings.push(`Run status is ${run.status.toLowerCase()}, so the comparison is not final.`);
    }

    if (metrics.closedTrades < 5) {
        warnings.push(`Only ${metrics.closedTrades} closed trades are available in this run.`);
    }

    if (metrics.netR < 0) {
        warnings.push(`Net R is ${formatSigned(metrics.netR, "R")} versus the current baseline.`);
    }

    if (metrics.profitFactor > 0 && metrics.profitFactor < 1) {
        warnings.push(`Profit factor is ${formatNumber(metrics.profitFactor)}, which suggests losses still outweigh gains.`);
    }

    if (metrics.maxDrawdownPct <= -15) {
        warnings.push(`Drawdown reached ${formatPercent(metrics.maxDrawdownPct)}, which is suspicious for robustness.`);
    }

    if (metrics.openTrades > 0) {
        warnings.push(`${metrics.openTrades} trade${metrics.openTrades === 1 ? "" : "s"} remained open at the end of the reviewed range.`);
    }

    if (run.status !== "COMPLETED" || metrics.netR < 0 || metrics.profitFactor < 1 || metrics.maxDrawdownPct <= -15) {
        return {
            label: "Suspicious",
            state: "suspicious" as const,
            warnings,
        };
    }

    if (metrics.closedTrades < 5 || metrics.profitFactor < 1.2 || metrics.openTrades > 0) {
        return {
            label: "Weaker Evidence",
            state: "weaker" as const,
            warnings,
        };
    }

    return {
        label: "Constructive",
        state: "constructive" as const,
        warnings,
    };
};

const buildMetric = ({
    label,
    value,
    baselineValue,
    suffix = "",
    digits = 2,
}: {
    label: string;
    value: number;
    baselineValue: number | null;
    suffix?: string;
    digits?: number;
}): BacktestComparisonMetric => {
    const deltaValue = baselineValue === null ? null : value - baselineValue;
    const tone = deltaValue === null
        ? "neutral"
        : deltaValue > 0 ? "positive" : deltaValue < 0 ? "negative" : "neutral";

    return {
        label,
        value: `${formatNumber(value, digits)}${suffix}`,
        delta: deltaValue === null ? null : `${deltaValue >= 0 ? "+" : ""}${deltaValue.toFixed(digits)}${suffix} vs baseline`,
        tone,
    };
};

export const parseBacktestComparisonSearchParam = (value: string | null) => {
    if (!value) return [];

    return Array.from(
        new Set(
            value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    );
};

export const buildBacktestComparisonSearchParam = (ids: string[]) => {
    const unique = Array.from(new Set(ids.map((item) => item.trim()).filter(Boolean)));
    return unique.length > 0 ? unique.join(",") : null;
};

export const buildBacktestRunComparisonEntries = ({
    baselineRun,
    baselineOverview,
    comparedRuns,
}: {
    baselineRun: GeneratedBacktestDetail | null;
    baselineOverview: EngineOverview | null;
    comparedRuns: Array<{
        run: GeneratedBacktestDetail;
        overview: EngineOverview | null;
    }>;
}) => {
    if (!baselineRun) return [];

    const baselineMetrics = getOverviewMetrics(baselineOverview, baselineRun);
    const allRuns = [{ run: baselineRun, overview: baselineOverview }, ...comparedRuns];

    return allRuns.map(({ run, overview }, index) => {
        const metrics = getOverviewMetrics(overview, run);
        const evidence = getEvidenceState({
            run,
            overview,
            isBaseline: index === 0,
        });

        return {
            runId: run.id,
            runName: run.name,
            signalLabel: `${run.signalCode}@${run.signalVersion}`,
            contextLabel: `${run.symbol} | ${run.timeframe} | ${run.startedAt.slice(0, 10)} to ${run.finishedAt?.slice(0, 10) ?? "open"}`,
            evidenceLabel: evidence.label,
            evidenceState: evidence.state,
            warnings: evidence.warnings,
            executionSummary: summarizeExecution(run.executionConfigJson),
            parameterSummary: summarizeParameters(run.parametersJson),
            exitProfileCode: extractExitProfileCode(run.parametersJson),
            compositeScore: computeCompositeScore(metrics),
            metrics: [
                buildMetric({ label: "Trades", value: metrics.totalTrades, baselineValue: index === 0 ? null : baselineMetrics.totalTrades, digits: 0 }),
                buildMetric({ label: "Signal Count", value: metrics.signalCount, baselineValue: index === 0 ? null : baselineMetrics.signalCount, digits: 0 }),
                buildMetric({ label: "Win Rate", value: metrics.winRate, baselineValue: index === 0 ? null : baselineMetrics.winRate, suffix: "%" }),
                buildMetric({ label: "Net R", value: metrics.netR, baselineValue: index === 0 ? null : baselineMetrics.netR, suffix: "R" }),
                buildMetric({ label: "Profit Factor", value: metrics.profitFactor, baselineValue: index === 0 ? null : baselineMetrics.profitFactor }),
                buildMetric({ label: "Expectancy", value: metrics.expectancy, baselineValue: index === 0 ? null : baselineMetrics.expectancy, suffix: "R" }),
                buildMetric({ label: "Net USD", value: metrics.netUsd, baselineValue: index === 0 ? null : baselineMetrics.netUsd }),
                buildMetric({ label: "Max DD", value: metrics.maxDrawdownPct, baselineValue: index === 0 ? null : baselineMetrics.maxDrawdownPct, suffix: "%" }),
            ],
        };
    });
};
