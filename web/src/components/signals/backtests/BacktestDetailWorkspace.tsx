"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    Activity,
    ArrowLeft,
    ArrowRight,
    ArrowUpDown,
    CandlestickChart,
    ChevronLeft,
    ChevronRight,
    Download,
    Loader2,
    RotateCcw,
    Settings2,
    Sigma,
} from "lucide-react";
import BacktestTradeDetailDrawer from "@/components/signals/backtests/BacktestTradeDetailDrawer";
import {
    BacktestTradeReplayResponse,
    BacktestTradeHistoryResponse,
    BacktestTradeOutcomeFilter,
    BacktestTradeRow,
    BacktestTradeStatusFilter,
} from "@/types/backtests";
import { EngineOverview, EquityCurveData } from "@/types/engine";
import BacktestEquityCurve from "@/components/signals/backtests/BacktestEquityCurve";
import { GeneratedBacktestDetail, GeneratedBacktestRun } from "@/types/signals";
import BacktestReviewSummaryPanel from "@/components/signals/backtests/BacktestReviewSummaryPanel";
import BacktestRunComparisonPanel from "@/components/signals/backtests/BacktestRunComparisonPanel";
import { useAuthSession } from "@/hooks/useAuthSession";
import {
    buildBacktestTradeDrawerContext,
    buildBacktestTradeEngineHref,
} from "@/lib/backtestTradeDetailContext";
import {
    BacktestDataQualityViewModel,
    BacktestRangeCoverageSnapshot,
    buildBacktestRangeCoverage,
    BacktestSyncStatusSnapshot,
    buildBacktestDataQualityView,
} from "@/lib/backtestDataQualityView";
import { getTimeframeMs } from "@/lib/freshnessUtils";
import {
    buildBacktestComparisonSearchParam,
    parseBacktestComparisonSearchParam,
} from "@/lib/backtestRunComparison";
import {
    buildBacktestTradeReplaySearchParams,
    parseBacktestTradeReplayMode,
} from "@/lib/backtestTradeReplayQuery";

const sideFilters = [
    { label: "ALL", value: "ALL" },
    { label: "LONG", value: "LONG" },
    { label: "SHORT", value: "SHORT" },
] as const;

const statusFilters: Array<{ label: string; value: BacktestTradeStatusFilter }> = [
    { label: "ALL", value: "ALL" },
    { label: "ACTIVE", value: "ACTIVE" },
    { label: "CLOSED", value: "CLOSED" },
];

const outcomeFilters: Array<{ label: string; value: BacktestTradeOutcomeFilter }> = [
    { label: "ALL", value: "ALL" },
    { label: "WIN", value: "WIN" },
    { label: "LOSS", value: "LOSS" },
    { label: "BE", value: "BE" },
];

const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Failed to load ${url}`);
    }
    return response.json();
};

const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "n/a");
const formatDateInput = (value: string | null) => (value ? value.slice(0, 10) : "");
const toUtcRangeStart = (value: string) => `${value}T00:00:00.000Z`;
const toUtcRangeEnd = (value: string) => `${value}T23:59:59.999Z`;
const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const formatPercent = (value: number | null) => (value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`);
const formatPrice = (value: number | null, digits = 2) => (value === null ? "-" : value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits }));
const formatDuration = (value: number | null) => {
    if (value === null) return "-";
    const totalMinutes = Math.max(Math.round(value / 60000), 0);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

const getResultTone = (result: BacktestTradeRow["result"]) => {
    if (result === "WIN") return "bg-price-up/15 text-price-up";
    if (result === "LOSS") return "bg-price-down/15 text-price-down";
    if (result === "ACTIVE") return "bg-accent/15 text-accent";
    return "bg-bg-tertiary text-text-primary";
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

const columnDefinitions = [
    { id: "time", label: "Time" },
    { id: "symbol", label: "Symbol" },
    { id: "tfExit", label: "TF / Exit" },
    { id: "side", label: "Side" },
    { id: "entry", label: "Entry" },
    { id: "sl", label: "SL" },
    { id: "close", label: "Close" },
    { id: "pnlPct", label: "PnL %" },
    { id: "pnlR", label: "PnL R" },
    { id: "pnlUsd", label: "PnL USD" },
    { id: "duration", label: "Duration" },
    { id: "result", label: "Result" },
] as const;

type ColumnId = typeof columnDefinitions[number]["id"];
type SortField = "entryTime" | "exitTime" | "rMultiple" | "durationMs" | "pnlUsd";
type SortOrder = "asc" | "desc";
const defaultVisibleColumns: ColumnId[] = columnDefinitions.map((column) => column.id);
const columnsStorageKey = "signals.backtestDetail.visibleColumns";
const restrictedDataQualityView: BacktestDataQualityViewModel = {
    state: "healthy",
    heading: "",
    summary: "",
    warnings: [],
    freshnessState: "fresh",
};

export default function BacktestDetailWorkspace({ runId }: { runId: string }) {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const { isAdmin } = useAuthSession();
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [runDetail, setRunDetail] = useState<GeneratedBacktestDetail | null>(null);
    const [overview, setOverview] = useState<EngineOverview | null>(null);
    const [equityCurve, setEquityCurve] = useState<EquityCurveData | null>(null);
    const [show1to1R, setShow1to1R] = useState(false);
    const [syncStatus, setSyncStatus] = useState<BacktestSyncStatusSnapshot | null>(null);
    const [rangeCoverage, setRangeCoverage] = useState<BacktestRangeCoverageSnapshot | null>(null);
    const [relatedRuns, setRelatedRuns] = useState<GeneratedBacktestRun[]>([]);
    const [comparisonRuns, setComparisonRuns] = useState<Record<string, {
        run: GeneratedBacktestDetail;
        overview: EngineOverview | null;
    }>>({});
    const [tradeData, setTradeData] = useState<BacktestTradeHistoryResponse | null>(null);
    const [detailReplay, setDetailReplay] = useState<BacktestTradeReplayResponse | null>(null);
    const [isRunLoading, setIsRunLoading] = useState(true);
    const [isOverviewLoading, setIsOverviewLoading] = useState(true);
    const [isSyncStatusLoading, setIsSyncStatusLoading] = useState(true);
    const [isRangeCoverageLoading, setIsRangeCoverageLoading] = useState(true);
    const [isComparisonLoading, setIsComparisonLoading] = useState(false);
    const [isTradesLoading, setIsTradesLoading] = useState(true);
    const [isDrawerLoading, setIsDrawerLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [syncStatusError, setSyncStatusError] = useState<string | null>(null);
    const [rangeCoverageError, setRangeCoverageError] = useState<string | null>(null);
    const [comparisonError, setComparisonError] = useState<string | null>(null);
    const [drawerError, setDrawerError] = useState<string | null>(null);
    const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(defaultVisibleColumns);

    const status = (searchParams.get("status")?.toUpperCase() as BacktestTradeStatusFilter) || "ALL";
    const side = (searchParams.get("side")?.toUpperCase() as "ALL" | "LONG" | "SHORT") || "ALL";
    const outcome = (searchParams.get("outcome")?.toUpperCase() as BacktestTradeOutcomeFilter) || "ALL";
    const symbol = searchParams.get("symbol") || "";
    const fromDate = searchParams.get("from") || "";
    const toDate = searchParams.get("to") || "";
    const selectedRowId = searchParams.get("selected") || "";
    const page = Number(searchParams.get("page") || "1");
    const pageSize = Number(searchParams.get("pageSize") || "50");
    const sort = (searchParams.get("sort") as SortField) || "entryTime";
    const order = (searchParams.get("order") as SortOrder) || "desc";
    const selectedCompareIds = useMemo(
        () => parseBacktestComparisonSearchParam(searchParams.get("compare")),
        [searchParams],
    );
    const replayMode = parseBacktestTradeReplayMode(searchParams.get("replay"));
    const isReplayExpanded = replayMode === "expanded";

    const selectedRow = useMemo(
        () => tradeData?.rows.find((row) => row.rowId === selectedRowId) ?? null,
        [selectedRowId, tradeData]
    );

    const selectedRowEngineHref = useMemo(() => {
        return buildBacktestTradeEngineHref({
            runId,
            row: selectedRow,
            fromDate,
            toDate,
        });
    }, [fromDate, runId, selectedRow, toDate]);

    const selectedTradeContext = useMemo(
        () => buildBacktestTradeDrawerContext({ row: selectedRow, runDetail }),
        [runDetail, selectedRow],
    );

    const availableCompareRuns = useMemo(
        () => relatedRuns.filter((run) => run.id !== runId),
        [relatedRuns, runId],
    );

    const activeCompareIds = useMemo(
        () => selectedCompareIds.filter((id) => availableCompareRuns.some((run) => run.id === id)),
        [availableCompareRuns, selectedCompareIds],
    );

    const comparedRuns = useMemo(
        () => activeCompareIds
            .map((id) => comparisonRuns[id])
            .filter((item): item is { run: GeneratedBacktestDetail; overview: EngineOverview | null } => Boolean(item)),
        [activeCompareIds, comparisonRuns],
    );

    const dataQualityView = useMemo(
        () => {
            if (!isAdmin) {
                return restrictedDataQualityView;
            }

            return buildBacktestDataQualityView({
                runDetail,
                syncStatus,
                rangeCoverage,
                isLoading: isSyncStatusLoading || isRangeCoverageLoading,
                error: syncStatusError ?? rangeCoverageError,
            });
        },
        [isAdmin, isRangeCoverageLoading, isSyncStatusLoading, rangeCoverage, rangeCoverageError, runDetail, syncStatus, syncStatusError],
    );

    const exportRows = useMemo(() => (
        (tradeData?.rows || []).map((row) => ({
            entryTime: row.entryTime,
            exitTime: row.exitTime ?? "",
            symbol: row.symbol,
            timeframe: row.timeframe,
            exitRuleCode: row.exitRuleCode,
            side: row.side,
            session: row.session,
            entryPrice: row.entryPrice,
            stopLoss: row.stopLoss,
            exitPrice: row.exitPrice ?? "",
            pnlPct: row.pnlPct ?? "",
            rMultiple: row.rMultiple,
            pnlUsd: row.pnlUsd,
            durationMs: row.durationMs ?? "",
            result: row.result,
            notes: row.notes ?? "",
        }))
    ), [tradeData]);

    const replaceSearchParams = useCallback((next: URLSearchParams) => {
        const query = next.toString();
        startTransition(() => {
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        });
    }, [pathname, router]);

    const replaceQuery = useCallback((updates: Record<string, string | null>) => {
        const next = new URLSearchParams(Array.from(searchParams.entries()));
        Object.entries(updates).forEach(([key, value]) => {
            if (!value) {
                next.delete(key);
                return;
            }
            next.set(key, value);
        });
        replaceSearchParams(next);
    }, [replaceSearchParams, searchParams]);

    const toggleColumn = (columnId: ColumnId) => {
        setVisibleColumns((current) => {
            if (current.includes(columnId)) {
                if (current.length === 1) return current;
                return current.filter((item) => item !== columnId);
            }

            return columnDefinitions
                .map((column) => column.id)
                .filter((id) => id === columnId || current.includes(id));
        });
    };

    const handleSort = (field: SortField) => {
        const nextOrder: SortOrder = sort === field && order === "desc" ? "asc" : "desc";
        replaceQuery({
            sort: field === "entryTime" && nextOrder === "desc" ? null : field,
            order: field === "entryTime" && nextOrder === "desc" ? null : nextOrder,
            page: "1",
            selected: null,
            replay: null,
        });
    };

    const renderSortableHeader = (label: string, field: SortField) => {
        const isActive = sort === field;
        const marker = isActive ? (order === "desc" ? "↓" : "↑") : "";

        return (
            <button
                type="button"
                onClick={() => handleSort(field)}
                className={`inline-flex items-center gap-1 font-bold ${isActive ? "text-text-primary" : "text-text-muted"}`}
            >
                {label}
                <ArrowUpDown className="h-3.5 w-3.5" />
                {marker ? <span>{marker}</span> : null}
            </button>
        );
    };

    const createTradeQueryParams = useCallback((overridePage?: number, overridePageSize?: number) => {
        const params = new URLSearchParams({
            backtestRunId: runId,
            status,
            side,
            outcome,
            page: String(overridePage ?? (Number.isFinite(page) && page > 0 ? page : 1)),
            pageSize: String(overridePageSize ?? (Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 50)),
            sort,
            order,
        });

        if (symbol.trim()) params.set("symbol", symbol.trim().toUpperCase());
        if (fromDate) params.set("from", toUtcRangeStart(fromDate));
        if (toDate) params.set("to", toUtcRangeEnd(toDate));

        return params;
    }, [fromDate, order, outcome, page, pageSize, runId, side, sort, status, symbol, toDate]);

    const tradeQueryString = useMemo(
        () => createTradeQueryParams().toString(),
        [createTradeQueryParams],
    );

    const handleResetView = () => {
        setVisibleColumns(defaultVisibleColumns);
        window.localStorage.removeItem(columnsStorageKey);
        replaceQuery({
            status: null,
            side: null,
            outcome: null,
            symbol: null,
            from: null,
            to: null,
            selected: null,
            replay: null,
            page: null,
            pageSize: null,
            sort: null,
            order: null,
        });
    };

    const handleToggleCompareRun = (compareRunId: string) => {
        const nextIds = activeCompareIds.includes(compareRunId)
            ? activeCompareIds.filter((id) => id !== compareRunId)
            : [...activeCompareIds, compareRunId];

        replaceQuery({
            compare: buildBacktestComparisonSearchParam(nextIds),
        });
    };

    const handleClearComparison = () => {
        replaceQuery({
            compare: null,
        });
    };

    const handleExportFiltered = async () => {
        if (!tradeData || tradeData.pagination.totalRows === 0) return;

        setIsExporting(true);
        setError(null);
        try {
            const firstPageSize = 200;
            const first = await fetchJson<{ data: BacktestTradeHistoryResponse }>(
                `${apiUrl}/api/engine/trades?${createTradeQueryParams(1, firstPageSize)}`
            );

            let rows = [...first.data.rows];
            const totalPages = first.data.pagination.totalPages;

            for (let currentPage = 2; currentPage <= totalPages; currentPage += 1) {
                const next = await fetchJson<{ data: BacktestTradeHistoryResponse }>(
                    `${apiUrl}/api/engine/trades?${createTradeQueryParams(currentPage, firstPageSize)}`
                );
                rows = rows.concat(next.data.rows);
            }

            downloadCsv(
                `${runDetail?.signalCode?.toLowerCase() || "backtest"}-trade-history-filtered.csv`,
                rows.map((row) => ({
                    entryTime: row.entryTime,
                    exitTime: row.exitTime ?? "",
                    symbol: row.symbol,
                    timeframe: row.timeframe,
                    exitRuleCode: row.exitRuleCode,
                    side: row.side,
                    session: row.session,
                    entryPrice: row.entryPrice,
                    stopLoss: row.stopLoss,
                    exitPrice: row.exitPrice ?? "",
                    pnlPct: row.pnlPct ?? "",
                    rMultiple: row.rMultiple,
                    pnlUsd: row.pnlUsd,
                    durationMs: row.durationMs ?? "",
                    result: row.result,
                    notes: row.notes ?? "",
                }))
            );
        } catch (exportError) {
            setError(exportError instanceof Error ? exportError.message : "Failed to export filtered trades");
        } finally {
            setIsExporting(false);
        }
    };

    const handleInspectTrades = () => {
        const target = document.getElementById("trade-history");
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const handleInspectComparison = () => {
        const target = document.getElementById("run-comparison");
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    useEffect(() => {
        let active = true;
        setIsRunLoading(true);
        setError(null);

        fetchJson<{ data: GeneratedBacktestDetail }>(`${apiUrl}/api/signals/backtests/${runId}`)
            .then((result) => {
                if (!active) return;
                setRunDetail(result.data);
            })
            .catch((fetchError) => {
                if (!active) return;
                setError(fetchError instanceof Error ? fetchError.message : "Failed to load run detail");
            })
            .finally(() => {
                if (!active) return;
                setIsRunLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, runId]);

    useEffect(() => {
        let active = true;
        setIsOverviewLoading(true);
        setError(null);

        fetchJson<{ data: EngineOverview }>(`${apiUrl}/api/engine/overview?backtestRunId=${runId}`)
            .then((result) => {
                if (!active) return;
                setOverview(result.data);
            })
            .catch((fetchError) => {
                if (!active) return;
                setError(fetchError instanceof Error ? fetchError.message : "Failed to load summary overview");
            })
            .finally(() => {
                if (!active) return;
                setIsOverviewLoading(false);
            });

        fetchJson<{ data: EquityCurveData }>(`${apiUrl}/api/engine/equity-curve?backtestRunId=${runId}`)
            .then((result) => {
                if (!active) return;
                setEquityCurve(result.data);
            })
            .catch(() => {
                if (!active) return;
                setEquityCurve(null);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, runId]);

    useEffect(() => {
        if (!runDetail) {
            setSyncStatus(null);
            setRangeCoverage(null);
            setSyncStatusError(null);
            setRangeCoverageError(null);
            setIsSyncStatusLoading(false);
            setIsRangeCoverageLoading(false);
            setRelatedRuns([]);
            setComparisonError(null);
            return;
        }

        let active = true;
        if (isAdmin) {
            setIsSyncStatusLoading(true);
            setIsRangeCoverageLoading(true);
            setSyncStatusError(null);
            setRangeCoverageError(null);

            fetchJson<BacktestSyncStatusSnapshot>(
                `${apiUrl}/api/sync-status/${encodeURIComponent(runDetail.symbol)}?timeframe=${encodeURIComponent(runDetail.timeframe)}`
            )
                .then((result) => {
                    if (!active) return;
                    setSyncStatus(result);
                })
                .catch((fetchError) => {
                    if (!active) return;
                    setSyncStatus(null);
                    setSyncStatusError(fetchError instanceof Error ? fetchError.message : "Failed to load backtest data coverage");
                })
                .finally(() => {
                    if (!active) return;
                    setIsSyncStatusLoading(false);
                });

            const timeframeMs = getTimeframeMs(runDetail.timeframe);
            const rangeStartMs = new Date(runDetail.startedAt).getTime();
            const rangeEndMs = new Date(runDetail.finishedAt ?? runDetail.startedAt).getTime() + timeframeMs;
            const expectedCandles = Math.max(Math.floor((rangeEndMs - rangeStartMs) / timeframeMs), 1);

            fetchJson<Array<{ time: string }>>(
                `${apiUrl}/api/ohlcv/${encodeURIComponent(runDetail.symbol)}?timeframe=${encodeURIComponent(runDetail.timeframe)}&startTime=${rangeStartMs}&endTime=${rangeEndMs}&limit=${Math.min(expectedCandles + 5, 10000)}`
            )
                .then((rows) => {
                    if (!active) return;
                    setRangeCoverage(buildBacktestRangeCoverage({
                        candleTimes: rows.map((row) => row.time),
                        startedAt: runDetail.startedAt,
                        finishedAt: runDetail.finishedAt,
                        timeframe: runDetail.timeframe,
                    }));
                })
                .catch((fetchError) => {
                    if (!active) return;
                    setRangeCoverage(null);
                    setRangeCoverageError(fetchError instanceof Error ? fetchError.message : "Failed to inspect candles for gap validation");
                })
                .finally(() => {
                    if (!active) return;
                    setIsRangeCoverageLoading(false);
                });
        } else {
            setSyncStatus(null);
            setRangeCoverage(null);
            setSyncStatusError(null);
            setRangeCoverageError(null);
            setIsSyncStatusLoading(false);
            setIsRangeCoverageLoading(false);
        }

        setComparisonError(null);

        fetchJson<{ data: GeneratedBacktestRun[] }>(
            `${apiUrl}/api/signals/backtests?signalCode=${encodeURIComponent(runDetail.signalCode)}&signalVersion=${runDetail.signalVersion}`
        )
            .then((result) => {
                if (!active) return;
                setRelatedRuns(result.data);
            })
            .catch((fetchError) => {
                if (!active) return;
                setComparisonError(fetchError instanceof Error ? fetchError.message : "Failed to load comparison runs");
            });

        return () => {
            active = false;
        };
    }, [apiUrl, isAdmin, runDetail]);

    useEffect(() => {
        let active = true;
        setIsTradesLoading(true);
        setError(null);

        fetchJson<{ data: BacktestTradeHistoryResponse }>(`${apiUrl}/api/engine/trades?${tradeQueryString}`)
            .then((result) => {
                if (!active) return;
                setTradeData(result.data);
            })
            .catch((fetchError) => {
                if (!active) return;
                setError(fetchError instanceof Error ? fetchError.message : "Failed to load trade history");
            })
            .finally(() => {
                if (!active) return;
                setIsTradesLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, tradeQueryString]);

    useEffect(() => {
        if (activeCompareIds.length === 0) {
            setComparisonRuns({});
            setComparisonError(null);
            setIsComparisonLoading(false);
            return;
        }

        let active = true;
        setIsComparisonLoading(true);
        setComparisonError(null);

        Promise.all(
            activeCompareIds.map(async (id) => {
                const [runResult, overviewResult] = await Promise.all([
                    fetchJson<{ data: GeneratedBacktestDetail }>(`${apiUrl}/api/signals/backtests/${id}`),
                    fetchJson<{ data: EngineOverview }>(`${apiUrl}/api/engine/overview?backtestRunId=${id}`),
                ]);

                return [id, {
                    run: runResult.data,
                    overview: overviewResult.data,
                }] as const;
            }),
        )
            .then((entries) => {
                if (!active) return;
                setComparisonRuns(Object.fromEntries(entries));
            })
            .catch((fetchError) => {
                if (!active) return;
                setComparisonError(fetchError instanceof Error ? fetchError.message : "Failed to load comparison details");
            })
            .finally(() => {
                if (!active) return;
                setIsComparisonLoading(false);
            });

        return () => {
            active = false;
        };
    }, [activeCompareIds, apiUrl]);

    useEffect(() => {
        if (!selectedRow) {
            setDetailReplay(null);
            setDrawerError(null);
            return;
        }

        let active = true;
        setDetailReplay(null);
        setIsDrawerLoading(true);
        setDrawerError(null);

        fetchJson<{ data: BacktestTradeReplayResponse }>(
            `${apiUrl}/api/signals/backtests/${runId}/trades/${encodeURIComponent(selectedRow.rowId)}/replay`
        )
            .then((result) => {
                if (!active) return;
                setDetailReplay(result.data);
            })
            .catch((fetchError) => {
                if (!active) return;
                setDetailReplay(null);
                setDrawerError(fetchError instanceof Error ? fetchError.message : "Failed to load trade detail");
            })
            .finally(() => {
                if (!active) return;
                setIsDrawerLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, runId, selectedRow]);

    useEffect(() => {
        const stored = window.localStorage.getItem(columnsStorageKey);
        if (!stored) return;

        try {
            const parsed = JSON.parse(stored);
            if (!Array.isArray(parsed)) return;
            const valid = parsed.filter((value): value is ColumnId =>
                columnDefinitions.some((column) => column.id === value)
            );
            if (valid.length > 0) {
                setVisibleColumns(valid);
            }
        } catch {
            // Ignore malformed local storage and keep defaults.
        }
    }, []);

    useEffect(() => {
        window.localStorage.setItem(columnsStorageKey, JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    const heroVerdict = useMemo(() => {
        const m = overview?.metrics;
        const pf = m?.profitFactor ?? 0;
        const wr = m?.winRate ?? 0;
        const dd = equityCurve?.maxDrawdownPct ?? m?.maxDrawdownPct ?? 0;
        const netUsd = equityCurve?.finalEquity != null
            ? equityCurve.finalEquity - (equityCurve?.initialEquity ?? 10000)
            : (m?.netUsd ?? 0);
        const isGood = pf >= 1.5 && wr >= 45 && dd < 40;
        const isBad = pf < 1.0 || netUsd < 0;
        const verdict = isBad ? "NOT VIABLE" : isGood ? "STRONG" : "NEEDS WORK";
        const verdictColor = isBad ? "text-price-down" : isGood ? "text-price-up" : "text-amber-300";
        const verdictBorder = isBad ? "border-price-down/20" : isGood ? "border-price-up/20" : "border-amber-400/20";
        const tradesPerWeek = equityCurve?.tradesPerWeek ?? 0;
        return { pf, wr, dd, netUsd, verdict, verdictColor, verdictBorder, tradesPerWeek };
    }, [overview, equityCurve]);

    const formatUsdHero = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}k` : `$${v.toFixed(0)}`;

    const headerLine = useMemo(() => {
        if (!runDetail) return "Loading run context";
        return [
            `${runDetail.signalCode}@${runDetail.signalVersion}`,
            runDetail.symbol,
            runDetail.timeframe,
            `${runDetail.counts.results} results`,
            `${formatDateInput(runDetail.startedAt)} to ${formatDateInput(runDetail.finishedAt)}`,
        ].join(" | ");
    }, [runDetail]);

    if (error && !runDetail && !tradeData && !overview && !isRunLoading && !isTradesLoading && !isOverviewLoading) {
        return (
            <div className="command-deck-canvas grid h-full place-items-center p-6">
                <div className="max-w-xl rounded-3xl border border-price-down/20 bg-bg-primary p-8 text-center">
                    <Activity className="mx-auto h-10 w-10 text-price-down" />
                    <h1 className="mt-4 text-2xl font-black text-text-primary">Backtest detail unavailable</h1>
                    <p className="mt-2 text-sm text-text-secondary">{error}</p>
                    <Link
                        href="/signals"
                        className="mt-6 inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                    >
                        Back To Signals
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="command-deck-canvas h-full overflow-y-auto">
                <div className="mx-auto flex min-h-full max-w-[1640px] flex-col gap-6 p-4 lg:p-6">
                    {/* ─── HERO VERDICT ─── */}
                    {(() => {
                        const { pf, wr, dd, netUsd, verdict, verdictColor, verdictBorder, tradesPerWeek } = heroVerdict;

                        return (
                            <section className={`rounded-3xl border ${verdictBorder} bg-bg-primary/90 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)]`}>
                                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                                    <div className="flex items-center gap-5">
                                        <div>
                                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.26em] text-text-muted">
                                                <CandlestickChart className="h-4 w-4" />
                                                {runDetail?.signalCode || "Signal"}
                                            </div>
                                            <h1 className="mt-1 text-2xl font-black tracking-tight text-text-primary">
                                                {runDetail?.name || "Generated run detail"}
                                            </h1>
                                            {runDetail?.notes && (
                                                <p className="mt-1 text-xs text-text-secondary">{runDetail.notes}</p>
                                            )}
                                            <p className="mt-1 text-xs text-text-secondary">{headerLine}</p>
                                            {(() => {
                                                const overrides = runDetail?.parametersJson?.blockParamOverrides;
                                                if (!overrides || typeof overrides !== "object") return null;
                                                const entries = Object.entries(overrides as Record<string, Record<string, unknown>>);
                                                if (entries.length === 0) return null;
                                                return (
                                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                                        {entries.map(([blockId, blockOverrides]) =>
                                                            Object.entries(blockOverrides).map(([param, value]) => (
                                                                <span key={`${blockId}:${param}`} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 text-[10px] font-mono text-accent">
                                                                    {param}={String(value)}
                                                                </span>
                                                            ))
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                            {(() => {
                                                const exitStrategy = runDetail?.parametersJson?.exitStrategy;
                                                if (!exitStrategy || typeof exitStrategy !== "string") return null;
                                                return (
                                                    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                                                        Exit: {exitStrategy}
                                                    </span>
                                                );
                                            })()}
                                            {(runDetail?.guardMetrics?.blockedEntryCount ?? 0) > 0 && (
                                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/5 px-2 py-0.5 text-[10px] font-bold text-red-400">
                                                    {runDetail!.guardMetrics!.blockedEntryCount} entries blocked by guards
                                                </span>
                                            )}
                                        </div>
                                        <span className={`hidden xl:inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-black uppercase tracking-wider ${verdictColor} ${verdictBorder} bg-bg-tertiary/50`}>
                                            {verdict}
                                        </span>
                                    </div>

                                    {/* Hero numbers */}
                                    <div className="flex flex-wrap items-center gap-4 xl:gap-6">
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">PnL</div>
                                            <div className={`text-xl font-black ${netUsd >= 0 ? "text-price-up" : "text-price-down"}`}>{formatUsdHero(netUsd)}</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">PF</div>
                                            <div className={`text-xl font-black ${pf >= 1.5 ? "text-price-up" : pf >= 1.0 ? "text-text-primary" : "text-price-down"}`}>{pf.toFixed(2)}</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">WR</div>
                                            <div className={`text-xl font-black ${wr >= 55 ? "text-price-up" : "text-text-primary"}`}>{wr.toFixed(1)}%</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Max DD</div>
                                            <div className={`text-xl font-black ${dd <= 20 ? "text-price-up" : dd <= 40 ? "text-amber-300" : "text-price-down"}`}>{dd.toFixed(1)}%</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Freq</div>
                                            <div className="text-xl font-black text-text-primary">{tradesPerWeek}/wk</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Action bar */}
                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                    <Link
                                        href="/signals"
                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-secondary hover:text-text-primary"
                                    >
                                        <ArrowLeft className="h-3 w-3" />
                                        Signals
                                    </Link>
                                    <Link
                                        href={`/engine?run=${runId}`}
                                        className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-xs font-black text-bg-secondary"
                                    >
                                        Engine
                                        <ArrowRight className="h-3 w-3" />
                                    </Link>
                                    <Link
                                        href={`/reports?backtestRunId=${runId}`}
                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-secondary hover:text-text-primary"
                                    >
                                        Reports
                                    </Link>
                                    <button
                                        type="button"
                                        onClick={() => setShow1to1R(!show1to1R)}
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
                                            show1to1R
                                                ? "border-accent/40 bg-accent/15 text-accent"
                                                : "border-border-muted bg-bg-tertiary text-text-muted hover:text-text-secondary"
                                        }`}
                                    >
                                        1:1 R {show1to1R ? "ON" : "OFF"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleInspectTrades}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-secondary hover:text-text-primary"
                                    >
                                        <Sigma className="h-3 w-3" />
                                        Trades
                                    </button>
                                </div>
                            </section>
                        );
                    })()}

                    {/* ─── EQUITY CURVE ─── */}
                    <BacktestEquityCurve data={equityCurve} show1to1={show1to1R} />

                    {(isRunLoading || isTradesLoading || isOverviewLoading) && !runDetail && !tradeData && !overview ? (
                        <div className="grid min-h-[320px] place-items-center rounded-3xl border border-border-muted bg-bg-primary/90">
                            <Loader2 className="h-8 w-8 animate-spin text-accent" />
                        </div>
                    ) : (
                        <>
                            <BacktestReviewSummaryPanel
                                runId={runId}
                                runDetail={runDetail}
                                tradeSummary={tradeData?.summary ?? null}
                                overview={overview}
                                dataQuality={dataQualityView}
                                onInspectTrades={handleInspectTrades}
                                onInspectComparison={handleInspectComparison}
                                show1to1R={show1to1R}
                                onToggle1to1R={() => setShow1to1R(!show1to1R)}
                            />

                            <BacktestRunComparisonPanel
                                currentRun={runDetail}
                                currentOverview={overview}
                                availableRuns={availableCompareRuns}
                                selectedRunIds={activeCompareIds}
                                comparedRuns={comparedRuns}
                                isLoading={isComparisonLoading}
                                error={comparisonError}
                                onToggleRun={handleToggleCompareRun}
                                onClear={handleClearComparison}
                            />

                            <section
                                id="trade-history"
                                className="rounded-3xl border border-border-muted bg-bg-primary/90 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
                            >
                                <div className="flex flex-col gap-4">
                                    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                                        <div>
                                            <div className="text-lg font-black text-text-primary">Trades</div>
                                            <div className="mt-1 text-sm text-text-secondary">
                                                {tradeData?.pagination.totalRows ?? 0} rows | {(tradeData?.summary.wins ?? 0)}W {(tradeData?.summary.losses ?? 0)}L | {formatSigned(tradeData?.summary.netR ?? 0, "R")}
                                            </div>
                                        </div>

                                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                            <label className="flex min-w-[180px] flex-col gap-1 text-xs text-text-muted">
                                                Symbol Filter
                                                <input
                                                    value={symbol}
                                                    onChange={(event) => replaceQuery({ symbol: event.target.value || null, page: "1", selected: null, replay: null })}
                                                    placeholder="XAUUSD"
                                                    className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>

                                            <label className="flex min-w-[180px] flex-col gap-1 text-xs text-text-muted">
                                                From (UTC)
                                                <input
                                                    type="date"
                                                    value={fromDate}
                                                    max={toDate || undefined}
                                                    onChange={(event) => replaceQuery({ from: event.target.value || null, page: "1", selected: null, replay: null })}
                                                    className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>

                                            <label className="flex min-w-[180px] flex-col gap-1 text-xs text-text-muted">
                                                To (UTC)
                                                <input
                                                    type="date"
                                                    value={toDate}
                                                    min={fromDate || undefined}
                                                    onChange={(event) => replaceQuery({ to: event.target.value || null, page: "1", selected: null, replay: null })}
                                                    className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        {statusFilters.map((item) => (
                                            <button
                                                key={item.value}
                                                onClick={() => replaceQuery({ status: item.value === "ALL" ? null : item.value, page: "1", selected: null, replay: null })}
                                                className={`rounded-full px-3 py-1.5 text-xs font-bold ${status === item.value ? "bg-accent text-bg-secondary" : "border border-border-muted text-text-secondary"}`}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        {sideFilters.map((item) => (
                                            <button
                                                key={item.value}
                                                onClick={() => replaceQuery({ side: item.value === "ALL" ? null : item.value, page: "1", selected: null, replay: null })}
                                                className={`rounded-full px-3 py-1.5 text-xs font-bold ${side === item.value ? "bg-accent text-bg-secondary" : "border border-border-muted text-text-secondary"}`}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        {outcomeFilters.map((item) => (
                                            <button
                                                key={item.value}
                                                onClick={() => replaceQuery({ outcome: item.value === "ALL" ? null : item.value, page: "1", selected: null, replay: null })}
                                                className={`rounded-full px-3 py-1.5 text-xs font-bold ${outcome === item.value ? "bg-accent text-bg-secondary" : "border border-border-muted text-text-secondary"}`}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            onClick={() => downloadCsv(`${runDetail?.signalCode?.toLowerCase() || "backtest"}-trade-history-page-${page}.csv`, exportRows)}
                                            disabled={exportRows.length === 0}
                                            className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary disabled:opacity-50"
                                        >
                                            <Download className="h-4 w-4" />
                                            Export CSV
                                        </button>
                                        <button
                                            onClick={handleExportFiltered}
                                            disabled={isExporting || (tradeData?.pagination.totalRows ?? 0) === 0}
                                            className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary disabled:opacity-50"
                                        >
                                            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                            Export Filtered
                                        </button>
                                        <button
                                            onClick={handleResetView}
                                            className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                                        >
                                            <RotateCcw className="h-4 w-4" />
                                            Reset View
                                        </button>

                                        <details className="rounded-2xl border border-border-muted bg-bg-tertiary/45">
                                            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-bold text-text-primary">
                                                <Settings2 className="h-4 w-4" />
                                                Columns
                                            </summary>
                                            <div className="grid gap-2 border-t border-border-muted px-4 py-3 sm:grid-cols-2">
                                                {columnDefinitions.map((column) => (
                                                    <label key={column.id} className="flex items-center gap-2 text-xs text-text-secondary">
                                                        <input
                                                            type="checkbox"
                                                            checked={visibleColumns.includes(column.id)}
                                                            onChange={() => toggleColumn(column.id)}
                                                            className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                                                        />
                                                        {column.label}
                                                    </label>
                                                ))}
                                            </div>
                                        </details>

                                        {selectedRow ? (
                                            <Link
                                                href={selectedRowEngineHref}
                                                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                                            >
                                                Open Selected In Engine
                                                <ArrowRight className="h-4 w-4" />
                                            </Link>
                                        ) : null}
                                    </div>

                                    {error ? (
                                        <div className="rounded-2xl border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                                            {error}
                                        </div>
                                    ) : null}

                                    {isTradesLoading ? (
                                        <div className="grid min-h-[280px] place-items-center rounded-2xl border border-border-muted bg-bg-tertiary/35">
                                            <Loader2 className="h-8 w-8 animate-spin text-accent" />
                                        </div>
                                    ) : !tradeData || tradeData.rows.length === 0 ? (
                                        <div className="grid min-h-[280px] place-items-center rounded-2xl border border-border-muted bg-bg-tertiary/35">
                                            <div className="text-center">
                                                <Sigma className="mx-auto h-8 w-8 text-accent" />
                                                <h3 className="mt-3 text-lg font-bold text-text-primary">No trades found</h3>
                                                <p className="mt-1 text-sm text-text-secondary">Adjust the filters or open another generated run.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="overflow-x-auto rounded-2xl border border-border-muted">
                                                <table className="min-w-full text-left text-sm">
                                                    <thead className="bg-bg-tertiary/80 text-xs uppercase tracking-[0.18em] text-text-muted">
                                                        <tr>
                                                            {visibleColumns.includes("time") ? <th className="px-4 py-3">{renderSortableHeader("Time", "entryTime")}</th> : null}
                                                            {visibleColumns.includes("symbol") ? <th className="px-4 py-3">Symbol</th> : null}
                                                            {visibleColumns.includes("tfExit") ? <th className="px-4 py-3">TF / Exit</th> : null}
                                                            {visibleColumns.includes("side") ? <th className="px-4 py-3">Side</th> : null}
                                                            {visibleColumns.includes("entry") ? <th className="px-4 py-3">Entry</th> : null}
                                                            {visibleColumns.includes("sl") ? <th className="px-4 py-3">SL</th> : null}
                                                            {visibleColumns.includes("close") ? <th className="px-4 py-3">{renderSortableHeader("Close", "exitTime")}</th> : null}
                                                            {visibleColumns.includes("pnlPct") ? <th className="px-4 py-3">PnL %</th> : null}
                                                            {visibleColumns.includes("pnlR") ? <th className="px-4 py-3">{renderSortableHeader("PnL R", "rMultiple")}</th> : null}
                                                            {visibleColumns.includes("pnlUsd") ? <th className="px-4 py-3">{renderSortableHeader("PnL USD", "pnlUsd")}</th> : null}
                                                            {visibleColumns.includes("duration") ? <th className="px-4 py-3">{renderSortableHeader("Duration", "durationMs")}</th> : null}
                                                            {visibleColumns.includes("result") ? <th className="px-4 py-3">Result</th> : null}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {tradeData.rows.map((row) => (
                                                            <tr
                                                                key={row.rowId}
                                                                onClick={() => replaceQuery({ selected: row.rowId })}
                                                                className={`cursor-pointer border-t border-border-muted/70 transition hover:bg-bg-tertiary/30 ${selectedRowId === row.rowId ? "bg-accent/8" : ""}`}
                                                            >
                                                                {visibleColumns.includes("time") ? <td className="px-4 py-3 text-text-secondary">{formatDateTime(row.entryTime)}</td> : null}
                                                                {visibleColumns.includes("symbol") ? (
                                                                    <td className="px-4 py-3">
                                                                        <div className="font-bold text-text-primary">{row.symbol}</div>
                                                                        <div className="text-xs text-text-muted">{row.session}</div>
                                                                    </td>
                                                                ) : null}
                                                                {visibleColumns.includes("tfExit") ? (
                                                                    <td className="px-4 py-3 text-text-secondary">
                                                                        {row.timeframe}
                                                                        <div className="text-xs text-text-muted">{row.exitRuleCode}</div>
                                                                    </td>
                                                                ) : null}
                                                                {visibleColumns.includes("side") ? (
                                                                    <td className="px-4 py-3">
                                                                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${row.side === "LONG" ? "bg-price-up/15 text-price-up" : "bg-price-down/15 text-price-down"}`}>
                                                                            {row.side}
                                                                        </span>
                                                                    </td>
                                                                ) : null}
                                                                {visibleColumns.includes("entry") ? <td className="px-4 py-3 text-text-primary">{formatPrice(row.entryPrice, 2)}</td> : null}
                                                                {visibleColumns.includes("sl") ? <td className="px-4 py-3 text-price-down">{formatPrice(row.stopLoss, 2)}</td> : null}
                                                                {visibleColumns.includes("close") ? <td className="px-4 py-3 text-text-primary">{formatPrice(row.exitPrice, 2)}</td> : null}
                                                                {visibleColumns.includes("pnlPct") ? <td className={`px-4 py-3 font-semibold ${row.pnlPct !== null && row.pnlPct >= 0 ? "text-price-up" : "text-price-down"}`}>{formatPercent(row.pnlPct)}</td> : null}
                                                                {visibleColumns.includes("pnlR") ? <td className={`px-4 py-3 font-semibold ${row.rMultiple >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.rMultiple, "R")}</td> : null}
                                                                {visibleColumns.includes("pnlUsd") ? <td className={`px-4 py-3 font-semibold ${row.pnlUsd >= 0 ? "text-price-up" : "text-price-down"}`}>{formatSigned(row.pnlUsd, "")}</td> : null}
                                                                {visibleColumns.includes("duration") ? <td className="px-4 py-3 text-text-secondary">{formatDuration(row.durationMs)}</td> : null}
                                                                {visibleColumns.includes("result") ? (
                                                                    <td className="px-4 py-3">
                                                                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${getResultTone(row.result)}`}>
                                                                            {row.result === "ACTIVE" ? <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse-dot" /> : null}
                                                                            {row.result}
                                                                        </span>
                                                                    </td>
                                                                ) : null}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                                <div className="text-sm text-text-secondary">
                                                    Page {tradeData.pagination.page} of {Math.max(tradeData.pagination.totalPages, 1)} | {tradeData.pagination.totalRows} rows
                                                </div>

                                                <div className="flex flex-wrap items-center gap-3">
                                                    <label className="flex items-center gap-2 text-xs text-text-muted">
                                                        Page Size
                                                        <select
                                                            value={String(pageSize)}
                                                            onChange={(event) => replaceQuery({ pageSize: event.target.value, page: "1", selected: null, replay: null })}
                                                            className="rounded-xl border border-border-muted bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                                        >
                                                            {[25, 50, 100].map((value) => (
                                                                <option key={value} value={value}>
                                                                    {value}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>

                                                    <button
                                                        onClick={() => replaceQuery({ page: String(Math.max(page - 1, 1)), selected: null, replay: null })}
                                                        disabled={page <= 1}
                                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary disabled:opacity-50"
                                                    >
                                                        <ChevronLeft className="h-4 w-4" />
                                                        Prev
                                                    </button>
                                                    <button
                                                        onClick={() => replaceQuery({ page: String(Math.min(page + 1, Math.max(tradeData.pagination.totalPages, 1))), selected: null, replay: null })}
                                                        disabled={page >= tradeData.pagination.totalPages}
                                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary disabled:opacity-50"
                                                    >
                                                        Next
                                                        <ChevronRight className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </section>
                        </>
                    )}
                </div>
            </div>

            <BacktestTradeDetailDrawer
                isOpen={Boolean(selectedRow)}
                row={selectedRow}
                context={selectedTradeContext}
                replay={detailReplay}
                isExpanded={isReplayExpanded}
                isLoading={isDrawerLoading}
                error={drawerError}
                engineHref={selectedRowEngineHref}
                onExpand={() => {
                    const next = buildBacktestTradeReplaySearchParams(
                        new URLSearchParams(Array.from(searchParams.entries())),
                        "expanded",
                    );
                    replaceSearchParams(next);
                }}
                onCollapse={() => {
                    const next = buildBacktestTradeReplaySearchParams(
                        new URLSearchParams(Array.from(searchParams.entries())),
                        "drawer",
                    );
                    replaceSearchParams(next);
                }}
                onClose={() => replaceQuery({ selected: null, replay: null })}
            />
        </>
    );
}
