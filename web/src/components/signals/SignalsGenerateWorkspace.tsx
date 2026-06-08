"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import {
    ArrowRight,
    Activity,
    Bot,
    BrainCircuit,
    CandlestickChart,
    ChevronDown,
    ChevronRight,
    Gauge,
    Link2,
    Loader2,
    Minus,
    Play,
    Plus,
    RefreshCw,
    Rocket,
    Search,
    Settings2,
    Shield,
    Trash2,
} from "lucide-react";
import { useIndicators } from "@/hooks/useIndicators";
import { useBacktestProgress } from "@/hooks/useBacktestProgress";
import {
    BlockParamSchemaGroup,
    ExecuteGeneratedBacktestResponse,
    ExecutionConfigView,
    GeneratedBacktestDetail,
    GeneratedBacktestRun,
    IndicatorInstance,
    SignalDefinition,
    SignalDefinitionField,
    SignalPreviewOutput,
    TradeGuardConfig,
} from "@/types/signals";
import {
    describeExitManagementPlan,
    describeStopLossPlan,
    describeTakeProfitPlan,
    EXIT_PROFILE_OPTIONS,
} from "@/lib/composedSignalConfig";
import {
    buildGeneratedBacktestSearchParams,
    buildSignalDefinitionKey,
    parseGeneratedBacktestSearchParams,
} from "@/lib/generatedBacktestContext";
import {
    buildGeneratedBacktestSymbolOptions,
    buildGeneratedBacktestTimeframeOptions,
} from "@/lib/generatedBacktestFormOptions";
import {
    buildGeneratedBacktestMarketContextPatch,
    getGeneratedBacktestExecutionDefaults,
    getInheritedGeneratedBacktestContext,
} from "@/lib/generatedBacktestWorkspaceState";
import MetricCard from "@/components/ui/MetricCard";
import SectionCard from "@/components/ui/SectionCard";
import StateBanner from "@/components/ui/StateBanner";

type ParameterValue = string | boolean;

type OrderTiming = "SIGNAL_BAR_CLOSE" | "NEXT_BAR_OPEN" | "LIMIT_TOUCH";
type StopLossMode = "SIGNAL_PRICE" | "FIXED_AMOUNT" | "ACCOUNT_PERCENT";
type TakeProfitMode = "SIGNAL_PRICE" | "FIXED_AMOUNT" | "ACCOUNT_PERCENT" | "R_MULTIPLE";
type PositionSizingMode = "RISK_BASED" | "FIXED_QUANTITY" | "ACCOUNT_PERCENT";

interface LossStreakThrottleStepForm {
    afterLosses: string;
    riskPercent: string;
}

interface ExecutionFormState {
    entryFeeBps: string;
    exitFeeBps: string;
    entrySlippageBps: string;
    exitSlippageBps: string;
    orderTiming: OrderTiming;
    stopLossMode: StopLossMode;
    stopLossValue: string;
    takeProfitMode: TakeProfitMode;
    takeProfitValue: string;
    positionSizingMode: PositionSizingMode;
    positionSizingValue: string;
    // Trade Guards
    tradeGuardsEnabled: boolean;
    lossStreakThrottleEnabled: boolean;
    lossStreakThrottleSteps: LossStreakThrottleStepForm[];
    lossStreakCooldownEnabled: boolean;
    lossStreakCooldownAfterLosses: string;
    lossStreakCooldownMinutes: string;
    sessionLossCapEnabled: boolean;
    sessionLossCapMaxLosses: string;
    sessionLossCapMaxNetR: string;
    dayLossCapEnabled: boolean;
    dayLossCapMaxLosses: string;
    dayLossCapMaxNetR: string;
    equityCurveFilterEnabled: boolean;
    equityCurveFilterEmaTrades: string;
    equityCurveFilterAction: '' | 'BLOCK' | 'HALF_RISK';
    maxDrawdownHaltEnabled: boolean;
    maxDrawdownHaltPct: string;
    minTradeSpacingEnabled: boolean;
    minTradeSpacingMinutes: string;
}

interface BuilderResult {
    errors: string[];
    payload: Record<string, unknown> | null;
}

const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}`);
    }
    return response.json();
};

const formatDateInput = (value: Date) => value.toISOString().slice(0, 10);
const toUtcRangeStart = (value: string) => `${value}T00:00:00.000Z`;
const toUtcRangeEnd = (value: string) => `${value}T23:59:59.999Z`;
const formatSigned = (value: number, suffix = "") => `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
const formatNumber = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const formatDateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : "n/a");
const canDeleteRun = (status: GeneratedBacktestRun["status"]) => status !== "PENDING" && status !== "RUNNING";

const getDefaultRange = () => {
    const to = new Date();
    const from = new Date(to.getTime() - 180 * 24 * 60 * 1000 * 60); // 180 days
    return {
        from: formatDateInput(from),
        to: formatDateInput(to),
    };
};

const createDefaultExecutionForm = (): ExecutionFormState => ({
    entryFeeBps: "4",
    exitFeeBps: "4",
    entrySlippageBps: "2",
    exitSlippageBps: "2",
    orderTiming: "NEXT_BAR_OPEN",
    stopLossMode: "SIGNAL_PRICE",
    stopLossValue: "",
    takeProfitMode: "SIGNAL_PRICE",
    takeProfitValue: "",
    positionSizingMode: "RISK_BASED",
    positionSizingValue: "",
    // Trade Guards — defaults based on OPT-8 optimization results
    tradeGuardsEnabled: true,
    lossStreakThrottleEnabled: false,
    lossStreakThrottleSteps: [{ afterLosses: "3", riskPercent: "1" }],
    lossStreakCooldownEnabled: false,
    lossStreakCooldownAfterLosses: "5",
    lossStreakCooldownMinutes: "60",
    sessionLossCapEnabled: false,
    sessionLossCapMaxLosses: "3",
    sessionLossCapMaxNetR: "",
    dayLossCapEnabled: false,
    dayLossCapMaxLosses: "5",
    dayLossCapMaxNetR: "",
    equityCurveFilterEnabled: false,
    equityCurveFilterEmaTrades: "10",
    equityCurveFilterAction: "BLOCK",
    maxDrawdownHaltEnabled: false,
    maxDrawdownHaltPct: "10",
    minTradeSpacingEnabled: true,
    minTradeSpacingMinutes: "30",
});

const normalizeDefaultParameters = (definition: SignalDefinition | null) => {
    const next: Record<string, ParameterValue> = {};

    (definition?.parameterSchema?.fields || []).forEach((field) => {
        if (field.type === "boolean") {
            next[field.id] = Boolean(field.default);
            return;
        }

        if (field.default === null || field.default === undefined) {
            next[field.id] = "";
            return;
        }

        next[field.id] = String(field.default);
    });

    return next;
};

const parseNumeric = (value: string) => {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const describeMode = (mode: string, value: number | null | undefined) => {
    if (mode === "SIGNAL_PRICE") return "Strategy Default";
    if (mode === "FIXED_AMOUNT") return `Fixed $${value ?? 0}`;
    if (mode === "ACCOUNT_PERCENT") return `${value ?? 0}% account`;
    if (mode === "R_MULTIPLE") return `${value ?? 0}R`;
    if (mode === "FIXED_QUANTITY") return `Qty ${value ?? 0}`;
    if (mode === "RISK_BASED") return "Risk based";
    return mode;
};

function ParameterFieldControl({
    field,
    value,
    onChange,
}: {
    field: SignalDefinitionField;
    value: ParameterValue;
    onChange: (next: ParameterValue) => void;
}) {
    if (field.type === "boolean") {
        return (
            <label className="flex min-h-[72px] items-center justify-between rounded-2xl border border-border-muted bg-bg-tertiary/45 px-4 py-3 text-sm text-text-primary">
                <div>
                    <div className="font-bold">{field.label}</div>
                    <div className="mt-1 text-xs text-text-muted">{field.id}</div>
                </div>
                <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => onChange(event.target.checked)}
                    className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                />
            </label>
        );
    }

    if (field.type === "select") {
        return (
            <label className="flex flex-col gap-1 text-xs text-text-muted">
                {field.label}
                <select
                    value={String(value ?? "")}
                    onChange={(event) => onChange(event.target.value)}
                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                >
                    <option value="">Select an option</option>
                    {(field.options || []).map((option) => (
                        <option key={String(option)} value={String(option)}>
                            {String(option)}
                        </option>
                    ))}
                </select>
            </label>
        );
    }

    const hasBounds = field.type === "number" && (field.min !== undefined || field.max !== undefined);
    const numValue = field.type === "number" ? Number(value) : NaN;
    const outOfBounds = hasBounds && !isNaN(numValue) && String(value) !== "" && (
        (field.min !== undefined && numValue < field.min) ||
        (field.max !== undefined && numValue > field.max)
    );

    return (
        <label className="flex flex-col gap-1 text-xs text-text-muted">
            <span>
                {field.label}
                {hasBounds ? (
                    <span className="ml-1 text-[10px] opacity-60">
                        ({field.min !== undefined ? field.min : "..."}&ndash;{field.max !== undefined ? field.max : "..."})
                    </span>
                ) : null}
            </span>
            <input
                type={field.type === "number" ? "number" : "text"}
                step={field.type === "number" ? (field.step ?? "any") : undefined}
                min={field.type === "number" ? field.min : undefined}
                max={field.type === "number" ? field.max : undefined}
                value={String(value ?? "")}
                onChange={(event) => onChange(event.target.value)}
                className={`rounded-xl border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50 ${outOfBounds ? "border-red-500" : "border-border-muted"}`}
            />
            {outOfBounds ? (
                <span className="text-[10px] text-red-500">
                    Value must be between {field.min ?? "..."} and {field.max ?? "..."}
                </span>
            ) : null}
        </label>
    );
}

export default function SignalsGenerateWorkspace() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const defaultRange = useMemo(() => getDefaultRange(), []);
    const routeContext = useMemo(
        () => parseGeneratedBacktestSearchParams(new URLSearchParams(searchParams.toString())),
        [searchParams],
    );
    const [definitions, setDefinitions] = useState<SignalDefinition[]>([]);
    const [runs, setRuns] = useState<GeneratedBacktestRun[]>([]);
    const [selectedDefinitionKey, setSelectedDefinitionKey] = useState("");
    const [parameterValues, setParameterValues] = useState<Record<string, ParameterValue>>({});
    const [blockParamOverrides, setBlockParamOverrides] = useState<Record<string, Record<string, ParameterValue>>>({});
    const [exitStrategyOverride, setExitStrategyOverride] = useState("");
    const [exitProfileCustom, setExitProfileCustom] = useState({
        enabled: false,
        breakEvenAtR: "",
        partialAtR: "",
        partialCloseFraction: "",
        maxBarsInTrade: "",
    });
    const [selectedRunId, setSelectedRunId] = useState("");
    const [selectedRunDetail, setSelectedRunDetail] = useState<GeneratedBacktestDetail | null>(null);
    const [previewData, setPreviewData] = useState<SignalPreviewOutput | null>(null);
    const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [isRunDetailLoading, setIsRunDetailLoading] = useState(false);
    const [isSymbolsLoading, setIsSymbolsLoading] = useState(false);
    const [isDeletingRunId, setIsDeletingRunId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [form, setForm] = useState({
        symbol: "BTCUSD",
        timeframe: "1h",
        fromDate: defaultRange.from,
        toDate: defaultRange.to,
        initialEquity: "10000",
        riskPercent: "2",
    });
    const [executionForm, setExecutionForm] = useState<ExecutionFormState>(createDefaultExecutionForm);

    // Batch 3
    const { promoteBacktest } = useIndicators();
    const [isActivating, setIsActivating] = useState(false);
    const [activatedInstance, setActivatedInstance] = useState<IndicatorInstance | null>(null);

    // Async backtest progress via Socket.IO
    const { progressMap, getProgress } = useBacktestProgress();

    // Run history filters
    const [filterNotes, setFilterNotes] = useState("");
    const [filterSignalCode, setFilterSignalCode] = useState("");
    const signalCodeOptions = useMemo(
        () => [...new Set(definitions.map((d) => d.code))].sort(),
        [definitions],
    );

    const replaceRouteContext = useCallback((patch: Partial<{
        definitionKey: string | null;
        symbol: string | null;
        timeframe: string | null;
        runId: string | null;
    }>) => {
        const params = buildGeneratedBacktestSearchParams({
            definitionKey: patch.definitionKey === undefined ? routeContext.definitionKey : patch.definitionKey,
            symbol: patch.symbol === undefined ? routeContext.symbol : patch.symbol,
            timeframe: patch.timeframe === undefined ? routeContext.timeframe : patch.timeframe,
            runId: patch.runId === undefined ? routeContext.runId : patch.runId,
        }, new URLSearchParams(searchParams.toString()));
        const query = params.toString();

        startTransition(() => {
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        });
    }, [
        pathname,
        routeContext.definitionKey,
        routeContext.runId,
        routeContext.symbol,
        routeContext.timeframe,
        router,
        searchParams,
    ]);

    const loadGeneratedReference = useCallback(async () => {
        const [definitionsResult, runsResult] = await Promise.all([
            fetchJson<{ data: SignalDefinition[] }>(`${apiUrl}/api/signals/definitions`),
            fetchJson<{ data: GeneratedBacktestRun[] }>(`${apiUrl}/api/signals/backtests`),
        ]);

        setDefinitions(definitionsResult.data);
        setRuns(runsResult.data);
        setSelectedDefinitionKey((current) => {
            if (routeContext.definitionKey) return routeContext.definitionKey;
            if (current || definitionsResult.data.length === 0) return current;
            const first = definitionsResult.data[0];
            return buildSignalDefinitionKey(first);
        });
        setSelectedRunId((current) => routeContext.runId || current || runsResult.data[0]?.id || "");
    }, [apiUrl, routeContext.definitionKey, routeContext.runId]);

    useEffect(() => {
        let active = true;

        loadGeneratedReference()
            .catch((fetchError) => {
                if (!active) return;
                setError(fetchError.message);
            })
            .finally(() => {
                if (!active) return;
                setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [loadGeneratedReference]);

    const selectedDefinition = useMemo(() => (
        definitions.find((definition) => buildSignalDefinitionKey(definition) === selectedDefinitionKey) ?? null
    ), [definitions, selectedDefinitionKey]);

    const inheritedBacktestContext = useMemo(
        () => getInheritedGeneratedBacktestContext(selectedDefinition),
        [selectedDefinition],
    );
    const symbolOptions = useMemo(() => buildGeneratedBacktestSymbolOptions({
        availableSymbols,
        currentSymbol: form.symbol,
        inheritedSymbol: inheritedBacktestContext.symbol,
    }), [availableSymbols, form.symbol, inheritedBacktestContext.symbol]);
    const timeframeOptions = useMemo(() => buildGeneratedBacktestTimeframeOptions({
        currentTimeframe: form.timeframe,
        inheritedTimeframe: inheritedBacktestContext.timeframe,
    }), [form.timeframe, inheritedBacktestContext.timeframe]);

    useEffect(() => {
        if (routeContext.definitionKey && routeContext.definitionKey !== selectedDefinitionKey) {
            setSelectedDefinitionKey(routeContext.definitionKey);
        }
    }, [routeContext.definitionKey, selectedDefinitionKey]);

    useEffect(() => {
        if (routeContext.runId && routeContext.runId !== selectedRunId) {
            setSelectedRunId(routeContext.runId);
        }
    }, [routeContext.runId, selectedRunId]);

    useEffect(() => {
        setParameterValues(normalizeDefaultParameters(selectedDefinition));
        setPreviewData(null);

        // Initialize block parameter overrides from blockParamSchemas defaults
        const blockDefaults: Record<string, Record<string, ParameterValue>> = {};
        (selectedDefinition?.blockParamSchemas ?? []).forEach((group) => {
            const groupValues: Record<string, ParameterValue> = {};
            group.paramSchema.forEach((field) => {
                groupValues[field.id] = field.default !== undefined && field.default !== null
                    ? String(field.default)
                    : "";
            });
            blockDefaults[group.blockId] = groupValues;
        });
        setBlockParamOverrides(blockDefaults);
        setExitStrategyOverride(
            selectedDefinition?.composedBlocks?.exitManagement?.profileCode ?? "HARD_SIGNAL_TP",
        );

        const executionDefaults = getGeneratedBacktestExecutionDefaults(selectedDefinition);
        if (executionDefaults) {
            setExecutionForm((current) => ({
                ...current,
                ...executionDefaults,
            }));
        }
    }, [selectedDefinition]);

    useEffect(() => {
        const marketContextPatch = buildGeneratedBacktestMarketContextPatch({
            routeContext: {
                symbol: routeContext.symbol,
                timeframe: routeContext.timeframe,
            },
            inheritedContext: inheritedBacktestContext,
        });

        if (Object.keys(marketContextPatch).length === 0) {
            return;
        }

        setForm((current) => ({
            ...current,
            ...marketContextPatch,
        }));
    }, [inheritedBacktestContext, routeContext.symbol, routeContext.timeframe]);

    useEffect(() => {
        let active = true;
        setIsSymbolsLoading(true);

        fetchJson<string[]>(`${apiUrl}/api/symbols`)
            .then((symbols) => {
                if (!active || !Array.isArray(symbols)) {
                    return;
                }

                setAvailableSymbols(symbols);
            })
            .catch(() => {
                if (!active) {
                    return;
                }

                setAvailableSymbols([]);
            })
            .finally(() => {
                if (!active) {
                    return;
                }

                setIsSymbolsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl]);

    useEffect(() => {
        if (!selectedRunId) {
            setSelectedRunDetail(null);
            return;
        }

        let active = true;
        setIsRunDetailLoading(true);

        fetchJson<{ data: GeneratedBacktestDetail }>(`${apiUrl}/api/signals/backtests/${selectedRunId}`)
            .then((result) => {
                if (!active) return;
                setSelectedRunDetail(result.data);
            })
            .catch((fetchError) => {
                if (!active) return;
                setError(fetchError.message);
            })
            .finally(() => {
                if (!active) return;
                setIsRunDetailLoading(false);
            });

        return () => {
            active = false;
        };
    }, [apiUrl, selectedRunId]);

    const validation = useMemo<BuilderResult>(() => {
        const errors: string[] = [];

        if (!selectedDefinition) {
            errors.push("Signal definition is required.");
        }
        if (!form.symbol.trim()) {
            errors.push("Symbol is required.");
        }
        if (!form.timeframe.trim()) {
            errors.push("Timeframe is required.");
        }
        if (!form.fromDate || !form.toDate) {
            errors.push("Date range is required.");
        } else if (new Date(toUtcRangeStart(form.fromDate)) >= new Date(toUtcRangeEnd(form.toDate))) {
            errors.push("Date range is invalid.");
        }

        const initialEquity = parseNumeric(form.initialEquity);
        if (initialEquity === null || initialEquity <= 0) {
            errors.push("Initial equity must be a positive number.");
        }

        const riskPercent = parseNumeric(form.riskPercent);
        if (riskPercent === null || riskPercent <= 0) {
            errors.push("Risk percent must be a positive number.");
        }

        const parameters: Record<string, unknown> = {};
        (selectedDefinition?.parameterSchema?.fields || []).forEach((field) => {
            const rawValue = parameterValues[field.id];
            if (field.type === "boolean") {
                parameters[field.id] = Boolean(rawValue);
                return;
            }

            if (field.type === "number") {
                const parsed = parseNumeric(String(rawValue ?? ""));
                if (parsed === null) {
                    errors.push(`${field.label} must be a number.`);
                    return;
                }
                parameters[field.id] = parsed;
                return;
            }

            const text = String(rawValue ?? "").trim();
            if (!text) {
                errors.push(`${field.label} is required.`);
                return;
            }
            parameters[field.id] = text;
        });

        // Validate and collect block parameter overrides
        const blockOverrides: Record<string, Record<string, unknown>> = {};
        (selectedDefinition?.blockParamSchemas ?? []).forEach((group) => {
            const groupOverrides: Record<string, unknown> = {};
            group.paramSchema.forEach((field) => {
                const rawValue = blockParamOverrides[group.blockId]?.[field.id];
                if (field.type === "number") {
                    const parsed = parseNumeric(String(rawValue ?? ""));
                    if (parsed === null) return;
                    if (field.min !== undefined && parsed < field.min) {
                        errors.push(`${group.indicatorName} > ${field.label} must be >= ${field.min}`);
                        return;
                    }
                    if (field.max !== undefined && parsed > field.max) {
                        errors.push(`${group.indicatorName} > ${field.label} must be <= ${field.max}`);
                        return;
                    }
                    groupOverrides[field.id] = parsed;
                } else if (field.type === "boolean") {
                    groupOverrides[field.id] = Boolean(rawValue);
                } else {
                    const text = String(rawValue ?? "").trim();
                    if (text) groupOverrides[field.id] = text;
                }
            });
            if (Object.keys(groupOverrides).length > 0) {
                blockOverrides[group.blockId] = groupOverrides;
            }
        });

        // Merge block overrides into parameters payload
        if (Object.keys(blockOverrides).length > 0) {
            parameters.blockParamOverrides = blockOverrides;
        }

        // Include exit strategy override
        if (exitStrategyOverride) {
            parameters.exitStrategy = exitStrategyOverride;
        }

        // Include exit profile custom overrides
        if (exitProfileCustom.enabled) {
            const overrides: Record<string, unknown> = {};
            const beR = parseNumeric(exitProfileCustom.breakEvenAtR);
            const partR = parseNumeric(exitProfileCustom.partialAtR);
            const partFrac = parseNumeric(exitProfileCustom.partialCloseFraction);
            const maxBars = parseNumeric(exitProfileCustom.maxBarsInTrade);
            if (beR !== null) overrides.breakEvenAtR = beR;
            if (partR !== null) overrides.partialAtR = partR;
            if (partFrac !== null) {
                if (partFrac < 0 || partFrac > 1) errors.push("Partial close fraction must be between 0 and 1.");
                overrides.partialCloseFraction = partFrac;
            }
            if (maxBars !== null) overrides.maxBarsInTrade = maxBars;
            if (Object.keys(overrides).length > 0) {
                parameters.exitProfileOverrides = overrides;
            }
        }

        const entryFeeBps = parseNumeric(executionForm.entryFeeBps);
        const exitFeeBps = parseNumeric(executionForm.exitFeeBps);
        const entrySlippageBps = parseNumeric(executionForm.entrySlippageBps);
        const exitSlippageBps = parseNumeric(executionForm.exitSlippageBps);

        if (entryFeeBps === null || entryFeeBps < 0) errors.push("Entry fee bps must be 0 or greater.");
        if (exitFeeBps === null || exitFeeBps < 0) errors.push("Exit fee bps must be 0 or greater.");
        if (entrySlippageBps === null || entrySlippageBps < 0) errors.push("Entry slippage bps must be 0 or greater.");
        if (exitSlippageBps === null || exitSlippageBps < 0) errors.push("Exit slippage bps must be 0 or greater.");

        const stopLossValue = parseNumeric(executionForm.stopLossValue);
        const takeProfitValue = parseNumeric(executionForm.takeProfitValue);
        const positionSizingValue = parseNumeric(executionForm.positionSizingValue);

        if (executionForm.stopLossMode !== "SIGNAL_PRICE" && (stopLossValue === null || stopLossValue <= 0)) {
            errors.push("Stop-loss value must be positive for the selected mode.");
        }
        if (executionForm.takeProfitMode !== "SIGNAL_PRICE" && (takeProfitValue === null || takeProfitValue <= 0)) {
            errors.push("Take-profit value must be positive for the selected mode.");
        }
        if (executionForm.positionSizingMode !== "RISK_BASED" && (positionSizingValue === null || positionSizingValue <= 0)) {
            errors.push("Position sizing value must be positive for the selected mode.");
        }
        if (executionForm.positionSizingMode === "RISK_BASED" && executionForm.stopLossMode !== "SIGNAL_PRICE") {
            errors.push("Risk-based position sizing currently requires stop-loss mode = Strategy Default.");
        }

        if (errors.length > 0 || !selectedDefinition || initialEquity === null || riskPercent === null || entryFeeBps === null || exitFeeBps === null || entrySlippageBps === null || exitSlippageBps === null) {
            return { errors, payload: null };
        }

        return {
            errors,
            payload: {
                signalCode: selectedDefinition.code,
                signalVersion: selectedDefinition.version,
                symbol: form.symbol.trim(),
                timeframe: form.timeframe.trim(),
                dateRange: {
                    from: toUtcRangeStart(form.fromDate),
                    to: toUtcRangeEnd(form.toDate),
                },
                parameters,
                initialEquity,
                riskPercent,
                executionConfig: {
                    entryFeeBps,
                    exitFeeBps,
                    entrySlippageBps,
                    exitSlippageBps,
                    orderTiming: executionForm.orderTiming,
                    stopLoss: {
                        mode: executionForm.stopLossMode,
                        ...(executionForm.stopLossMode !== "SIGNAL_PRICE" ? { value: stopLossValue } : {}),
                    },
                    takeProfit: {
                        mode: executionForm.takeProfitMode,
                        ...(executionForm.takeProfitMode !== "SIGNAL_PRICE" ? { value: takeProfitValue } : {}),
                    },
                    positionSizing: {
                        mode: executionForm.positionSizingMode,
                        ...(executionForm.positionSizingMode !== "RISK_BASED" ? { value: positionSizingValue } : {}),
                    },
                    ...(executionForm.tradeGuardsEnabled ? {
                        tradeGuards: {
                            ...(executionForm.lossStreakThrottleEnabled && executionForm.lossStreakThrottleSteps.length > 0 ? {
                                lossStreakThrottle: {
                                    steps: executionForm.lossStreakThrottleSteps
                                        .filter(s => s.afterLosses && s.riskPercent)
                                        .map(s => ({ afterLosses: Number(s.afterLosses), riskPercent: Number(s.riskPercent) })),
                                },
                            } : {}),
                            ...(executionForm.lossStreakCooldownEnabled ? {
                                lossStreakCooldown: {
                                    ...(executionForm.lossStreakCooldownAfterLosses ? { afterLosses: Number(executionForm.lossStreakCooldownAfterLosses) } : {}),
                                    ...(executionForm.lossStreakCooldownMinutes ? { cooldownMinutes: Number(executionForm.lossStreakCooldownMinutes) } : {}),
                                },
                            } : {}),
                            ...(executionForm.sessionLossCapEnabled ? {
                                sessionLossCap: {
                                    ...(executionForm.sessionLossCapMaxLosses ? { maxLosses: Number(executionForm.sessionLossCapMaxLosses) } : {}),
                                    ...(executionForm.sessionLossCapMaxNetR ? { maxNetR: Number(executionForm.sessionLossCapMaxNetR) } : {}),
                                },
                            } : {}),
                            ...(executionForm.dayLossCapEnabled ? {
                                dayLossCap: {
                                    ...(executionForm.dayLossCapMaxLosses ? { maxLosses: Number(executionForm.dayLossCapMaxLosses) } : {}),
                                    ...(executionForm.dayLossCapMaxNetR ? { maxNetR: Number(executionForm.dayLossCapMaxNetR) } : {}),
                                },
                            } : {}),
                            ...(executionForm.equityCurveFilterEnabled ? {
                                equityCurveFilter: {
                                    ...(executionForm.equityCurveFilterEmaTrades ? { emaTrades: Number(executionForm.equityCurveFilterEmaTrades) } : {}),
                                    ...(executionForm.equityCurveFilterAction ? { action: executionForm.equityCurveFilterAction } : {}),
                                },
                            } : {}),
                            ...(executionForm.maxDrawdownHaltEnabled ? {
                                maxDrawdownHalt: {
                                    ...(executionForm.maxDrawdownHaltPct ? { maxDrawdownPct: Number(executionForm.maxDrawdownHaltPct) } : {}),
                                },
                            } : {}),
                            ...(executionForm.minTradeSpacingEnabled ? {
                                minTradeSpacing: {
                                    ...(executionForm.minTradeSpacingMinutes ? { minSpacingMinutes: Number(executionForm.minTradeSpacingMinutes) } : {}),
                                },
                            } : {}),
                        },
                    } : {}),
                },
            },
        };
    }, [blockParamOverrides, exitProfileCustom, exitStrategyOverride, executionForm, form.fromDate, form.initialEquity, form.riskPercent, form.symbol, form.timeframe, form.toDate, parameterValues, selectedDefinition]);

    const previewSample = useMemo(() => ({
        firstResult: previewData?.results?.[0] ?? null,
        firstLifecycleEvent: previewData?.events?.find((event) => (
            ["TRAP", "ENTRY", "MOVE_SL_BE", "TRAIL_START", "TP1_HIT", "STOP_HIT", "EXPIRATION"].includes(event.eventType)
        )) ?? null,
    }), [previewData]);

    const handlePreview = async () => {
        if (!validation.payload) {
            setError(validation.errors[0] || "Preview configuration is invalid.");
            return;
        }

        setIsPreviewing(true);
        setError(null);
        setSuccess(null);
        setActivatedInstance(null);

        try {
            const response = await fetch(`${apiUrl}/api/signals/preview`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validation.payload),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Failed to preview generated signal");
            }

            setPreviewData(result.data);
            setSuccess(`Preview completed for ${result.data.signalCode}@${result.data.signalVersion}.`);
        } catch (previewError) {
            setError(previewError instanceof Error ? previewError.message : "Preview failed");
        } finally {
            setIsPreviewing(false);
        }
    };

    const refreshRuns = useCallback(async (filters?: { notes?: string; signalCode?: string }) => {
        const params = new URLSearchParams();
        if (filters?.notes) params.set("notes", filters.notes);
        if (filters?.signalCode) params.set("signalCode", filters.signalCode);
        const qs = params.toString();
        const runsResult = await fetchJson<{ data: GeneratedBacktestRun[] }>(`${apiUrl}/api/signals/backtests${qs ? `?${qs}` : ""}`);
        setRuns(runsResult.data);
        return runsResult.data;
    }, [apiUrl]);

    const handleDefinitionChange = useCallback((nextDefinitionKey: string) => {
        const nextDefinition = definitions.find((definition) => buildSignalDefinitionKey(definition) === nextDefinitionKey) ?? null;
        const nextSymbol = (
            nextDefinition?.isComposed
                ? nextDefinition.composedBlocks?.symbol ?? form.symbol
                : form.symbol
        ) || null;
        const nextTimeframe = (
            nextDefinition?.isComposed
                ? getInheritedGeneratedBacktestContext(nextDefinition).timeframe ?? form.timeframe
                : form.timeframe
        ) || null;

        setSelectedDefinitionKey(nextDefinitionKey);
        setPreviewData(null);
        replaceRouteContext({
            definitionKey: nextDefinitionKey || null,
            symbol: nextSymbol,
            timeframe: nextTimeframe,
        });
    }, [definitions, form.symbol, form.timeframe, replaceRouteContext]);

    const handleSymbolChange = useCallback((nextSymbol: string) => {
        const normalized = nextSymbol.trim();
        setForm((current) => ({ ...current, symbol: normalized }));
        replaceRouteContext({ symbol: normalized || null });
    }, [replaceRouteContext]);

    const handleTimeframeChange = useCallback((nextTimeframe: string) => {
        setForm((current) => ({ ...current, timeframe: nextTimeframe }));
        replaceRouteContext({ timeframe: nextTimeframe || null });
    }, [replaceRouteContext]);

    const handleRunSelection = useCallback((nextRunId: string) => {
        setSelectedRunId(nextRunId);
        setActivatedInstance(null);
        replaceRouteContext({ runId: nextRunId || null });
    }, [replaceRouteContext]);

    const handleDeleteRun = useCallback(async (run: GeneratedBacktestRun) => {
        if (!canDeleteRun(run.status)) {
            setError("Only completed, failed, or canceled generated runs can be deleted.");
            return;
        }

        const confirmed = window.confirm(`Delete generated run "${run.name}"? This removes the saved generated run history from this workspace.`);
        if (!confirmed) {
            return;
        }

        setIsDeletingRunId(run.id);
        setError(null);
        setSuccess(null);
        setActivatedInstance(null);

        try {
            const response = await fetch(`${apiUrl}/api/signals/backtests/${run.id}`, {
                method: "DELETE",
            });
            const result = await response.json().catch(() => null) as { data?: { id: string; name: string }; error?: string } | null;
            if (!response.ok) {
                throw new Error(result?.error || "Failed to delete generated run");
            }

            const refreshedRuns = await refreshRuns();
            if (selectedRunId === run.id) {
                const nextRunId = refreshedRuns[0]?.id || "";
                setSelectedRunDetail(null);
                handleRunSelection(nextRunId);
            }

            setSuccess(`Deleted generated run ${result?.data?.name || run.name}.`);
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : "Failed to delete generated run");
        } finally {
            setIsDeletingRunId(null);
        }
    }, [apiUrl, handleRunSelection, refreshRuns, selectedRunId]);

    const handleRun = async () => {
        if (!validation.payload) {
            setError(validation.errors[0] || "Run configuration is invalid.");
            return;
        }

        setIsRunning(true);
        setError(null);
        setSuccess(null);
        setActivatedInstance(null);

        try {
            const response = await fetch(`${apiUrl}/api/signals/backtests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...validation.payload,
                    executeNow: true,
                    async: true,
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Failed to run generated backtest");
            }

            // Async mode: API returns 202 with queued: true
            if (result.data?.queued === true) {
                const runId = result.data.created?.backtestRunId;
                await refreshRuns();
                if (runId) {
                    handleRunSelection(runId);
                }
                setSuccess(`Backtest queued for async execution. Live progress will appear below.`);
                setIsRunning(false);
                return;
            }

            // Synchronous fallback (worker not available)
            const typed = result.data as ExecuteGeneratedBacktestResponse;
            const refreshedRuns = await refreshRuns();
            handleRunSelection(typed.created.backtestRunId);
            setSuccess(`Generated run ${typed.created.backtestRunId} completed with ${typed.execution?.counts.persistedResults ?? 0} persisted results.`);
            if (refreshedRuns.length === 0) {
                setSelectedRunDetail(null);
            }
        } catch (runError) {
            setError(runError instanceof Error ? runError.message : "Generated run failed");
        } finally {
            setIsRunning(false);
        }
    };

    // Auto-refresh when a backtest run completes or fails via Socket.IO progress
    useEffect(() => {
        let needsRefresh = false;
        progressMap.forEach((progress) => {
            if (progress.status === 'COMPLETED' || progress.status === 'FAILED') {
                needsRefresh = true;
            }
        });

        if (!needsRefresh) return;

        refreshRuns().catch(() => {});

        // If the currently selected run just completed/failed, refresh its detail too
        if (selectedRunId) {
            const currentProgress = progressMap.get(selectedRunId);
            if (currentProgress?.status === 'COMPLETED' || currentProgress?.status === 'FAILED') {
                fetchJson<{ data: GeneratedBacktestDetail }>(`${apiUrl}/api/signals/backtests/${selectedRunId}`)
                    .then((result) => setSelectedRunDetail(result.data))
                    .catch(() => {});
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [progressMap]);

    if (isLoading) {
        return (
            <div className="grid h-full place-items-center rounded-[28px] border border-border-muted bg-bg-primary/90">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
            </div>
        );
    }

    return (
        <div className="grid gap-6">
            <SectionCard
                title="Generated Backtests"
                description="Run historical backtests"
                icon={<Bot className="h-5 w-5" />}
            >
                {(routeContext.definitionKey || routeContext.runId) ? (
                    <div className="mb-4 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-text-secondary">
                        {routeContext.runId ? (
                            <span>
                                Restored generated run context for <span className="font-mono font-bold text-text-primary">{routeContext.runId}</span>. You can keep reviewing this run or launch a new one from the same signal setup.
                            </span>
                        ) : (
                            <span>
                                Signal context was carried in from the saved definition. Review the inherited symbol and timeframe, then choose the historical range before execution.
                            </span>
                        )}
                    </div>
                ) : null}
                <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="grid gap-4">
                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">Signal Definition</div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <label className="flex flex-col gap-1 text-xs text-text-muted md:col-span-2">
                                    Definition
                                    <select
                                        value={selectedDefinitionKey}
                                        onChange={(event) => handleDefinitionChange(event.target.value)}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                    >
                                        <option value="">Select a signal definition</option>
                                        {definitions.length === 0 ? (
                                            <option disabled value="">No definitions found. Please run seed script.</option>
                                        ) : (
                                            definitions.map((definition) => (
                                                <option key={definition.id} value={`${definition.code}:${definition.version}`}>
                                                    {definition.name} / {definition.code}@{definition.version}
                                                </option>
                                            ))
                                        )}
                                    </select>
                                    {definitions.length === 0 && (
                                        <div className="mt-2 rounded-xl border border-price-down/20 bg-price-down/10 px-4 py-2 text-xs text-price-down">
                                            No signal definitions detected. Please run `npm run seed:signals` in the server terminal to populate default strategies.
                                        </div>
                                    )}
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    <div className="flex items-center justify-between">
                                        Symbol
                                        {inheritedBacktestContext.symbol === form.symbol && (
                                            <div className="flex items-center gap-1 text-[9px] text-accent uppercase font-bold">
                                                <Link2 size={10} />
                                                Inherited
                                            </div>
                                        )}
                                    </div>
                                    <select
                                        value={form.symbol}
                                        onChange={(event) => handleSymbolChange(event.target.value)}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    >
                                        <option value="">
                                            {isSymbolsLoading ? "Loading symbols..." : "Select a symbol"}
                                        </option>
                                        {symbolOptions.map((symbol) => (
                                            <option key={symbol} value={symbol}>
                                                {symbol}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    <div className="flex items-center justify-between">
                                        Timeframe
                                        {inheritedBacktestContext.timeframe === form.timeframe && (
                                            <div className="flex items-center gap-1 text-[9px] text-accent uppercase font-bold">
                                                <Link2 size={10} />
                                                Inherited
                                            </div>
                                        )}
                                    </div>
                                    <select
                                        value={form.timeframe}
                                        onChange={(event) => handleTimeframeChange(event.target.value)}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    >
                                        <option value="">Select a timeframe</option>
                                        {timeframeOptions.map((timeframe) => (
                                            <option key={timeframe} value={timeframe}>
                                                {timeframe}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    From (UTC)
                                    <input
                                        type="date"
                                        value={form.fromDate}
                                        onChange={(event) => setForm((current) => ({ ...current, fromDate: event.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    To (UTC)
                                    <input
                                        type="date"
                                        value={form.toDate}
                                        onChange={(event) => setForm((current) => ({ ...current, toDate: event.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    Initial equity
                                    <input
                                        type="number"
                                        step="any"
                                        value={form.initialEquity}
                                        onChange={(event) => setForm((current) => ({ ...current, initialEquity: event.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                    Risk percent
                                    <input
                                        type="number"
                                        step="any"
                                        value={form.riskPercent}
                                        onChange={(event) => setForm((current) => ({ ...current, riskPercent: event.target.value }))}
                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                    />
                                </label>
                            </div>

                            {selectedDefinition ? (
                                <div className="mt-4 rounded-2xl border border-border-muted bg-bg-primary/70 p-4 text-sm text-text-secondary">
                                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">Definition Context</div>
                                    <div className="mt-2 text-text-primary">{selectedDefinition.name} / {selectedDefinition.code}@{selectedDefinition.version}</div>
                                    <div className="mt-1">{selectedDefinition.description || "No description yet."}</div>
                                    {selectedDefinition.category ? (
                                        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-text-muted">{selectedDefinition.category}</div>
                                    ) : null}

                                    {selectedDefinition.isComposed && selectedDefinition.composedBlocks && (
                                        <div className="mt-3 pt-3 border-t border-border-muted/30 grid grid-cols-2 gap-3">
                                            <div>
                                                <div className="text-[10px] text-text-muted uppercase font-bold">Protection</div>
                                                <div className="mt-0.5 text-xs font-mono text-price-down">
                                                    {describeStopLossPlan(selectedDefinition.composedBlocks.stopLoss)}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-[10px] text-text-muted uppercase font-bold">Exit</div>
                                                <div className="mt-0.5 text-xs font-mono text-price-up">
                                                    {describeTakeProfitPlan(selectedDefinition.composedBlocks.takeProfit)}
                                                </div>
                                                <div className="mt-1 text-[10px] leading-4 text-text-muted">
                                                    {describeExitManagementPlan(selectedDefinition.composedBlocks.exitManagement?.profileCode || 'HARD_SIGNAL_TP')}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </div>

                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                                <BrainCircuit className="h-4 w-4" />
                                Signal Parameters
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {(selectedDefinition?.parameterSchema?.fields || []).map((field) => (
                                    <ParameterFieldControl
                                        key={field.id}
                                        field={field}
                                        value={parameterValues[field.id] ?? ""}
                                        onChange={(next) => setParameterValues((current) => ({ ...current, [field.id]: next }))}
                                    />
                                ))}
                                {selectedDefinition?.parameterSchema?.fields?.length ? null : (
                                    <div className="rounded-2xl border border-dashed border-border-muted bg-bg-primary/50 p-4 text-sm text-text-secondary">
                                        This definition does not expose parameter fields yet.
                                    </div>
                                )}
                            </div>
                        </div>

                        {(selectedDefinition?.blockParamSchemas?.length ?? 0) > 0 ? (
                            <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                                    <Settings2 className="h-4 w-4" />
                                    Block Parameters
                                </div>
                                <div className="mt-4 space-y-4">
                                    {selectedDefinition!.blockParamSchemas!.map((group) => (
                                        <div key={group.blockId} className="rounded-xl border border-border-muted bg-bg-primary/70 p-3">
                                            <div className="text-xs font-bold text-text-primary">{group.indicatorName}</div>
                                            <div className="text-[10px] text-text-muted">{group.indicatorId}</div>
                                            <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                                {group.paramSchema.map((field) => (
                                                    <ParameterFieldControl
                                                        key={`${group.blockId}:${field.id}`}
                                                        field={field}
                                                        value={blockParamOverrides[group.blockId]?.[field.id] ?? ""}
                                                        onChange={(next) => setBlockParamOverrides((current) => ({
                                                            ...current,
                                                            [group.blockId]: {
                                                                ...(current[group.blockId] ?? {}),
                                                                [field.id]: next,
                                                            },
                                                        }))}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                                <Shield className="h-4 w-4" />
                                Exit Profile
                            </div>
                            <div className="mt-4">
                                <select
                                    value={exitStrategyOverride}
                                    onChange={(e) => setExitStrategyOverride(e.target.value)}
                                    className="w-full rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                >
                                    {EXIT_PROFILE_OPTIONS.map((profile) => (
                                        <option key={profile.value} value={profile.value}>
                                            {profile.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-2 text-xs text-text-secondary">
                                    {EXIT_PROFILE_OPTIONS.find((p) => p.value === exitStrategyOverride)?.description ?? ""}
                                </p>
                                <details className="mt-3">
                                    <summary className="cursor-pointer text-xs font-bold text-text-muted hover:text-text-primary">
                                        Advanced Protection Overrides
                                    </summary>
                                    <div className="mt-3 space-y-3">
                                        <label className="flex items-center gap-2 text-xs text-text-muted">
                                            <input
                                                type="checkbox"
                                                checked={exitProfileCustom.enabled}
                                                onChange={(e) => setExitProfileCustom((c) => ({ ...c, enabled: e.target.checked }))}
                                                className="h-3.5 w-3.5 rounded border-border-muted"
                                            />
                                            Enable custom overrides
                                        </label>
                                        {exitProfileCustom.enabled && (
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                    Break-even at R
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        min="0"
                                                        placeholder="e.g. 1.0"
                                                        value={exitProfileCustom.breakEvenAtR}
                                                        onChange={(e) => setExitProfileCustom((c) => ({ ...c, breakEvenAtR: e.target.value }))}
                                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                    Partial close at R
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        min="0"
                                                        placeholder="e.g. 1.0"
                                                        value={exitProfileCustom.partialAtR}
                                                        onChange={(e) => setExitProfileCustom((c) => ({ ...c, partialAtR: e.target.value }))}
                                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                    Partial close fraction (0-1)
                                                    <input
                                                        type="number"
                                                        step="0.05"
                                                        min="0"
                                                        max="1"
                                                        placeholder="e.g. 0.5"
                                                        value={exitProfileCustom.partialCloseFraction}
                                                        onChange={(e) => setExitProfileCustom((c) => ({ ...c, partialCloseFraction: e.target.value }))}
                                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                    Max bars in trade
                                                    <input
                                                        type="number"
                                                        step="1"
                                                        min="1"
                                                        placeholder="e.g. 24"
                                                        value={exitProfileCustom.maxBarsInTrade}
                                                        onChange={(e) => setExitProfileCustom((c) => ({ ...c, maxBarsInTrade: e.target.value }))}
                                                        className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                    />
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                </details>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                                <Settings2 className="h-4 w-4" />
                                Execution Settings
                            </div>
                            <div className="mt-4 grid gap-4 xl:grid-cols-3">
                                <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                    <div className="text-sm font-bold text-text-primary">Order And Friction</div>
                                    <div className="mt-3 grid gap-3">
                                        <label className="flex flex-col gap-1 text-xs text-text-muted">
                                            Order timing
                                            <select
                                                value={executionForm.orderTiming}
                                                onChange={(event) => setExecutionForm((current) => ({ ...current, orderTiming: event.target.value as OrderTiming }))}
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                            >
                                                <option value="NEXT_BAR_OPEN">Next bar open</option>
                                                <option value="SIGNAL_BAR_CLOSE">Signal bar close</option>
                                                <option value="LIMIT_TOUCH">Limit touch</option>
                                            </select>
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-text-muted">
                                            Entry fee (bps)
                                            <input
                                                type="number"
                                                step="any"
                                                value={executionForm.entryFeeBps}
                                                onChange={(event) => setExecutionForm((current) => ({ ...current, entryFeeBps: event.target.value }))}
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-text-muted">
                                            Exit fee (bps)
                                            <input
                                                type="number"
                                                step="any"
                                                value={executionForm.exitFeeBps}
                                                onChange={(event) => setExecutionForm((current) => ({ ...current, exitFeeBps: event.target.value }))}
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-text-muted">
                                            Entry slippage (bps)
                                            <input
                                                type="number"
                                                step="any"
                                                value={executionForm.entrySlippageBps}
                                                onChange={(event) => setExecutionForm((current) => ({ ...current, entrySlippageBps: event.target.value }))}
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1 text-xs text-text-muted">
                                            Exit slippage (bps)
                                            <input
                                                type="number"
                                                step="any"
                                                value={executionForm.exitSlippageBps}
                                                onChange={(event) => setExecutionForm((current) => ({ ...current, exitSlippageBps: event.target.value }))}
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                            />
                                        </label>
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                    <div className="text-sm font-bold text-text-primary">Risk And Target</div>
                                    <div className="mt-3 grid gap-3">
                                        <label className="flex flex-col gap-1 text-xs text-text-muted">
                                            <div className="flex items-center justify-between">
                                                Stop-loss mode
                                                {executionForm.stopLossMode === "SIGNAL_PRICE" && (
                                                    <div className="flex items-center gap-1 text-[9px] text-accent uppercase font-bold">
                                                        <Link2 size={10} />
                                                        Inherited
                                                    </div>
                                                )}
                                            </div>
                                            <select
                                                value={executionForm.stopLossMode}
                                                onChange={(event) => setExecutionForm((current) => ({ ...current, stopLossMode: event.target.value as StopLossMode }))}
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                            >
                                                <option value="SIGNAL_PRICE">Strategy Default</option>
                                                <option value="FIXED_AMOUNT">Fixed amount</option>
                                                <option value="ACCOUNT_PERCENT">% account</option>
                                            </select>
                                        </label>
                                        {executionForm.stopLossMode !== "SIGNAL_PRICE" ? (
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Stop-loss value
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={executionForm.stopLossValue}
                                                    onChange={(event) => setExecutionForm((current) => ({ ...current, stopLossValue: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                        ) : null}
                                        <div className="flex items-center justify-between">
                                            Take-profit mode
                                            {executionForm.takeProfitMode === "SIGNAL_PRICE" && (
                                                <div className="flex items-center gap-1 text-[9px] text-accent uppercase font-bold">
                                                    <Link2 size={10} />
                                                    Inherited
                                                </div>
                                            )}
                                        </div>
                                        <select
                                            value={executionForm.takeProfitMode}
                                            onChange={(event) => setExecutionForm((current) => ({ ...current, takeProfitMode: event.target.value as TakeProfitMode }))}
                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                        >
                                            <option value="SIGNAL_PRICE">Strategy Default</option>
                                            <option value="FIXED_AMOUNT">Fixed amount</option>
                                            <option value="ACCOUNT_PERCENT">% account</option>
                                            <option value="R_MULTIPLE">R multiple</option>
                                        </select>
                                        {executionForm.takeProfitMode !== "SIGNAL_PRICE" ? (
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Take-profit value
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={executionForm.takeProfitValue}
                                                    onChange={(event) => setExecutionForm((current) => ({ ...current, takeProfitValue: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                    <div className="text-sm font-bold text-text-primary">Volume And Launch</div>
                                    <div className="mt-3 grid gap-3">
                                        <label className="flex flex-col gap-1 text-xs text-text-muted">
                                            Position sizing
                                            <select
                                                value={executionForm.positionSizingMode}
                                                onChange={(event) => setExecutionForm((current) => ({ ...current, positionSizingMode: event.target.value as PositionSizingMode }))}
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                            >
                                                <option value="RISK_BASED">Risk based</option>
                                                <option value="FIXED_QUANTITY">Fixed quantity</option>
                                                <option value="ACCOUNT_PERCENT">% account</option>
                                            </select>
                                        </label>
                                        {executionForm.positionSizingMode !== "RISK_BASED" ? (
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Position sizing value
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={executionForm.positionSizingValue}
                                                    onChange={(event) => setExecutionForm((current) => ({ ...current, positionSizingValue: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                        ) : null}
                                        <div className="rounded-xl border border-border-muted bg-bg-tertiary/50 p-3 text-xs leading-5 text-text-secondary">
                                            <div><span className="font-bold text-text-primary">SL:</span> {describeMode(executionForm.stopLossMode, parseNumeric(executionForm.stopLossValue))}</div>
                                            <div><span className="font-bold text-text-primary">TP:</span> {describeMode(executionForm.takeProfitMode, parseNumeric(executionForm.takeProfitValue))}</div>
                                            <div><span className="font-bold text-text-primary">Volume:</span> {describeMode(executionForm.positionSizingMode, parseNumeric(executionForm.positionSizingValue))}</div>
                                        </div>
                                        <button
                                            onClick={handlePreview}
                                            disabled={isPreviewing || isRunning || !validation.payload}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border-muted bg-bg-tertiary px-4 py-3 text-sm font-bold text-text-primary transition hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                            Preview
                                        </button>
                                        <button
                                            onClick={handleRun}
                                            disabled={isRunning || isPreviewing || !validation.payload}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-black text-bg-secondary transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                                            Run And Persist
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <button
                                type="button"
                                onClick={() => setExecutionForm((current) => ({ ...current, tradeGuardsEnabled: !current.tradeGuardsEnabled }))}
                                className="flex w-full items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted"
                            >
                                <Shield className="h-4 w-4" />
                                Trade Guards
                                {executionForm.tradeGuardsEnabled ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
                            </button>

                            {executionForm.tradeGuardsEnabled && (
                                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                                    {/* Loss Management */}
                                    <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                        <div className="text-sm font-bold text-text-primary">Loss Management</div>

                                        {/* Loss Streak Throttle */}
                                        <div className="mt-3 border-t border-border-muted/30 pt-3">
                                            <label className="flex items-center justify-between text-xs text-text-muted">
                                                <span className="font-bold">Loss Streak Throttle</span>
                                                <input
                                                    type="checkbox"
                                                    checked={executionForm.lossStreakThrottleEnabled}
                                                    onChange={(e) => setExecutionForm((c) => ({ ...c, lossStreakThrottleEnabled: e.target.checked }))}
                                                    className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                                                />
                                            </label>
                                            {executionForm.lossStreakThrottleEnabled && (
                                                <div className="mt-2 grid gap-2">
                                                    {executionForm.lossStreakThrottleSteps.map((step, idx) => (
                                                        <div key={idx} className="flex items-center gap-2">
                                                            <label className="flex flex-1 flex-col gap-1 text-[10px] text-text-muted">
                                                                After losses
                                                                <input
                                                                    type="number"
                                                                    step="1"
                                                                    min="1"
                                                                    value={step.afterLosses}
                                                                    onChange={(e) => setExecutionForm((c) => {
                                                                        const steps = [...c.lossStreakThrottleSteps];
                                                                        steps[idx] = { ...steps[idx], afterLosses: e.target.value };
                                                                        return { ...c, lossStreakThrottleSteps: steps };
                                                                    })}
                                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                                />
                                                            </label>
                                                            <label className="flex flex-1 flex-col gap-1 text-[10px] text-text-muted">
                                                                Risk %
                                                                <input
                                                                    type="number"
                                                                    step="any"
                                                                    min="0"
                                                                    value={step.riskPercent}
                                                                    onChange={(e) => setExecutionForm((c) => {
                                                                        const steps = [...c.lossStreakThrottleSteps];
                                                                        steps[idx] = { ...steps[idx], riskPercent: e.target.value };
                                                                        return { ...c, lossStreakThrottleSteps: steps };
                                                                    })}
                                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                                />
                                                            </label>
                                                            <button
                                                                type="button"
                                                                onClick={() => setExecutionForm((c) => ({
                                                                    ...c,
                                                                    lossStreakThrottleSteps: c.lossStreakThrottleSteps.filter((_, i) => i !== idx),
                                                                }))}
                                                                disabled={executionForm.lossStreakThrottleSteps.length <= 1}
                                                                className="mt-4 rounded-lg border border-price-down/25 bg-price-down/10 p-1.5 text-price-down disabled:opacity-30"
                                                                title="Remove step"
                                                            >
                                                                <Minus className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {executionForm.lossStreakThrottleSteps.length < 5 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setExecutionForm((c) => ({
                                                                ...c,
                                                                lossStreakThrottleSteps: [...c.lossStreakThrottleSteps, { afterLosses: "", riskPercent: "" }],
                                                            }))}
                                                            className="inline-flex items-center gap-1 rounded-lg border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary"
                                                        >
                                                            <Plus className="h-3 w-3" />
                                                            Add Step
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Loss Streak Cooldown */}
                                        <div className="mt-3 border-t border-border-muted/30 pt-3">
                                            <label className="flex items-center justify-between text-xs text-text-muted">
                                                <span className="font-bold">Loss Streak Cooldown</span>
                                                <input
                                                    type="checkbox"
                                                    checked={executionForm.lossStreakCooldownEnabled}
                                                    onChange={(e) => setExecutionForm((c) => ({ ...c, lossStreakCooldownEnabled: e.target.checked }))}
                                                    className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                                                />
                                            </label>
                                            {executionForm.lossStreakCooldownEnabled && (
                                                <div className="mt-2 grid grid-cols-2 gap-2">
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        After losses
                                                        <input
                                                            type="number"
                                                            step="1"
                                                            min="1"
                                                            value={executionForm.lossStreakCooldownAfterLosses}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, lossStreakCooldownAfterLosses: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        Cooldown (min)
                                                        <input
                                                            type="number"
                                                            step="1"
                                                            min="1"
                                                            value={executionForm.lossStreakCooldownMinutes}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, lossStreakCooldownMinutes: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Loss Caps */}
                                    <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                        <div className="text-sm font-bold text-text-primary">Loss Caps</div>

                                        {/* Session Loss Cap */}
                                        <div className="mt-3 border-t border-border-muted/30 pt-3">
                                            <label className="flex items-center justify-between text-xs text-text-muted">
                                                <span className="font-bold">Session Loss Cap</span>
                                                <input
                                                    type="checkbox"
                                                    checked={executionForm.sessionLossCapEnabled}
                                                    onChange={(e) => setExecutionForm((c) => ({ ...c, sessionLossCapEnabled: e.target.checked }))}
                                                    className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                                                />
                                            </label>
                                            {executionForm.sessionLossCapEnabled && (
                                                <div className="mt-2 grid grid-cols-2 gap-2">
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        Max losses
                                                        <input
                                                            type="number"
                                                            step="1"
                                                            min="1"
                                                            value={executionForm.sessionLossCapMaxLosses}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, sessionLossCapMaxLosses: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        Max net R
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            value={executionForm.sessionLossCapMaxNetR}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, sessionLossCapMaxNetR: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                </div>
                                            )}
                                        </div>

                                        {/* Day Loss Cap */}
                                        <div className="mt-3 border-t border-border-muted/30 pt-3">
                                            <label className="flex items-center justify-between text-xs text-text-muted">
                                                <span className="font-bold">Day Loss Cap</span>
                                                <input
                                                    type="checkbox"
                                                    checked={executionForm.dayLossCapEnabled}
                                                    onChange={(e) => setExecutionForm((c) => ({ ...c, dayLossCapEnabled: e.target.checked }))}
                                                    className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                                                />
                                            </label>
                                            {executionForm.dayLossCapEnabled && (
                                                <div className="mt-2 grid grid-cols-2 gap-2">
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        Max losses
                                                        <input
                                                            type="number"
                                                            step="1"
                                                            min="1"
                                                            value={executionForm.dayLossCapMaxLosses}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, dayLossCapMaxLosses: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        Max net R
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            value={executionForm.dayLossCapMaxNetR}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, dayLossCapMaxNetR: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Portfolio Protection */}
                                    <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                        <div className="text-sm font-bold text-text-primary">Portfolio Protection</div>

                                        {/* Equity Curve Filter */}
                                        <div className="mt-3 border-t border-border-muted/30 pt-3">
                                            <label className="flex items-center justify-between text-xs text-text-muted">
                                                <span className="font-bold">Equity Curve Filter</span>
                                                <input
                                                    type="checkbox"
                                                    checked={executionForm.equityCurveFilterEnabled}
                                                    onChange={(e) => setExecutionForm((c) => ({ ...c, equityCurveFilterEnabled: e.target.checked }))}
                                                    className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                                                />
                                            </label>
                                            {executionForm.equityCurveFilterEnabled && (
                                                <div className="mt-2 grid grid-cols-2 gap-2">
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        EMA trades
                                                        <input
                                                            type="number"
                                                            step="1"
                                                            min="1"
                                                            value={executionForm.equityCurveFilterEmaTrades}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, equityCurveFilterEmaTrades: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        Action
                                                        <select
                                                            value={executionForm.equityCurveFilterAction}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, equityCurveFilterAction: e.target.value as '' | 'BLOCK' | 'HALF_RISK' }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                                        >
                                                            <option value="">Select</option>
                                                            <option value="BLOCK">Block trade</option>
                                                            <option value="HALF_RISK">Half risk</option>
                                                        </select>
                                                    </label>
                                                </div>
                                            )}
                                        </div>

                                        {/* Max Drawdown Halt */}
                                        <div className="mt-3 border-t border-border-muted/30 pt-3">
                                            <label className="flex items-center justify-between text-xs text-text-muted">
                                                <span className="font-bold">Max Drawdown Halt</span>
                                                <input
                                                    type="checkbox"
                                                    checked={executionForm.maxDrawdownHaltEnabled}
                                                    onChange={(e) => setExecutionForm((c) => ({ ...c, maxDrawdownHaltEnabled: e.target.checked }))}
                                                    className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                                                />
                                            </label>
                                            {executionForm.maxDrawdownHaltEnabled && (
                                                <div className="mt-2">
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        Max drawdown %
                                                        <input
                                                            type="number"
                                                            step="any"
                                                            min="0"
                                                            value={executionForm.maxDrawdownHaltPct}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, maxDrawdownHaltPct: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                </div>
                                            )}
                                        </div>

                                        {/* Min Trade Spacing */}
                                        <div className="mt-3 border-t border-border-muted/30 pt-3">
                                            <label className="flex items-center justify-between text-xs text-text-muted">
                                                <span className="font-bold">Min Trade Spacing</span>
                                                <input
                                                    type="checkbox"
                                                    checked={executionForm.minTradeSpacingEnabled}
                                                    onChange={(e) => setExecutionForm((c) => ({ ...c, minTradeSpacingEnabled: e.target.checked }))}
                                                    className="h-4 w-4 rounded border-border-muted bg-bg-primary text-accent focus:ring-accent"
                                                />
                                            </label>
                                            {executionForm.minTradeSpacingEnabled && (
                                                <div className="mt-2">
                                                    <label className="flex flex-col gap-1 text-[10px] text-text-muted">
                                                        Min spacing (min)
                                                        <input
                                                            type="number"
                                                            step="1"
                                                            min="1"
                                                            value={executionForm.minTradeSpacingMinutes}
                                                            onChange={(e) => setExecutionForm((c) => ({ ...c, minTradeSpacingMinutes: e.target.value }))}
                                                            className="rounded-xl border border-border-muted bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent/50"
                                                        />
                                                    </label>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {validation.errors.length > 0 ? (
                            <StateBanner
                                tone="danger"
                                title="Validation issues"
                                message={(
                                    <div className="grid gap-1">
                                        {validation.errors.slice(0, 6).map((item) => (
                                            <div key={item}>{item}</div>
                                        ))}
                                    </div>
                                )}
                            />
                        ) : null}

                        {error ? (
                            <StateBanner tone="danger" size="compact" message={error} />
                        ) : null}
                        {success ? (
                            <StateBanner tone="success" size="compact" message={success} />
                        ) : null}
                    </div>

                    <div className="grid gap-4">
                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                                <Gauge className="h-4 w-4" />
                                Preview Snapshot
                            </div>
                            {previewData ? (
                                <div className="mt-4 grid gap-3">
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <MetricCard label="Signals" value={String(previewData.counts.signals)} />
                                        <MetricCard label="Results" value={String(previewData.counts.results)} accentClassName="text-price-up" />
                                        <MetricCard label="Events" value={String(previewData.counts.events)} />
                                        <MetricCard label="Bars" value={formatNumber(previewData.counts.barsProcessed, 0)} />
                                    </div>

                                    {previewSample.firstResult ? (
                                        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4 text-sm text-text-secondary">
                                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">First Result</div>
                                            <div className="mt-2 text-text-primary">{previewSample.firstResult.exitRuleName || previewSample.firstResult.exitRuleCode}</div>
                                            <div className="mt-2 grid gap-2 text-xs">
                                                <div>R: <span className={previewSample.firstResult.rMultiple >= 0 ? "text-price-up" : "text-price-down"}>{formatSigned(previewSample.firstResult.rMultiple, "R")}</span></div>
                                                <div>PNL: <span className={previewSample.firstResult.pnlUsd >= 0 ? "text-price-up" : "text-price-down"}>${formatSigned(previewSample.firstResult.pnlUsd)}</span></div>
                                                <div>Exit: {previewSample.firstResult.exitReason} / {formatDateTime(previewSample.firstResult.exitTime || null)}</div>
                                            </div>
                                        </div>
                                    ) : null}

                                    {previewSample.firstLifecycleEvent ? (
                                        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4 text-sm text-text-secondary">
                                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">Lifecycle Event</div>
                                            <div className="mt-2 text-text-primary">{previewSample.firstLifecycleEvent.eventType} / {previewSample.firstLifecycleEvent.label || "event"}</div>
                                            <div className="mt-2 text-xs">{formatDateTime(previewSample.firstLifecycleEvent.candleTime)}</div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="mt-4 rounded-2xl border border-dashed border-border-muted bg-bg-primary/50 p-4 text-sm text-text-secondary">
                                    Run a preview to inspect counts, sample results, and lifecycle events before persisting a generated run.
                                </div>
                            )}
                        </div>

                        <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                                <CandlestickChart className="h-4 w-4" />
                                Selected Run
                            </div>
                            {isRunDetailLoading ? (
                                <div className="mt-4 grid min-h-[180px] place-items-center">
                                    <Loader2 className="h-6 w-6 animate-spin text-accent" />
                                </div>
                            ) : selectedRunDetail ? (
                                <div className="mt-4 grid gap-3">
                                    <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-bold text-text-primary">{selectedRunDetail.name}</div>
                                                <div className="mt-1 text-xs text-text-muted">{selectedRunDetail.signalCode}@{selectedRunDetail.signalVersion} / {selectedRunDetail.symbol} / {selectedRunDetail.timeframe}</div>
                                            </div>
                                            {(() => {
                                                const liveProgress = getProgress(selectedRunDetail.id);
                                                const displayStatus = liveProgress?.status ?? selectedRunDetail.status;
                                                const isLiveRunning = displayStatus === "RUNNING" || displayStatus === "PENDING";
                                                return (
                                                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${displayStatus === "COMPLETED"
                                                        ? "bg-price-up/15 text-price-up"
                                                        : displayStatus === "FAILED"
                                                            ? "bg-price-down/15 text-price-down"
                                                            : "bg-accent/15 text-accent"
                                                        }`}>
                                                        {isLiveRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                                        {displayStatus}
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                        {(() => {
                                            const liveProgress = getProgress(selectedRunDetail.id);
                                            const isLiveRunning = (liveProgress?.status === "RUNNING" || liveProgress?.status === "PENDING") || (selectedRunDetail.status === "PENDING" || selectedRunDetail.status === "RUNNING");
                                            if (!isLiveRunning) return null;
                                            return (
                                                <div className="mt-3 flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-accent">
                                                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                                                    <span>Backtest is executing asynchronously. Metrics will appear when execution completes.</span>
                                                </div>
                                            );
                                        })()}
                                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                            <MetricCard label="Signals" value={String(selectedRunDetail.counts.signals)} />
                                            <MetricCard label="Results" value={String(selectedRunDetail.counts.results)} />
                                            <MetricCard label="Events" value={String(selectedRunDetail.counts.events)} />
                                            <MetricCard label="Traces" value={String(selectedRunDetail.counts.traces)} />
                                        </div>
                                        <div className="mt-4 grid gap-2 text-xs text-text-secondary">
                                            <div>Run ID: <span className="font-mono text-text-primary">{selectedRunDetail.id}</span></div>
                                            <div>Created: {formatDateTime(selectedRunDetail.createdAt)}</div>
                                            <div>Window: {formatDateTime(selectedRunDetail.startedAt)} → {formatDateTime(selectedRunDetail.finishedAt)}</div>
                                            <div>Execution: {describeMode(selectedRunDetail.executionConfigJson?.stopLoss.mode || "SIGNAL_PRICE", selectedRunDetail.executionConfigJson?.stopLoss.value)} / {describeMode(selectedRunDetail.executionConfigJson?.takeProfit.mode || "SIGNAL_PRICE", selectedRunDetail.executionConfigJson?.takeProfit.value)} / {describeMode(selectedRunDetail.executionConfigJson?.positionSizing.mode || "RISK_BASED", selectedRunDetail.executionConfigJson?.positionSizing.value)}</div>
                                            {(() => {
                                                const guards = (selectedRunDetail.executionConfigJson as ExecutionConfigView | null)?.tradeGuards as TradeGuardConfig | undefined;
                                                if (!guards) return null;
                                                const active: string[] = [];
                                                if (guards.lossStreakThrottle?.steps?.length) active.push("Streak Throttle");
                                                if (guards.lossStreakCooldown?.afterLosses || guards.lossStreakCooldown?.cooldownMinutes) active.push("Streak Cooldown");
                                                if (guards.sessionLossCap?.maxLosses || guards.sessionLossCap?.maxNetR) active.push("Session Cap");
                                                if (guards.dayLossCap?.maxLosses || guards.dayLossCap?.maxNetR) active.push("Day Cap");
                                                if (guards.equityCurveFilter?.emaTrades || guards.equityCurveFilter?.action) active.push("Equity Curve");
                                                if (guards.maxDrawdownHalt?.maxDrawdownPct) active.push("Max DD Halt");
                                                if (guards.minTradeSpacing?.minSpacingMinutes) active.push("Min Spacing");
                                                if (active.length === 0) return null;
                                                return (
                                                    <div>
                                                        <span className="font-bold text-text-primary">Guards:</span>{" "}
                                                        {active.join(", ")}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                        {selectedRunDetail.errorMessage ? (
                                            <StateBanner
                                                tone="danger"
                                                size="compact"
                                                className="mt-3 rounded-xl"
                                                message={selectedRunDetail.errorMessage}
                                            />
                                        ) : null}
                                        {activatedInstance?.sourceBacktestRunId === selectedRunDetail.id ? (
                                            <div className="mt-3 rounded-2xl border border-price-up/25 bg-price-up/10 p-4">
                                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-price-up">
                                                    Indicator Activation Ready
                                                </div>
                                                <div className="mt-2 text-sm text-text-primary">
                                                    <span className="font-black">{activatedInstance.name}</span> is now live as an indicator instance. Continue with runtime review or move straight into Telegram deployment setup.
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <Link
                                                        href="/indicators"
                                                        className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                                                    >
                                                        Open Indicator Dashboard
                                                        <ArrowRight className="h-4 w-4" />
                                                    </Link>
                                                    <Link
                                                        href={`/indicators/${activatedInstance.id}/chart`}
                                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                                                    >
                                                        Open Analyzer
                                                        <ArrowRight className="h-4 w-4" />
                                                    </Link>
                                                    <Link
                                                        href="/trading?tab=external"
                                                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                                                    >
                                                        Create External Deployment
                                                        <ArrowRight className="h-4 w-4" />
                                                    </Link>
                                                </div>
                                            </div>
                                        ) : null}
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <button
                                                onClick={async () => {
                                                    setIsRunDetailLoading(true);
                                                    try {
                                                        const data = await fetchJson<{ data: GeneratedBacktestDetail }>(`${apiUrl}/api/signals/backtests/${selectedRunDetail.id}`);
                                                        setSelectedRunDetail(data.data);
                                                    } catch (refreshError) {
                                                        setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh run");
                                                    } finally {
                                                        setIsRunDetailLoading(false);
                                                    }
                                                }}
                                                className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                                            >
                                                <RefreshCw className="h-4 w-4" />
                                                Refresh
                                            </button>
                                            <Link
                                                href={`/engine?run=${selectedRunDetail.id}`}
                                                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                                            >
                                                Open In Engine
                                                <ArrowRight className="h-4 w-4" />
                                            </Link>
                                            <Link
                                                href={`/signals/backtests/${selectedRunDetail.id}`}
                                                className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                                            >
                                                Open Trade History
                                                <ArrowRight className="h-4 w-4" />
                                            </Link>
                                            <button
                                                onClick={async () => {
                                                    setIsActivating(true);
                                                    setError(null);
                                                    setActivatedInstance(null);
                                                    try {
                                                        const instance = await promoteBacktest(selectedRunDetail.id);
                                                        setActivatedInstance(instance);
                                                        setSuccess(`Indicator activated successfully as ${instance.name}.`);
                                                    } catch (err: unknown) {
                                                        setError(err instanceof Error ? err.message : "Failed to activate indicator.");
                                                    } finally {
                                                        setIsActivating(false);
                                                    }
                                                }}
                                                disabled={isActivating || selectedRunDetail.status !== "COMPLETED"}
                                                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-black text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-600/20"
                                            >
                                                {isActivating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                                                Activate As Indicator
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-4 rounded-2xl border border-dashed border-border-muted bg-bg-primary/50 p-4 text-sm text-text-secondary">
                                    Select a generated run from the history panel to inspect counts and execution configuration.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </SectionCard>

            <SectionCard
                title="Generated Run History"
                description="Generated run history"
                icon={<RefreshCw className="h-5 w-5" />}
            >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-text-secondary">{runs.length} generated runs available locally</div>
                    <button
                        onClick={async () => {
                            try {
                                setError(null);
                                const nextRuns = await refreshRuns({ notes: filterNotes, signalCode: filterSignalCode });
                                if (!selectedRunId && nextRuns.length > 0) {
                                    handleRunSelection(nextRuns[0].id);
                                }
                            } catch (refreshError) {
                                setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh runs");
                            }
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2 text-sm font-bold text-text-primary"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Refresh Runs
                    </button>
                </div>

                {/* Filter bar */}
                <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-text-muted">
                        Notes
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                            <input
                                type="text"
                                placeholder="e.g. GO-LIVE"
                                value={filterNotes}
                                onChange={(e) => setFilterNotes(e.target.value)}
                                className="w-44 rounded-xl border border-border-muted bg-bg-primary py-2 pl-8 pr-3 text-sm text-text-primary outline-none focus:border-accent/50"
                            />
                        </div>
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wider text-text-muted">
                        Signal Code
                        <select
                            value={filterSignalCode}
                            onChange={(e) => setFilterSignalCode(e.target.value)}
                            className="w-44 rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                        >
                            <option value="">All signals</option>
                            {signalCodeOptions.map((code) => (
                                <option key={code} value={code}>{code}</option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={async () => {
                            try {
                                setError(null);
                                await refreshRuns({ notes: filterNotes, signalCode: filterSignalCode });
                            } catch (filterError) {
                                setError(filterError instanceof Error ? filterError.message : "Failed to filter runs");
                            }
                        }}
                        className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                    >
                        <Search className="h-3.5 w-3.5" />
                        Filter
                    </button>
                    {(filterNotes || filterSignalCode) && (
                        <button
                            type="button"
                            onClick={async () => {
                                setFilterNotes("");
                                setFilterSignalCode("");
                                try {
                                    setError(null);
                                    await refreshRuns();
                                } catch (clearError) {
                                    setError(clearError instanceof Error ? clearError.message : "Failed to clear filters");
                                }
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-tertiary px-3 py-2 text-xs font-bold text-text-secondary"
                        >
                            Clear
                        </button>
                    )}
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-border-muted">
                    <div className="grid grid-cols-[2.2fr_0.9fr_1fr_1fr_0.9fr_auto] gap-3 bg-bg-tertiary/60 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                        <div>Run</div>
                        <div>Status</div>
                        <div>Asset</div>
                        <div>Window</div>
                        <div>Created</div>
                        <div className="text-right">Actions</div>
                    </div>
                    <div className="divide-y divide-border-muted bg-bg-primary/70">
                        {runs.length === 0 ? (
                            <div className="px-4 py-6 text-sm text-text-secondary">
                                No generated runs yet. Launch one from the form above.
                            </div>
                        ) : runs.map((run) => (
                            <div
                                key={run.id}
                                className={`grid grid-cols-[2.2fr_0.9fr_1fr_1fr_0.9fr_auto] gap-3 px-4 py-4 text-sm transition hover:bg-bg-tertiary/40 ${run.id === selectedRunId ? "bg-accent/6" : ""
                                    }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => handleRunSelection(run.id)}
                                    className="col-span-5 grid grid-cols-subgrid text-left"
                                >
                                    <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-text-primary">{run.name}</span>
                                        {run.notes?.includes("GO-LIVE") && (
                                            <span className="rounded-full bg-price-up/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-price-up">GO-LIVE</span>
                                        )}
                                    </div>
                                    <div className="mt-1 text-xs text-text-muted">{run.signalCode}@{run.signalVersion}</div>
                                    {run.notes && !run.notes.includes("GO-LIVE") && (
                                        <div className="mt-0.5 max-w-[280px] truncate text-[11px] text-text-secondary" title={run.notes}>{run.notes}</div>
                                    )}
                                </div>
                                <div>
                                    {(() => {
                                        const liveProgress = getProgress(run.id);
                                        const displayStatus = liveProgress?.status ?? run.status;
                                        const isLiveRunning = displayStatus === "RUNNING" || displayStatus === "PENDING";
                                        return (
                                            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${displayStatus === "COMPLETED"
                                                ? "bg-price-up/15 text-price-up"
                                                : displayStatus === "FAILED"
                                                    ? "bg-price-down/15 text-price-down"
                                                    : isLiveRunning
                                                        ? "bg-accent/15 text-accent"
                                                        : "bg-accent/15 text-accent"
                                                }`}>
                                                {isLiveRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                                {displayStatus}
                                            </span>
                                        );
                                    })()}
                                </div>
                                <div className="text-text-primary">{run.symbol} / {run.timeframe}</div>
                                <div className="text-text-secondary">
                                    {run.startedAt.slice(0, 10)} → {(run.finishedAt || run.createdAt).slice(0, 10)}
                                </div>
                                <div className="text-text-secondary">{run.createdAt.slice(0, 10)}</div>
                                </button>
                                <div className="flex items-center justify-end">
                                    <button
                                        type="button"
                                        onClick={() => void handleDeleteRun(run)}
                                        disabled={isDeletingRunId === run.id || !canDeleteRun(run.status)}
                                        className="inline-flex items-center gap-2 rounded-full border border-price-down/25 bg-price-down/10 px-3 py-2 text-xs font-bold text-price-down transition hover:bg-price-down/15 disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label={`Delete generated run ${run.name}`}
                                        title={canDeleteRun(run.status) ? "Delete generated run" : "Only completed, failed, or canceled runs can be deleted"}
                                    >
                                        {isDeletingRunId === run.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </SectionCard>
        </div>
    );
}
