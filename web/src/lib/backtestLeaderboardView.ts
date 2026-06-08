import {
    BacktestLeaderboardCautionState,
    BacktestLeaderboardRow,
} from "@/types/engine";
import { buildBacktestComparisonSearchParam } from "@/lib/backtestRunComparison";

const formatDate = (value: string | null) => (value ? value.slice(0, 10) : "Open");

const cautionLabelMap: Record<BacktestLeaderboardCautionState, string> = {
    constructive: "Constructive",
    weaker: "Weaker Evidence",
    suspicious: "Suspicious",
};

const cautionToneMap: Record<BacktestLeaderboardCautionState, string> = {
    constructive: "border-price-up/25 bg-price-up/10 text-price-up",
    weaker: "border-accent/25 bg-accent/10 text-accent",
    suspicious: "border-price-down/25 bg-price-down/10 text-price-down",
};

const statusToneMap: Record<BacktestLeaderboardRow["status"], string> = {
    COMPLETED: "border-price-up/25 bg-price-up/10 text-price-up",
    RUNNING: "border-accent/25 bg-accent/10 text-accent",
    PENDING: "border-accent/25 bg-accent/10 text-accent",
    FAILED: "border-price-down/25 bg-price-down/10 text-price-down",
    CANCELED: "border-border-muted bg-bg-tertiary text-text-secondary",
};

const cloneParams = (params: URLSearchParams) => new URLSearchParams(params.toString());

export interface BacktestLeaderboardRowView {
    signalIdentity: string;
    windowLabel: string;
    cautionLabel: string;
    cautionTone: string;
    statusTone: string;
    reportHref: string;
    detailHref: string;
    compareHref: string | null;
}

export const buildBacktestLeaderboardRowView = (
    row: BacktestLeaderboardRow,
    {
        reportBasePath,
        reportSearchParams,
        selectedRunId,
    }: {
        reportBasePath: string;
        reportSearchParams: URLSearchParams;
        selectedRunId: string;
    },
): BacktestLeaderboardRowView => {
    const reportParams = cloneParams(reportSearchParams);
    reportParams.set("backtestRunId", row.runId);
    reportParams.delete("run");
    reportParams.delete("signalId");
    reportParams.delete("signal");

    const reportQuery = reportParams.toString();
    const compareQuery = selectedRunId && selectedRunId !== row.runId
        ? (() => {
            const params = new URLSearchParams();
            const compare = buildBacktestComparisonSearchParam([row.runId]);
            if (compare) {
                params.set("compare", compare);
            }
            return params.toString();
        })()
        : null;

    return {
        signalIdentity: row.signalCode
            ? `${row.signalCode}@${row.signalVersion ?? "?"}`
            : row.signalLabel,
        windowLabel: `${formatDate(row.startedAt)} to ${formatDate(row.finishedAt)}`,
        cautionLabel: cautionLabelMap[row.cautionState],
        cautionTone: cautionToneMap[row.cautionState],
        statusTone: statusToneMap[row.status],
        reportHref: reportQuery ? `${reportBasePath}?${reportQuery}` : reportBasePath,
        detailHref: `/signals/backtests/${row.runId}`,
        compareHref: compareQuery ? `/signals/backtests/${selectedRunId}?${compareQuery}` : null,
    };
};
