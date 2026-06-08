import { BacktestTradeRow } from "@/types/backtests";
import { GeneratedBacktestDetail } from "@/types/signals";

export interface BacktestTradeDrawerContext {
    runId: string;
    runName: string;
    signalLabel: string;
    signalId: string;
    rowId: string;
}

const toUtcRangeStart = (value: string) => `${value}T00:00:00.000Z`;
const toUtcRangeEnd = (value: string) => `${value}T23:59:59.999Z`;

export const buildBacktestTradeEngineHref = ({
    runId,
    row,
    fromDate,
    toDate,
}: {
    runId: string;
    row: BacktestTradeRow | null;
    fromDate: string;
    toDate: string;
}) => {
    if (!row) return `/engine?run=${runId}`;

    const params = new URLSearchParams({
        run: runId,
        signalId: row.signalId,
        symbol: row.symbol,
        tf: row.timeframe,
        side: row.side,
        session: row.session,
        exitRuleId: row.exitRuleId,
        ...(fromDate ? { from: toUtcRangeStart(fromDate) } : {}),
        ...(toDate ? { to: toUtcRangeEnd(toDate) } : {}),
    });

    return `/engine?${params.toString()}`;
};

export const buildBacktestTradeDrawerContext = ({
    row,
    runDetail,
}: {
    row: BacktestTradeRow | null;
    runDetail: GeneratedBacktestDetail | null;
}): BacktestTradeDrawerContext | null => {
    if (!row) return null;

    return {
        runId: runDetail?.id ?? row.backtestRunId,
        runName: runDetail?.name ?? `Run ${row.backtestRunId}`,
        signalLabel: runDetail ? `${runDetail.signalCode}@${runDetail.signalVersion}` : "Generated signal",
        signalId: row.signalId,
        rowId: row.rowId,
    };
};
