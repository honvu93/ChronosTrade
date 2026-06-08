"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, ArrowRight, BarChart3, Download, FileSpreadsheet, Filter, Layers3, Loader2, Sigma } from "lucide-react";
import {
    EngineOverview,
    EngineRun,
    SignalReviewRow,
    EngineStrategy,
    ExitComparisonRow,
    SessionBreakdownRow,
    StrategyBreakdownRow,
} from "@/types/engine";
import { BacktestSignalEvent, BacktestSignalTrace, BacktestTradeHistoryResponse } from "@/types/backtests";
import { GeneratedBacktestDetail } from "@/types/signals";
import {
    buildBacktestExplainableReportView,
    buildBacktestValidationArtifact,
} from "@/lib/backtestExplainableReportView";
import {
    buildReportsWorkspaceViewState,
    resolveReportsWorkspaceActiveRunId,
    resolveReportsWorkspaceCatalogRun,
} from "@/lib/reportsWorkspaceState";
import BacktestLeaderboardPanel from "@/components/reports/BacktestLeaderboardPanel";
import MetricCard from "@/components/ui/MetricCard";
import StateBanner from "@/components/ui/StateBanner";

const sideFilters = [
    { label: "ALL", value: "ALL" },
    { label: "LONG", value: "LONG" },
    { label: "SHORT", value: "SHORT" },
] as const;

const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const formatDateInput = (value: string | null) => (value ? value.slice(0, 10) : "");
const toUtcRangeStart = (value: string) => `${value}T00:00:00.000Z`;
const toUtcRangeEnd = (value: string) => `${value}T23:59:59.999Z`;

const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}`);
    }
    return response.json();
};

const csvEscape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
};

const downloadCsv = <T extends object>(filename: string, rows: T[]) => {
    if (rows.length === 0) return;

    const headers = Object.keys(rows[0] as object);
    const lines = [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => csvEscape((row as Record<string, unknown>)[header])).join(",")),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const downloadJson = (filename: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const toFileSlug = (value: string) => value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function ReportsWorkspace() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const requestedRunId = searchParams.get("backtestRunId") || searchParams.get("run") || "";
    const requestedSignalId = searchParams.get("signalId") || searchParams.get("signal") || "";
    const [runs, setRuns] = useState<EngineRun[]>([]);
    const [strategies, setStrategies] = useState<EngineStrategy[]>([]);
    const [selectedRunId, setSelectedRunId] = useState<string>("");
    const [side, setSide] = useState<"ALL" | "LONG" | "SHORT">("ALL");
    const [selectedStrategyId, setSelectedStrategyId] = useState<string>("ALL");
    const [selectedSession, setSelectedSession] = useState<"ALL" | "ASIAN" | "LONDON" | "NY">("ALL");
    const [fromDate, setFromDate] = useState<string>("");
    const [toDate, setToDate] = useState<string>("");
    const [overview, setOverview] = useState<EngineOverview | null>(null);
    const [runDetail, setRunDetail] = useState<GeneratedBacktestDetail | null>(null);
    const [signalReviewRows, setSignalReviewRows] = useState<SignalReviewRow[]>([]);
    const [selectedSignalId, setSelectedSignalId] = useState<string>("");
    const [signalEvents, setSignalEvents] = useState<BacktestSignalEvent[]>([]);
    const [signalTraces, setSignalTraces] = useState<BacktestSignalTrace[]>([]);
    const [byStrategy, setByStrategy] = useState<StrategyBreakdownRow[]>([]);
    const [bySession, setBySession] = useState<SessionBreakdownRow[]>([]);
    const [exitComparison, setExitComparison] = useState<ExitComparisonRow[]>([]);
    const [isCatalogLoading, setIsCatalogLoading] = useState(true);
    const [isReportLoading, setIsReportLoading] = useState(false);
    const [isEvidenceLoading, setIsEvidenceLoading] = useState(false);
    const [isTradeExporting, setIsTradeExporting] = useState(false);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [reportError, setReportError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [evidenceError, setEvidenceError] = useState<string | null>(null);

    const replaceQuery = (updates: Record<string, string | null>) => {
        const next = new URLSearchParams(Array.from(searchParams.entries()));
        Object.entries(updates).forEach(([key, value]) => {
            if (!value) {
                next.delete(key);
                return;
            }
            next.set(key, value);
        });

        const query = next.toString();
        startTransition(() => {
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        });
    };

    const activeRunId = resolveReportsWorkspaceActiveRunId({
        runs,
        requestedRunId,
        selectedRunId,
    });
    const shouldApplyDateWindow = !requestedRunId || requestedRunId === selectedRunId;

    const reportParams = useMemo(() => {
        const params = new URLSearchParams();
        if (activeRunId) {
            params.set("backtestRunId", activeRunId);
        }
        if (side !== "ALL") {
            params.set("side", side);
        }
        if (selectedStrategyId !== "ALL") {
            params.set("strategyId", selectedStrategyId);
        }
        if (selectedSession !== "ALL") {
            params.set("session", selectedSession);
        }
        if (fromDate && shouldApplyDateWindow) {
            params.set("from", toUtcRangeStart(fromDate));
        }
        if (toDate && shouldApplyDateWindow) {
            params.set("to", toUtcRangeEnd(toDate));
        }

        return params;
    }, [activeRunId, fromDate, selectedSession, selectedStrategyId, shouldApplyDateWindow, side, toDate]);

    useEffect(() => {
        let active = true;
        setCatalogError(null);
        setIsCatalogLoading(true);

        if (requestedRunId) {
            setSelectedRunId(requestedRunId);
            setSelectedSignalId("");
            setFromDate("");
            setToDate("");
        }

        const runCatalogParams = new URLSearchParams();
        if (requestedRunId) {
            runCatalogParams.set("includeId", requestedRunId);
        }

        const runCatalogQuery = runCatalogParams.toString();

        Promise.allSettled([
            fetchJson<{ data: EngineRun[] }>(`${apiUrl}/api/engine/runs${runCatalogQuery ? `?${runCatalogQuery}` : ""}`),
            fetchJson<{ data: EngineStrategy[] }>(`${apiUrl}/api/engine/strategies`),
        ])
            .then(([runsResult, strategyResult]) => {
                if (!active) return;

                const nextRuns = runsResult.status === "fulfilled" ? runsResult.value.data : [];
                const nextStrategies = strategyResult.status === "fulfilled" ? strategyResult.value.data : [];
                const errors = [
                    runsResult.status === "rejected" ? runsResult.reason : null,
                    strategyResult.status === "rejected" ? strategyResult.reason : null,
                ]
                    .filter(Boolean)
                    .map((error) => (error instanceof Error ? error.message : "Failed to load reports bootstrap data"));

                setRuns(nextRuns);
                setStrategies(nextStrategies);

                const nextCatalogRun = resolveReportsWorkspaceCatalogRun({
                    runs: nextRuns,
                    requestedRunId,
                    selectedRunId,
                });

                if (nextCatalogRun) {
                    setSelectedRunId(nextCatalogRun.id);
                    setFromDate(formatDateInput(nextCatalogRun.startedAt));
                    setToDate(formatDateInput(nextCatalogRun.finishedAt || nextCatalogRun.createdAt));
                } else if (requestedRunId) {
                    setSelectedRunId(requestedRunId);
                    setFromDate("");
                    setToDate("");
                } else {
                    setSelectedRunId("");
                    setFromDate("");
                    setToDate("");
                }

                setCatalogError(errors.length > 0 ? errors.join(" ") : null);
            })
            .finally(() => {
                if (!active) return;
                setIsCatalogLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, requestedRunId]);

    useEffect(() => {
        if (!activeRunId) {
            setOverview(null);
            setRunDetail(null);
            setSignalReviewRows([]);
            setByStrategy([]);
            setBySession([]);
            setExitComparison([]);
            setSelectedSignalId("");
            setReportError(null);
            setIsReportLoading(false);
            return;
        }

        let active = true;
        const params = reportParams.toString();
        setReportError(null);
        setIsReportLoading(true);
        setOverview(null);
        setRunDetail(null);
        setSignalReviewRows([]);
        setByStrategy([]);
        setBySession([]);
        setExitComparison([]);

        Promise.all([
            fetchJson<{ data: EngineOverview }>(`${apiUrl}/api/engine/overview?${params}`),
            fetchJson<{ data: StrategyBreakdownRow[] }>(`${apiUrl}/api/engine/by-strategy?${params}`),
            fetchJson<{ data: SessionBreakdownRow[] }>(`${apiUrl}/api/engine/sessions?${params}`),
            fetchJson<{ data: ExitComparisonRow[] }>(`${apiUrl}/api/engine/exit-comparison?${params}`),
            fetchJson<{ data: SignalReviewRow[] }>(`${apiUrl}/api/engine/signals-review?${params}`),
            fetchJson<{ data: GeneratedBacktestDetail }>(`${apiUrl}/api/signals/backtests/${activeRunId}`)
                .then((result) => result.data)
                .catch(() => null),
        ])
            .then(([overviewResult, strategyResult, sessionResult, exitResult, signalReviewResult, optionalRunDetail]) => {
                if (!active) return;
                setOverview(overviewResult.data);
                setByStrategy(strategyResult.data);
                setBySession(sessionResult.data);
                setExitComparison(exitResult.data);
                setRunDetail(optionalRunDetail);
                setSignalReviewRows(signalReviewResult.data);
                setSelectedSignalId((current) => {
                    if (requestedSignalId && signalReviewResult.data.some((row) => row.signalId === requestedSignalId)) {
                        return requestedSignalId;
                    }
                    if (signalReviewResult.data.some((row) => row.signalId === current)) {
                        return current;
                    }
                    return signalReviewResult.data[0]?.signalId ?? "";
                });
            })
            .catch((err) => {
                if (!active) return;
                setReportError(err instanceof Error ? err.message : "Failed to load report data");
                setOverview(null);
                setRunDetail(null);
                setSignalReviewRows([]);
                setByStrategy([]);
                setBySession([]);
                setExitComparison([]);
                setSelectedSignalId("");
            })
            .finally(() => {
                if (!active) return;
                setIsReportLoading(false);
            });

        return () => {
            active = false;
        };
    }, [activeRunId, apiUrl, reportParams, requestedSignalId]);

    const selectedRun = useMemo(
        () => resolveReportsWorkspaceCatalogRun({
            runs,
            requestedRunId,
            selectedRunId,
        }),
        [requestedRunId, runs, selectedRunId]
    );

    const workspaceViewState = buildReportsWorkspaceViewState({
        catalogError,
        isCatalogLoading,
        activeRunId,
    });

    const hasActiveRunOption = useMemo(
        () => (activeRunId ? runs.some((run) => run.id === activeRunId) : false),
        [activeRunId, runs],
    );

    const selectedSignal = useMemo(
        () => signalReviewRows.find((row) => row.signalId === selectedSignalId) ?? null,
        [selectedSignalId, signalReviewRows],
    );

    useEffect(() => {
        if (!activeRunId || !selectedSignalId || !runDetail) {
            setSignalEvents([]);
            setSignalTraces([]);
            setEvidenceError(null);
            setIsEvidenceLoading(false);
            return;
        }

        let active = true;
        setIsEvidenceLoading(true);
        setEvidenceError(null);

        Promise.all([
            fetchJson<{ data: BacktestSignalEvent[] }>(`${apiUrl}/api/signals/backtests/${activeRunId}/events?signalId=${encodeURIComponent(selectedSignalId)}`),
            fetchJson<{ data: BacktestSignalTrace[] }>(`${apiUrl}/api/signals/backtests/${activeRunId}/trace?signalId=${encodeURIComponent(selectedSignalId)}`),
        ])
            .then(([eventsResult, tracesResult]) => {
                if (!active) return;
                setSignalEvents(eventsResult.data);
                setSignalTraces(tracesResult.data);
            })
            .catch((fetchError) => {
                if (!active) return;
                setEvidenceError(fetchError instanceof Error ? fetchError.message : "Failed to load explainable evidence");
                setSignalEvents([]);
                setSignalTraces([]);
            })
            .finally(() => {
                if (!active) return;
                setIsEvidenceLoading(false);
            });

        return () => {
            active = false;
        };
    }, [activeRunId, apiUrl, runDetail, selectedSignalId]);

    const explainableReport = useMemo(
        () => buildBacktestExplainableReportView({
            runDetail,
            signal: selectedSignal,
            events: signalEvents,
            traces: signalTraces,
        }),
        [runDetail, selectedSignal, signalEvents, signalTraces],
    );

    const contextLine = useMemo(() => {
        if (!overview?.context) return "No report selected";
        return [
            overview.metrics.signalCount > 0 ? `${overview.metrics.signalCount} signals` : null,
            runDetail ? `${runDetail.signalCode}@${runDetail.signalVersion}` : null,
            `Equity $${overview.context.initialEquity.toLocaleString()}`,
            `Risk ${overview.context.riskPercent}%`,
            overview.context.strategyCode ? `Strategy ${overview.context.strategyCode}` : null,
            fromDate && toDate ? `UTC ${fromDate} to ${toDate}` : null,
        ].filter(Boolean).join(" | ");
    }, [fromDate, overview, runDetail, toDate]);

    const overviewExportRows = useMemo(() => {
        if (!overview?.context) return [];

        return [{
            runId: overview.context.id,
            runName: overview.context.name,
            signalCode: runDetail?.signalCode ?? "",
            signalVersion: runDetail?.signalVersion ?? "",
            symbol: overview.context.symbol,
            timeframe: overview.context.timeframe,
            strategyCode: overview.context.strategyCode ?? "",
            side: overview.context.side ?? "",
            fromDate,
            toDate,
            signalCount: overview.metrics.signalCount,
            totalTrades: overview.metrics.totalTrades,
            closedTrades: overview.metrics.closedTrades,
            openTrades: overview.metrics.openTrades,
            wins: overview.metrics.wins,
            losses: overview.metrics.losses,
            winRate: overview.metrics.winRate,
            profitFactor: overview.metrics.profitFactor,
            expectancy: overview.metrics.expectancy,
            netR: overview.metrics.netR,
            netUsd: overview.metrics.netUsd,
            maxConsecutiveLoss: overview.metrics.maxConsecutiveLoss,
            maxDrawdownPct: overview.metrics.maxDrawdownPct,
        }];
    }, [fromDate, overview, runDetail, toDate]);

    const signalReviewExportRows = useMemo(() => (
        signalReviewRows.map((row) => ({
            backtestRunId: row.backtestRunId,
            backtestRunName: row.backtestRunName ?? runDetail?.name ?? "",
            signalId: row.signalId,
            signalCode: runDetail?.signalCode ?? "",
            signalVersion: runDetail?.signalVersion ?? "",
            strategyCode: row.strategyCode,
            strategyName: row.strategyName,
            symbol: row.symbol,
            timeframe: row.timeframe,
            side: row.side,
            session: row.session,
            entryTime: row.entryTime,
            entryPrice: row.entryPrice,
            stopLoss: row.stopLoss,
            takeProfit1: row.takeProfit1 ?? "",
            takeProfit2: row.takeProfit2 ?? "",
            resultCount: row.resultCount,
            wins: row.wins,
            losses: row.losses,
            openResults: row.openResults,
            netR: row.netR,
            avgR: row.avgR,
            bestExitRuleCode: row.bestExitRuleCode ?? "",
            bestExitRuleName: row.bestExitRuleName ?? "",
            latestExitTime: row.latestExitTime ?? "",
            notes: row.notes ?? "",
        }))
    ), [runDetail, signalReviewRows]);

    const byStrategyExportRows = useMemo(() => (
        byStrategy.map((row) => ({
            backtestRunId: activeRunId,
            runName: selectedRun?.name ?? runDetail?.name ?? "",
            signalCode: runDetail?.signalCode ?? "",
            signalVersion: runDetail?.signalVersion ?? "",
            fromDate,
            toDate,
            side,
            session: selectedSession,
            strategyFilterId: selectedStrategyId,
            strategyId: row.strategyId,
            strategyCode: row.strategyCode,
            strategyName: row.strategyName,
            trades: row.trades,
            wins: row.wins,
            losses: row.losses,
            openTrades: row.openTrades,
            winRate: row.winRate,
            netR: row.netR,
        }))
    ), [activeRunId, byStrategy, fromDate, runDetail, selectedRun, selectedSession, selectedStrategyId, side, toDate]);

    const bySessionExportRows = useMemo(() => (
        bySession.map((row) => ({
            backtestRunId: activeRunId,
            runName: selectedRun?.name ?? runDetail?.name ?? "",
            signalCode: runDetail?.signalCode ?? "",
            signalVersion: runDetail?.signalVersion ?? "",
            fromDate,
            toDate,
            side,
            strategyFilterId: selectedStrategyId,
            session: row.session,
            trades: row.trades,
            wins: row.wins,
            losses: row.losses,
            openTrades: row.openTrades,
            winRate: row.winRate,
            netR: row.netR,
        }))
    ), [activeRunId, bySession, fromDate, runDetail, selectedRun, selectedStrategyId, side, toDate]);

    const exitComparisonExportRows = useMemo(() => (
        exitComparison.map((row) => ({
            backtestRunId: activeRunId,
            runName: selectedRun?.name ?? runDetail?.name ?? "",
            signalCode: runDetail?.signalCode ?? "",
            signalVersion: runDetail?.signalVersion ?? "",
            fromDate,
            toDate,
            side,
            session: selectedSession,
            strategyFilterId: selectedStrategyId,
            exitRuleId: row.exitRuleId,
            exitRuleCode: row.exitRuleCode,
            exitRuleName: row.exitRuleName,
            trades: row.trades,
            wins: row.wins,
            losses: row.losses,
            openTrades: row.openTrades,
            winRate: row.winRate,
            netR: row.netR,
            netUsd: row.netUsd,
            maxDrawdownPct: row.maxDrawdownPct,
            profitFactor: row.profitFactor,
            expectancy: row.expectancy,
            avgWinR: row.avgWinR,
            avgLossR: row.avgLossR,
        }))
    ), [activeRunId, exitComparison, fromDate, runDetail, selectedRun, selectedSession, selectedStrategyId, side, toDate]);

    const buildTradeExportParams = (page: number, pageSize: number) => {
        const params = new URLSearchParams(reportParams);
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        return params;
    };

    const handleExportValidationArtifact = () => {
        const artifact = buildBacktestValidationArtifact({
            runDetail,
            overview,
            selectedSignal,
            signalRows: signalReviewRows,
            events: signalEvents,
            traces: signalTraces,
            byStrategy,
            bySession,
            exitComparison,
            explainableReport,
            filters: {
                side,
                strategyId: selectedStrategyId,
                session: selectedSession,
                fromDate,
                toDate,
            },
        });

        const baseName = toFileSlug(selectedRun?.name ?? runDetail?.name ?? "validation-report");
        downloadJson(`${baseName || "validation-report"}-${activeRunId}-artifact.json`, artifact);
    };

    const handleExportTradeLog = async () => {
        if (!activeRunId) return;

        setIsTradeExporting(true);
        setActionError(null);

        try {
            const pageSize = 200;
            const firstPage = await fetchJson<{ data: BacktestTradeHistoryResponse }>(
                `${apiUrl}/api/engine/trades?${buildTradeExportParams(1, pageSize)}`,
            );
            let rows = [...firstPage.data.rows];

            for (let page = 2; page <= firstPage.data.pagination.totalPages; page += 1) {
                const nextPage = await fetchJson<{ data: BacktestTradeHistoryResponse }>(
                    `${apiUrl}/api/engine/trades?${buildTradeExportParams(page, pageSize)}`,
                );
                rows = rows.concat(nextPage.data.rows);
            }

            downloadCsv(
                `${toFileSlug(selectedRun?.name ?? runDetail?.name ?? "trade-log") || "trade-log"}-${activeRunId}.csv`,
                rows.map((row) => ({
                    backtestRunId: row.backtestRunId,
                    runName: selectedRun?.name ?? runDetail?.name ?? "",
                    signalCode: runDetail?.signalCode ?? "",
                    signalVersion: runDetail?.signalVersion ?? "",
                    signalId: row.signalId,
                    symbol: row.symbol,
                    timeframe: row.timeframe,
                    side: row.side,
                    session: row.session,
                    entryTime: row.entryTime,
                    exitTime: row.exitTime ?? "",
                    entryPrice: row.entryPrice,
                    stopLoss: row.stopLoss,
                    exitPrice: row.exitPrice ?? "",
                    pnlPct: row.pnlPct ?? "",
                    rMultiple: row.rMultiple,
                    pnlUsd: row.pnlUsd,
                    result: row.result,
                    exitRuleCode: row.exitRuleCode,
                    exitRuleName: row.exitRuleName,
                    notes: row.notes ?? "",
                })),
            );
        } catch (exportError) {
            setActionError(exportError instanceof Error ? exportError.message : "Failed to export trade log");
        } finally {
            setIsTradeExporting(false);
        }
    };

    return (
        <div className="command-deck-canvas h-full overflow-y-auto">
            <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-6 p-4 lg:p-6">
                <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.26em] text-accent">
                                <FileSpreadsheet className="h-4 w-4" />
                                Reports Workspace
                            </div>
                            <div className="mt-2 flex items-center gap-3">
                                <h1 className="text-2xl font-black tracking-tight text-text-primary">Review, compare, and export analytics runs</h1>
                                <Link
                                    href="/reports/portfolio"
                                    className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-bold text-accent transition-colors hover:bg-accent/20"
                                >
                                    <BarChart3 className="h-3 w-3" />
                                    Portfolio View
                                </Link>
                            </div>
                            <p className="mt-1 text-sm text-text-secondary">{contextLine}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <Link
                                href="/signals"
                                className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary transition-colors hover:border-accent/40"
                            >
                                Open Signals
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                            <Link
                                href={`/engine?symbol=${selectedRun?.symbol ?? "BTCUSD"}&tf=${selectedRun?.timeframe ?? "1h"}`}
                                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-bg-secondary"
                            >
                                Open Engine
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>
                    </div>
                </section>

                <BacktestLeaderboardPanel
                    apiUrl={apiUrl}
                    selectedRunId={activeRunId}
                />

                {workspaceViewState.showCatalogErrorBanner ? (
                    <StateBanner
                        tone="danger"
                        message={catalogError ?? "Run catalog unavailable"}
                    />
                ) : null}

                {activeRunId ? (
                    <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                        <label className="flex min-w-[260px] flex-col gap-1 text-xs text-text-muted">
                            Backtest run
                            <select
                                value={activeRunId}
                                disabled={runs.length === 0}
                                onChange={(event) => {
                                    setIsReportLoading(true);
                                    setSelectedSignalId("");
                                    replaceQuery({
                                        backtestRunId: event.target.value || null,
                                        run: null,
                                        signalId: null,
                                        signal: null,
                                    });
                                }}
                                className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                            >
                                {activeRunId && !hasActiveRunOption ? (
                                    <option value={activeRunId}>Loading selected run...</option>
                                ) : null}
                                {!activeRunId && runs.length === 0 ? (
                                    <option value="">No runs available</option>
                                ) : null}
                                {runs.map((run) => (
                                    <option key={run.id} value={run.id}>
                                        {run.name} / {run.symbol} / {run.timeframe}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex min-w-[220px] flex-col gap-1 text-xs text-text-muted">
                            Strategy
                            <select
                                value={selectedStrategyId}
                                onChange={(event) => {
                                    setIsReportLoading(true);
                                    setSelectedStrategyId(event.target.value);
                                }}
                                className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                            >
                                <option value="ALL">All strategies</option>
                                {strategies.map((strategy) => (
                                    <option key={strategy.id} value={strategy.id}>
                                        {strategy.code} / {strategy.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex min-w-[180px] flex-col gap-1 text-xs text-text-muted">
                            Session
                            <select
                                value={selectedSession}
                                onChange={(event) => {
                                    setIsReportLoading(true);
                                    setSelectedSession(event.target.value as "ALL" | "ASIAN" | "LONDON" | "NY");
                                }}
                                className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                            >
                                <option value="ALL">All sessions</option>
                                <option value="ASIAN">ASIAN</option>
                                <option value="LONDON">LONDON</option>
                                <option value="NY">NY</option>
                            </select>
                        </label>

                        <label className="flex min-w-[160px] flex-col gap-1 text-xs text-text-muted">
                            From (UTC)
                            <input
                                type="date"
                                value={fromDate}
                                max={toDate || undefined}
                                onChange={(event) => {
                                    setIsReportLoading(true);
                                    setFromDate(event.target.value);
                                }}
                                className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                            />
                        </label>

                        <label className="flex min-w-[160px] flex-col gap-1 text-xs text-text-muted">
                            To (UTC)
                            <input
                                type="date"
                                value={toDate}
                                min={fromDate || undefined}
                                onChange={(event) => {
                                    setIsReportLoading(true);
                                    setToDate(event.target.value);
                                }}
                                className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                            />
                        </label>

                        <div className="flex flex-col gap-1 text-xs text-text-muted">
                            Side filter
                            <div className="flex rounded-xl border border-border-muted bg-bg-tertiary p-1">
                                {sideFilters.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        onClick={() => {
                                            setIsReportLoading(true);
                                            setSide(item.value);
                                        }}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${side === item.value ? "bg-accent text-bg-secondary" : "text-text-secondary hover:text-text-primary"}`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        </div>
                    </section>
                ) : workspaceViewState.showReportSelectionEmpty ? (
                    <section className="rounded-3xl border border-border-muted bg-bg-primary p-8 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                            <Sigma className="h-6 w-6" />
                        </div>
                        <h2 className="mt-4 text-xl font-bold">Reports ready for imported runs</h2>
                        <p className="mt-2 text-sm text-text-secondary">
                            No backtest runs exist yet. Import signal and result bundles from `/signals` first.
                        </p>
                    </section>
                ) : (
                    <section className="rounded-3xl border border-price-down/20 bg-bg-primary p-8 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-price-down/10 text-price-down">
                            <Activity className="h-6 w-6" />
                        </div>
                        <h2 className="mt-4 text-xl font-bold">Run catalog unavailable</h2>
                        <p className="mt-2 text-sm text-text-secondary">
                            Leaderboard remains available while the reports bootstrap endpoint recovers.
                        </p>
                    </section>
                )}

                {activeRunId && isReportLoading ? (
                    <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-border-muted bg-bg-primary/80">
                        <Loader2 className="h-8 w-8 animate-spin text-accent" />
                    </div>
                ) : activeRunId && reportError ? (
                    <StateBanner
                        tone="danger"
                        message={reportError}
                    />
                ) : overview ? (
                    <>
                        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                            <MetricCard label="Win Rate" value={`${overview.metrics.winRate.toFixed(1)}%`} accent={overview.metrics.winRate >= 50 ? "text-price-up" : "text-price-down"} />
                            <MetricCard label="Profit Factor" value={overview.metrics.profitFactor.toFixed(2)} hint="Gross profit / gross loss" />
                            <MetricCard label="Expectancy" value={`${formatSigned(overview.metrics.expectancy, "R")}`} accent={overview.metrics.expectancy >= 0 ? "text-price-up" : "text-price-down"} />
                            <MetricCard label="Net R" value={`${formatSigned(overview.metrics.netR, "R")}`} accent={overview.metrics.netR >= 0 ? "text-price-up" : "text-price-down"} hint={`$${overview.metrics.netUsd.toFixed(0)} net`} />
                            <MetricCard label="Trades" value={`${overview.metrics.wins}W / ${overview.metrics.losses}L`} hint={`${overview.metrics.openTrades} open / ${overview.metrics.totalTrades} total`} />
                            <MetricCard label="Max Consec Loss" value={String(overview.metrics.maxConsecutiveLoss)} accent="text-price-down" hint={`${overview.metrics.maxDrawdownPct.toFixed(1)}% max DD`} />
                        </section>

                        <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                            <Activity className="h-4 w-4 text-accent" />
                                            Explainable Validation Report
                                        </div>
                                        <p className="mt-1 text-sm text-text-secondary">{explainableReport.summary}</p>
                                    </div>

                                    <label className="flex min-w-[260px] flex-col gap-1 text-xs text-text-muted">
                                        Focus signal
                                        <select
                                            value={selectedSignalId}
                                            onChange={(event) => {
                                                setSelectedSignalId(event.target.value);
                                                replaceQuery({
                                                    signalId: event.target.value || null,
                                                    signal: null,
                                                });
                                            }}
                                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                        >
                                            {signalReviewRows.length === 0 ? (
                                                <option value="">No signal evidence</option>
                                            ) : signalReviewRows.map((row) => (
                                                <option key={row.signalId} value={row.signalId}>
                                                    {row.strategyCode} / {row.symbol} / {row.session} / {formatSigned(row.netR, "R")}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                {evidenceError ? (
                                    <StateBanner
                                        tone="danger"
                                        size="compact"
                                        className="mt-4"
                                        message={evidenceError}
                                    />
                                ) : null}

                                {isEvidenceLoading ? (
                                    <div className="mt-4 grid min-h-[220px] place-items-center rounded-2xl border border-border-muted bg-bg-tertiary/35">
                                        <Loader2 className="h-8 w-8 animate-spin text-accent" />
                                    </div>
                                ) : selectedSignal ? (
                                    <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                                        <div className="space-y-4">
                                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/40 p-4">
                                                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Market Snapshot</div>
                                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                    {explainableReport.marketSnapshot.map((item) => (
                                                        <div key={item.label} className="rounded-2xl border border-border-muted bg-bg-primary/60 px-4 py-3">
                                                            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">{item.label}</div>
                                                            <div className="mt-2 text-sm font-bold text-text-primary">{item.value}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/40 p-4">
                                                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Resulting Action</div>
                                                <div className="mt-2 text-lg font-black text-text-primary">{explainableReport.resultingActionLabel}</div>
                                                <div className="mt-2 text-sm text-text-secondary">{explainableReport.resultingActionDetail}</div>
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/40 p-4">
                                                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Indicator State</div>
                                                {explainableReport.indicatorState.length > 0 ? (
                                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                        {explainableReport.indicatorState.map((item) => (
                                                            <div key={item.label} className="rounded-2xl border border-border-muted bg-bg-primary/60 px-4 py-3">
                                                                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">{item.label}</div>
                                                                <div className="mt-2 text-sm font-semibold text-text-primary">{item.value}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="mt-3 rounded-2xl border border-dashed border-border-muted bg-bg-primary/35 px-4 py-3 text-sm text-text-secondary">
                                                        No indicator snapshot was captured for the current signal selection.
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid gap-4 md:grid-cols-2">
                                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/40 p-4">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Matched Rules</div>
                                                    {explainableReport.matchedRules.length > 0 ? (
                                                        <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                                                            {explainableReport.matchedRules.map((item) => (
                                                                <li key={item} className="rounded-2xl border border-border-muted bg-bg-primary/60 px-3 py-2">
                                                                    {item}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <div className="mt-3 rounded-2xl border border-dashed border-border-muted bg-bg-primary/35 px-4 py-3 text-sm text-text-secondary">
                                                            No explicit matched rule ids were captured for this signal.
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/40 p-4">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Trace Notes</div>
                                                    {explainableReport.traceNotes.length > 0 ? (
                                                        <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                                                            {explainableReport.traceNotes.map((item) => (
                                                                <li key={item} className="rounded-2xl border border-border-muted bg-bg-primary/60 px-3 py-2">
                                                                    {item}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : (
                                                        <div className="mt-3 rounded-2xl border border-dashed border-border-muted bg-bg-primary/35 px-4 py-3 text-sm text-text-secondary">
                                                            No extra narrative note was captured beyond the structured event and trace data.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-4 rounded-2xl border border-dashed border-border-muted bg-bg-tertiary/35 px-4 py-6 text-sm text-text-secondary">
                                        This run has no signal-level evidence rows for the current filter set. Adjust the report window or open another run.
                                    </div>
                                )}
                            </div>

                            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                                <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                    <Download className="h-4 w-4 text-accent" />
                                    Validation Artifact Export
                                </div>
                                <p className="mt-1 text-sm text-text-secondary">
                                    Export a report bundle or trade log without leaving this workflow. Every file keeps the originating run and signal linkage.
                                </p>

                                {actionError ? (
                                    <StateBanner
                                        tone="danger"
                                        size="compact"
                                        className="mt-4"
                                        message={actionError}
                                    />
                                ) : null}

                                <div className="mt-4 grid gap-3">
                                    <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 px-4 py-3">
                                        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Run Linkage</div>
                                        <div className="mt-2 text-sm font-bold text-text-primary">{activeRunId || "No run selected"}</div>
                                        <div className="mt-1 text-sm text-text-secondary">{runDetail ? `${runDetail.signalCode}@${runDetail.signalVersion}` : "Signal definition metadata pending"}</div>
                                    </div>
                                    <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 px-4 py-3">
                                        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Signal Linkage</div>
                                        <div className="mt-2 text-sm font-bold text-text-primary">
                                            {selectedSignal ? `${selectedSignal.strategyCode} / ${selectedSignal.signalId}` : "No signal selected"}
                                        </div>
                                        <div className="mt-1 text-sm text-text-secondary">
                                            {selectedSignal ? `${selectedSignal.symbol} ${selectedSignal.timeframe} / ${selectedSignal.session} / ${formatSigned(selectedSignal.netR, "R")}` : "Choose a signal row to include decision context in the artifact."}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 space-y-3">
                                    <button
                                        onClick={handleExportValidationArtifact}
                                        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                                    >
                                        <Download className="h-4 w-4" />
                                        Export Validation Artifact
                                    </button>
                                    <button
                                        onClick={handleExportTradeLog}
                                        disabled={isTradeExporting || !activeRunId}
                                        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary disabled:opacity-50"
                                    >
                                        {isTradeExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                        Export Trade Log CSV
                                    </button>
                                    <button
                                        onClick={() => downloadCsv(`${toFileSlug(selectedRun?.name ?? runDetail?.name ?? "signal-review") || "signal-review"}-${activeRunId}.csv`, signalReviewExportRows)}
                                        disabled={signalReviewExportRows.length === 0}
                                        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary disabled:opacity-50"
                                    >
                                        <Download className="h-4 w-4" />
                                        Export Signal Review CSV
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                        <Layers3 className="h-4 w-4 text-accent" />
                                        Run Summary Export
                                    </div>
                                    <button
                                        onClick={() => downloadCsv(`${toFileSlug(selectedRun?.name ?? runDetail?.name ?? "report-summary") || "report-summary"}-${activeRunId}.csv`, overviewExportRows)}
                                        disabled={overviewExportRows.length === 0}
                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:opacity-50"
                                    >
                                        <Download className="h-4 w-4" />
                                        CSV
                                    </button>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Run</div>
                                        <div className="mt-2 text-lg font-black text-text-primary">{selectedRun?.name}</div>
                                        <div className="mt-1 text-sm text-text-secondary">
                                            {selectedRun?.symbol} / {selectedRun?.timeframe} / {selectedRun?.strategyCode ?? "Mixed"}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">Review window</div>
                                        <div className="mt-2 text-lg font-black text-text-primary">{fromDate || "Open"} to {toDate || "Open"}</div>
                                        <div className="mt-1 text-sm text-text-secondary">Side {side} / Session {selectedSession}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                                <div className="mb-4 flex items-center gap-2 text-sm font-bold text-text-primary">
                                    <Filter className="h-4 w-4 text-accent" />
                                    Recent Runs
                                </div>
                                <div className="overflow-hidden rounded-2xl border border-border-muted">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.18em] text-text-muted">
                                            <tr>
                                                <th className="px-4 py-3">Run</th>
                                                <th className="px-4 py-3">Symbol</th>
                                                <th className="px-4 py-3">Timeframe</th>
                                                <th className="px-4 py-3">Created</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {runs.slice(0, 6).map((run) => (
                                                <tr
                                                    key={run.id}
                                                    onClick={() => {
                                                        setIsReportLoading(true);
                                                        setSelectedSignalId("");
                                                        replaceQuery({
                                                            backtestRunId: run.id,
                                                            run: null,
                                                            signalId: null,
                                                            signal: null,
                                                        });
                                                    }}
                                                    className={`cursor-pointer border-t border-border-muted/70 transition hover:bg-bg-tertiary/25 ${run.id === activeRunId ? "bg-accent/5" : ""}`}
                                                >
                                                    <td className="px-4 py-3 font-semibold text-text-primary">{run.name}</td>
                                                    <td className="px-4 py-3 text-text-secondary">{run.symbol}</td>
                                                    <td className="px-4 py-3 text-text-secondary">{run.timeframe}</td>
                                                    <td className="px-4 py-3 text-text-secondary">{formatDateInput(run.createdAt)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                        <Layers3 className="h-4 w-4 text-accent" />
                                        Signal Review Ledger
                                    </div>
                                    <p className="mt-1 text-sm text-text-secondary">
                                        Review signal-level outcome rows, then focus any row above for explainable decision context and artifact export.
                                    </p>
                                </div>
                                <button
                                    onClick={() => downloadCsv(`${toFileSlug(selectedRun?.name ?? runDetail?.name ?? "signal-review") || "signal-review"}-${activeRunId}.csv`, signalReviewExportRows)}
                                    disabled={signalReviewExportRows.length === 0}
                                    className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:opacity-50"
                                >
                                    <Download className="h-4 w-4" />
                                    Export CSV
                                </button>
                            </div>

                            {signalReviewRows.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-border-muted bg-bg-tertiary/35 px-4 py-6 text-sm text-text-secondary">
                                    No signal review rows matched the current report filters.
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-2xl border border-border-muted">
                                    <table className="min-w-full text-left text-sm">
                                        <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.18em] text-text-muted">
                                            <tr>
                                                <th className="px-4 py-3">Signal</th>
                                                <th className="px-4 py-3">Session</th>
                                                <th className="px-4 py-3">Entry</th>
                                                <th className="px-4 py-3">Results</th>
                                                <th className="px-4 py-3">Net R</th>
                                                <th className="px-4 py-3">Best Exit</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {signalReviewRows.map((row) => (
                                                <tr
                                                    key={row.signalId}
                                                    onClick={() => {
                                                        setSelectedSignalId(row.signalId);
                                                        replaceQuery({
                                                            signalId: row.signalId,
                                                            signal: null,
                                                        });
                                                    }}
                                                    className={`cursor-pointer border-t border-border-muted/70 transition hover:bg-bg-tertiary/25 ${row.signalId === selectedSignalId ? "bg-accent/8" : ""}`}
                                                >
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold text-text-primary">{row.strategyCode}</div>
                                                        <div className="text-xs text-text-muted">{row.symbol} / {row.timeframe} / {row.side}</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-text-secondary">{row.session}</td>
                                                    <td className="px-4 py-3 text-text-secondary">{formatDateInput(row.entryTime)}</td>
                                                    <td className="px-4 py-3 text-text-secondary">{row.resultCount} total / {row.wins}W/{row.losses}L</td>
                                                    <td className={`px-4 py-3 font-semibold ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.netR, "R")}</td>
                                                    <td className="px-4 py-3 text-text-secondary">{row.bestExitRuleName ?? row.bestExitRuleCode ?? "n/a"}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        <section className="grid gap-4 xl:grid-cols-2">
                            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                        <Layers3 className="h-4 w-4 text-accent" />
                                        By Strategy
                                    </div>
                                    <button
                                        onClick={() => downloadCsv(`${toFileSlug(selectedRun?.name ?? runDetail?.name ?? "report-by-strategy") || "report-by-strategy"}-${activeRunId}.csv`, byStrategyExportRows)}
                                        disabled={byStrategyExportRows.length === 0}
                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:opacity-50"
                                    >
                                        <Download className="h-4 w-4" />
                                        CSV
                                    </button>
                                </div>
                                <div className="overflow-hidden rounded-2xl border border-border-muted">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.2em] text-text-muted">
                                            <tr>
                                                <th className="px-4 py-3">Strategy</th>
                                                <th className="px-4 py-3">Trades</th>
                                                <th className="px-4 py-3">Win%</th>
                                                <th className="px-4 py-3">Net R</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {byStrategy.map((row) => (
                                                <tr key={row.strategyId} className="border-t border-border-muted/70">
                                                    <td className="px-4 py-3">
                                                        <div className="font-bold text-text-primary">{row.strategyCode}</div>
                                                        <div className="text-xs text-text-muted">{row.strategyName}</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-text-secondary">{row.trades}</td>
                                                    <td className={`px-4 py-3 font-semibold ${row.winRate >= 50 ? "text-price-up" : "text-price-down"}`}>{row.winRate.toFixed(1)}%</td>
                                                    <td className={`px-4 py-3 font-semibold ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.netR, "R")}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                        <BarChart3 className="h-4 w-4 text-accent" />
                                        By Session
                                    </div>
                                    <button
                                        onClick={() => downloadCsv(`${toFileSlug(selectedRun?.name ?? runDetail?.name ?? "report-by-session") || "report-by-session"}-${activeRunId}.csv`, bySessionExportRows)}
                                        disabled={bySessionExportRows.length === 0}
                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:opacity-50"
                                    >
                                        <Download className="h-4 w-4" />
                                        CSV
                                    </button>
                                </div>
                                <div className="overflow-hidden rounded-2xl border border-border-muted">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.2em] text-text-muted">
                                            <tr>
                                                <th className="px-4 py-3">Session</th>
                                                <th className="px-4 py-3">Trades</th>
                                                <th className="px-4 py-3">Win%</th>
                                                <th className="px-4 py-3">Net R</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {bySession.map((row) => (
                                                <tr key={row.session} className="border-t border-border-muted/70">
                                                    <td className="px-4 py-3 font-bold text-text-primary">{row.session}</td>
                                                    <td className="px-4 py-3 text-text-secondary">{row.trades}</td>
                                                    <td className={`px-4 py-3 font-semibold ${row.winRate >= 50 ? "text-price-up" : "text-price-down"}`}>{row.winRate.toFixed(1)}%</td>
                                                    <td className={`px-4 py-3 font-semibold ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.netR, "R")}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4">
                            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                        <Filter className="h-4 w-4 text-accent" />
                                        Exit Strategy Comparison
                                    </div>
                                    <p className="mt-1 text-sm text-text-secondary">{contextLine}</p>
                                </div>
                                <button
                                    onClick={() => downloadCsv(`${toFileSlug(selectedRun?.name ?? runDetail?.name ?? "report-exit-comparison") || "report-exit-comparison"}-${activeRunId}.csv`, exitComparisonExportRows)}
                                    disabled={exitComparisonExportRows.length === 0}
                                    className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:opacity-50"
                                >
                                    <Download className="h-4 w-4" />
                                    Export CSV
                                </button>
                            </div>

                            <div className="overflow-x-auto rounded-2xl border border-border-muted">
                                <table className="min-w-full text-left text-sm">
                                    <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.18em] text-text-muted">
                                        <tr>
                                            <th className="px-4 py-3">Exit Strategy</th>
                                            <th className="px-4 py-3">Win%</th>
                                            <th className="px-4 py-3">W/L</th>
                                            <th className="px-4 py-3">Net R</th>
                                            <th className="px-4 py-3">Net USD</th>
                                            <th className="px-4 py-3">Max DD</th>
                                            <th className="px-4 py-3">PF</th>
                                            <th className="px-4 py-3">Expect</th>
                                            <th className="px-4 py-3">Avg W</th>
                                            <th className="px-4 py-3">Avg L</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {exitComparison.map((row) => (
                                            <tr key={row.exitRuleId} className="border-t border-border-muted/70">
                                                <td className="px-4 py-3">
                                                    <div className="font-bold text-text-primary">{row.exitRuleName}</div>
                                                    <div className="text-xs text-text-muted">{row.exitRuleCode}</div>
                                                </td>
                                                <td className={`px-4 py-3 font-semibold ${row.winRate >= 50 ? "text-price-up" : "text-price-down"}`}>{row.winRate.toFixed(1)}%</td>
                                                <td className="px-4 py-3 text-text-secondary">{row.wins}/{row.losses}{row.openTrades ? ` (${row.openTrades} open)` : ""}</td>
                                                <td className={`px-4 py-3 font-semibold ${row.netR >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.netR, "R")}</td>
                                                <td className={`px-4 py-3 font-semibold ${row.netUsd >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.netUsd, "$")}</td>
                                                <td className="px-4 py-3 text-price-down">{row.maxDrawdownPct.toFixed(1)}%</td>
                                                <td className="px-4 py-3 text-text-primary">{row.profitFactor.toFixed(2)}</td>
                                                <td className={`px-4 py-3 font-semibold ${row.expectancy >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.expectancy, "R")}</td>
                                                <td className="px-4 py-3 text-price-up">{formatSigned(row.avgWinR, "R")}</td>
                                                <td className="px-4 py-3 text-price-down">{formatSigned(row.avgLossR, "R")}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </>
                ) : null}
            </div>
        </div>
    );
}
