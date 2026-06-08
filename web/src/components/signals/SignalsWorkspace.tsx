"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Database, FileEdit, FileJson, FileSpreadsheet, Inbox, Loader2, UploadCloud } from "lucide-react";
import {
    EngineExitRule,
    EngineRun,
    EngineStrategy,
} from "@/types/engine";
import { ImportFormat, parseImportDataset, readImportField } from "@/lib/importParsers";
import SignalsReviewWorkspace from "@/components/signals/SignalsReviewWorkspace";
import SignalsGenerateWorkspace from "@/components/signals/SignalsGenerateWorkspace";
import BatchBacktestComparison from "@/components/signals/BatchBacktestComparison";
import SectionCard from "@/components/ui/SectionCard";
import StateBanner from "@/components/ui/StateBanner";

type RunMode = "existing" | "new";
type SideValue = "LONG" | "SHORT";
type SessionValue = "ASIAN" | "LONDON" | "NY";

interface SignalImportDraft {
    signalKey: string;
    symbol: string;
    timeframe: string;
    side: SideValue;
    strategyCode: string;
    session: SessionValue;
    entryTime: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number | null;
    takeProfit2: number | null;
    invalidationPrice: number | null;
    notes: string | null;
}

interface ResultImportDraft {
    signalKey?: string;
    signalId?: string;
    exitRuleCode: string;
    resultSide: SideValue;
    session: SessionValue;
    win: boolean;
    isOpen: boolean;
    rMultiple: number;
    pnlUsd: number;
    maxDrawdownPct: number;
    exitReason: string;
    exitTime: string | null;
    exitPrice: number | null;
    notes: string | null;
}

interface ValidationResult {
    signals: SignalImportDraft[];
    signalErrors: string[];
    results: ResultImportDraft[];
    resultErrors: string[];
}

const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}`);
    }
    return response.json();
};

const coerceText = (value: unknown) => {
    if (value === null || value === undefined) return "";
    return String(value).trim();
};

const coerceUpper = (value: unknown) => coerceText(value).toUpperCase();

const coerceNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const coerceBoolean = (value: unknown) => {
    if (typeof value === "boolean") return value;
    const normalized = coerceText(value).toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
};

export default function SignalsWorkspace() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const [activeView, setActiveView] = useState<"generate" | "import" | "review" | "batch">("generate");
    const [strategies, setStrategies] = useState<EngineStrategy[]>([]);
    const [exitRules, setExitRules] = useState<EngineExitRule[]>([]);
    const [runs, setRuns] = useState<EngineRun[]>([]);
    const [runMode, setRunMode] = useState<RunMode>("new");
    const [selectedRunId, setSelectedRunId] = useState("");
    const [signalsFormat, setSignalsFormat] = useState<ImportFormat>("csv");
    const [resultsFormat, setResultsFormat] = useState<ImportFormat>("csv");
    const [signalsInput, setSignalsInput] = useState("");
    const [resultsInput, setResultsInput] = useState("");
    const [runForm, setRunForm] = useState({
        name: "Imported Signals Run",
        symbol: "BTCUSD",
        timeframe: "1h",
        strategyCode: "",
        side: "LONG",
        initialEquity: "10000",
        riskPercent: "2",
        startedAt: "",
        finishedAt: "",
        notes: "",
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const loadReferenceData = useCallback(async () => {
        const [strategiesResult, exitRulesResult, runsResult] = await Promise.all([
            fetchJson<{ data: EngineStrategy[] }>(`${apiUrl}/api/engine/strategies`),
            fetchJson<{ data: EngineExitRule[] }>(`${apiUrl}/api/engine/exit-rules`),
            fetchJson<{ data: EngineRun[] }>(`${apiUrl}/api/engine/runs`),
        ]);

        setStrategies(strategiesResult.data);
        setExitRules(exitRulesResult.data);
        setRuns(runsResult.data);

        if (!selectedRunId && runsResult.data.length > 0) {
            setSelectedRunId(runsResult.data[0].id);
        }
    }, [apiUrl, selectedRunId]);

    useEffect(() => {
        let active = true;

        loadReferenceData()
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
    }, [loadReferenceData]);

    const selectedRun = useMemo(
        () => runs.find((run) => run.id === selectedRunId) ?? null,
        [runs, selectedRunId]
    );

    const effectiveDefaults = useMemo(() => {
        if (runMode === "existing" && selectedRun) {
            return {
                symbol: selectedRun.symbol,
                timeframe: selectedRun.timeframe,
                strategyCode: selectedRun.strategyCode ?? "",
                side: selectedRun.side ?? "LONG",
            };
        }

        return {
            symbol: runForm.symbol,
            timeframe: runForm.timeframe,
            strategyCode: runForm.strategyCode,
            side: runForm.side,
        };
    }, [runForm.side, runForm.strategyCode, runForm.symbol, runForm.timeframe, runMode, selectedRun]);

    const parsedSignals = useMemo(
        () => parseImportDataset(signalsInput, signalsFormat),
        [signalsFormat, signalsInput]
    );
    const parsedResults = useMemo(
        () => parseImportDataset(resultsInput, resultsFormat),
        [resultsFormat, resultsInput]
    );

    const validation = useMemo<ValidationResult>(() => {
        const strategyCodeSet = new Set(strategies.map((strategy) => strategy.code.toUpperCase()));
        const exitRuleCodeSet = new Set(exitRules.map((rule) => rule.code.toUpperCase()));
        const signalErrors = [...parsedSignals.errors];
        const resultErrors = [...parsedResults.errors];
        const normalizedSignals: SignalImportDraft[] = [];
        const normalizedResults: ResultImportDraft[] = [];

        parsedSignals.rows.forEach((row, index) => {
            const signalKey = coerceText(readImportField(row, ["signalKey", "clientKey", "key"])) || `signal-${index + 1}`;
            const symbol = coerceUpper(readImportField(row, ["symbol"])) || coerceUpper(effectiveDefaults.symbol);
            const timeframe = coerceText(readImportField(row, ["timeframe", "tf"])) || coerceText(effectiveDefaults.timeframe);
            const side = coerceUpper(readImportField(row, ["side"])) || coerceUpper(effectiveDefaults.side);
            const strategyCode = coerceUpper(readImportField(row, ["strategyCode", "strategy"])) || coerceUpper(effectiveDefaults.strategyCode);
            const session = coerceUpper(readImportField(row, ["session"]));
            const entryTime = coerceText(readImportField(row, ["entryTime"]));
            const entryPrice = coerceNumber(readImportField(row, ["entryPrice"]));
            const stopLoss = coerceNumber(readImportField(row, ["stopLoss", "sl"]));
            const takeProfit1 = coerceNumber(readImportField(row, ["takeProfit1", "tp1"]));
            const takeProfit2 = coerceNumber(readImportField(row, ["takeProfit2", "tp2"]));
            const invalidationPrice = coerceNumber(readImportField(row, ["invalidationPrice"]));
            const notes = coerceText(readImportField(row, ["notes", "note"])) || null;

            if (!symbol) signalErrors.push(`Signal row ${index + 1}: symbol is required.`);
            if (!timeframe) signalErrors.push(`Signal row ${index + 1}: timeframe is required.`);
            if (side !== "LONG" && side !== "SHORT") signalErrors.push(`Signal row ${index + 1}: side must be LONG or SHORT.`);
            if (!strategyCode) signalErrors.push(`Signal row ${index + 1}: strategyCode is required.`);
            if (strategyCode && !strategyCodeSet.has(strategyCode)) {
                signalErrors.push(`Signal row ${index + 1}: unknown strategyCode ${strategyCode}.`);
            }
            if (session !== "ASIAN" && session !== "LONDON" && session !== "NY") {
                signalErrors.push(`Signal row ${index + 1}: session must be ASIAN, LONDON, or NY.`);
            }
            if (!entryTime || Number.isNaN(new Date(entryTime).getTime())) {
                signalErrors.push(`Signal row ${index + 1}: entryTime must be a valid ISO date.`);
            }
            if (entryPrice === null) signalErrors.push(`Signal row ${index + 1}: entryPrice is required.`);
            if (stopLoss === null) signalErrors.push(`Signal row ${index + 1}: stopLoss is required.`);

            normalizedSignals.push({
                signalKey,
                symbol,
                timeframe,
                side: side as SideValue,
                strategyCode,
                session: session as SessionValue,
                entryTime,
                entryPrice: entryPrice ?? 0,
                stopLoss: stopLoss ?? 0,
                takeProfit1,
                takeProfit2,
                invalidationPrice,
                notes,
            });
        });

        parsedResults.rows.forEach((row, index) => {
            const signalKey = coerceText(readImportField(row, ["signalKey", "clientKey", "key"])) || undefined;
            const signalId = coerceText(readImportField(row, ["signalId"])) || undefined;
            const exitRuleCode = coerceUpper(readImportField(row, ["exitRuleCode", "exitRule", "rule"]));
            const resultSide = coerceUpper(readImportField(row, ["resultSide", "side"]));
            const session = coerceUpper(readImportField(row, ["session"]));
            const rMultiple = coerceNumber(readImportField(row, ["rMultiple", "r", "rValue"]));
            const pnlUsd = coerceNumber(readImportField(row, ["pnlUsd", "pnl", "netUsd"]));
            const maxDrawdownPct = coerceNumber(readImportField(row, ["maxDrawdownPct", "maxDd"])) ?? 0;
            const exitReason = coerceUpper(readImportField(row, ["exitReason"])) || "MANUAL";
            const exitTime = coerceText(readImportField(row, ["exitTime"])) || null;
            const exitPrice = coerceNumber(readImportField(row, ["exitPrice"]));
            const notes = coerceText(readImportField(row, ["notes", "note"])) || null;

            if (!signalId && !signalKey) {
                resultErrors.push(`Result row ${index + 1}: signalId or signalKey is required.`);
            }
            if (!exitRuleCode) resultErrors.push(`Result row ${index + 1}: exitRuleCode is required.`);
            if (exitRuleCode && !exitRuleCodeSet.has(exitRuleCode)) {
                resultErrors.push(`Result row ${index + 1}: unknown exitRuleCode ${exitRuleCode}.`);
            }
            if (resultSide !== "LONG" && resultSide !== "SHORT") {
                resultErrors.push(`Result row ${index + 1}: resultSide must be LONG or SHORT.`);
            }
            if (session !== "ASIAN" && session !== "LONDON" && session !== "NY") {
                resultErrors.push(`Result row ${index + 1}: session must be ASIAN, LONDON, or NY.`);
            }
            if (rMultiple === null) resultErrors.push(`Result row ${index + 1}: rMultiple is required.`);
            if (pnlUsd === null) resultErrors.push(`Result row ${index + 1}: pnlUsd is required.`);
            if (exitTime && Number.isNaN(new Date(exitTime).getTime())) {
                resultErrors.push(`Result row ${index + 1}: exitTime must be a valid ISO date.`);
            }

            normalizedResults.push({
                signalKey,
                signalId,
                exitRuleCode,
                resultSide: resultSide as SideValue,
                session: session as SessionValue,
                win: coerceBoolean(readImportField(row, ["win"])),
                isOpen: coerceBoolean(readImportField(row, ["isOpen", "open"])),
                rMultiple: rMultiple ?? 0,
                pnlUsd: pnlUsd ?? 0,
                maxDrawdownPct,
                exitReason,
                exitTime,
                exitPrice,
                notes,
            });
        });

        if (parsedResults.rows.length > 0) {
            const signalKeys = new Set(normalizedSignals.map((signal) => signal.signalKey));
            normalizedResults.forEach((result, index) => {
                if (!result.signalId && result.signalKey && !signalKeys.has(result.signalKey)) {
                    resultErrors.push(`Result row ${index + 1}: signalKey ${result.signalKey} was not found in the imported signals payload.`);
                }
            });
        }

        if (runMode === "existing" && !selectedRunId) {
            resultErrors.push("Select an existing backtest run before importing.");
        }

        if (runMode === "new") {
            if (!runForm.name.trim()) resultErrors.push("Backtest run name is required.");
            if (!runForm.symbol.trim()) resultErrors.push("Backtest run symbol is required.");
            if (!runForm.timeframe.trim()) resultErrors.push("Backtest run timeframe is required.");
            if (coerceNumber(runForm.initialEquity) === null) resultErrors.push("Initial equity must be a number.");
            if (coerceNumber(runForm.riskPercent) === null) resultErrors.push("Risk percent must be a number.");
            if (runForm.strategyCode && !strategyCodeSet.has(runForm.strategyCode.toUpperCase())) {
                resultErrors.push(`Unknown run strategyCode ${runForm.strategyCode}.`);
            }
        }

        return {
            signals: normalizedSignals,
            signalErrors,
            results: normalizedResults,
            resultErrors,
        };
    }, [effectiveDefaults.side, effectiveDefaults.strategyCode, effectiveDefaults.symbol, effectiveDefaults.timeframe, exitRules, parsedResults.errors, parsedResults.rows, parsedSignals.errors, parsedSignals.rows, runForm.initialEquity, runForm.name, runForm.riskPercent, runForm.strategyCode, runForm.symbol, runForm.timeframe, runMode, selectedRunId, strategies]);

    const canSubmit = validation.signalErrors.length === 0
        && validation.resultErrors.length === 0
        && validation.signals.length > 0;

    const handleFileUpload = useCallback(async (
        event: ChangeEvent<HTMLInputElement>,
        setValue: (next: string) => void
    ) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setValue(await file.text());
        event.target.value = "";
    }, []);

    const handleSubmit = async () => {
        if (!canSubmit) return;

        setIsSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            const payload = {
                existingBacktestRunId: runMode === "existing" ? selectedRunId : undefined,
                backtestRun: runMode === "new"
                    ? {
                        name: runForm.name.trim(),
                        symbol: runForm.symbol.trim().toUpperCase(),
                        timeframe: runForm.timeframe.trim(),
                        strategyCode: runForm.strategyCode.trim().toUpperCase() || undefined,
                        side: runForm.side,
                        initialEquity: Number(runForm.initialEquity),
                        riskPercent: Number(runForm.riskPercent),
                        startedAt: runForm.startedAt ? `${runForm.startedAt}T00:00:00.000Z` : undefined,
                        finishedAt: runForm.finishedAt ? `${runForm.finishedAt}T23:59:59.999Z` : undefined,
                        notes: runForm.notes.trim() || undefined,
                    }
                    : undefined,
                signals: validation.signals,
                results: validation.results,
            };

            const response = await fetch(`${apiUrl}/api/engine/import-bundle`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Failed to import bundle");
            }

            setSuccess(
                `Imported ${result.data.importedSignals} signals and ${result.data.importedResults} results into run ${result.data.backtestRunId}.`
            );
            setRunMode("existing");
            setSelectedRunId(result.data.backtestRunId);
            await loadReferenceData();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Import failed");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="command-deck-canvas grid h-full place-items-center">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
            </div>
        );
    }

    return (
        <div className="command-deck-canvas h-full overflow-y-auto">
            <div className="mx-auto flex max-w-[1480px] flex-col gap-6 p-4 lg:p-6">
                <section className="rounded-[28px] border border-border-muted bg-bg-primary/90 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-accent">Signals Module</div>
                            <h1 className="mt-2 text-2xl font-black tracking-tight text-text-primary">Generate, import, and review signal runs in one place</h1>
                            <p className="mt-1 text-sm text-text-secondary">
                                Launch generated backtests from signal definitions, keep the legacy import workflow for external datasets, and review everything from the same module.
                            </p>
                        </div>
                        <div className="flex flex-col items-stretch gap-3 lg:items-end">
                            <Link
                                href="/signals/composer"
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-accent/20 bg-accent px-4 py-2 text-sm font-black text-bg-secondary transition-colors hover:bg-accent/90"
                            >
                                <FileEdit className="h-4 w-4" />
                                Open Signal Composer
                            </Link>
                            <div className="flex gap-2 rounded-xl border border-border-muted bg-bg-tertiary p-1">
                                <button
                                    onClick={() => setActiveView("generate")}
                                    className={`rounded-lg px-4 py-2 text-sm font-bold ${activeView === "generate" ? "bg-accent text-bg-secondary" : "text-text-secondary"}`}
                                >
                                    Generate
                                </button>
                                <button
                                    onClick={() => setActiveView("import")}
                                    className={`rounded-lg px-4 py-2 text-sm font-bold ${activeView === "import" ? "bg-accent text-bg-secondary" : "text-text-secondary"}`}
                                >
                                    Import
                                </button>
                                <button
                                    onClick={() => setActiveView("review")}
                                    className={`rounded-lg px-4 py-2 text-sm font-bold ${activeView === "review" ? "bg-accent text-bg-secondary" : "text-text-secondary"}`}
                                >
                                    Review
                                </button>
                                <button
                                    onClick={() => setActiveView("batch")}
                                    className={`rounded-lg px-4 py-2 text-sm font-bold ${activeView === "batch" ? "bg-accent text-bg-secondary" : "text-text-secondary"}`}
                                >
                                    Batch
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-text-primary">
                        Need to build a signal by combining multiple indicator conditions? Use{" "}
                        <Link href="/signals/composer" className="font-bold text-accent underline-offset-4 hover:underline">
                            Signal Composer
                        </Link>
                        {" "}to create or refine composed signal definitions.
                    </div>
                </section>

                {activeView === "generate" ? (
                    <SignalsGenerateWorkspace />
                ) : activeView === "batch" ? (
                    <BatchBacktestComparison />
                ) : activeView === "review" ? (
                    <SignalsReviewWorkspace />
                ) : (
                    <>
                        <SectionCard
                            title="Signals Import Workspace"
                            description="Upload and validate signal datasets"
                            icon={<UploadCloud className="h-5 w-5" />}
                        >
                            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">Run Target</div>
                                    <div className="mt-3 flex gap-2 rounded-xl border border-border-muted bg-bg-primary p-1 text-xs">
                                        <button
                                            onClick={() => setRunMode("new")}
                                            className={`rounded-lg px-3 py-2 font-bold ${runMode === "new" ? "bg-accent text-bg-secondary" : "text-text-secondary"}`}
                                        >
                                            Create new run
                                        </button>
                                        <button
                                            onClick={() => setRunMode("existing")}
                                            className={`rounded-lg px-3 py-2 font-bold ${runMode === "existing" ? "bg-accent text-bg-secondary" : "text-text-secondary"}`}
                                        >
                                            Use existing run
                                        </button>
                                    </div>

                                    {runMode === "existing" ? (
                                        <label className="mt-4 flex flex-col gap-1 text-xs text-text-muted">
                                            Existing run
                                            <select
                                                value={selectedRunId}
                                                onChange={(event) => setSelectedRunId(event.target.value)}
                                                className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent/50"
                                            >
                                                <option value="">Select a run</option>
                                                {runs.map((run) => (
                                                    <option key={run.id} value={run.id}>
                                                        {run.name} / {run.symbol} / {run.timeframe}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ) : (
                                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Run name
                                                <input
                                                    value={runForm.name}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, name: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Symbol
                                                <input
                                                    value={runForm.symbol}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Timeframe
                                                <input
                                                    value={runForm.timeframe}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, timeframe: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Strategy code
                                                <select
                                                    value={runForm.strategyCode}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, strategyCode: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                >
                                                    <option value="">No default strategy</option>
                                                    {strategies.map((strategy) => (
                                                        <option key={strategy.id} value={strategy.code}>
                                                            {strategy.code}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Side
                                                <select
                                                    value={runForm.side}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, side: event.target.value as SideValue }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                >
                                                    <option value="LONG">LONG</option>
                                                    <option value="SHORT">SHORT</option>
                                                </select>
                                            </label>
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Initial equity
                                                <input
                                                    value={runForm.initialEquity}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, initialEquity: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Risk percent
                                                <input
                                                    value={runForm.riskPercent}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, riskPercent: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                Start date
                                                <input
                                                    type="date"
                                                    value={runForm.startedAt}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, startedAt: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1 text-xs text-text-muted">
                                                End date
                                                <input
                                                    type="date"
                                                    value={runForm.finishedAt}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, finishedAt: event.target.value }))}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                            <label className="md:col-span-2 flex flex-col gap-1 text-xs text-text-muted">
                                                Notes
                                                <textarea
                                                    value={runForm.notes}
                                                    onChange={(event) => setRunForm((current) => ({ ...current, notes: event.target.value }))}
                                                    rows={3}
                                                    className="rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
                                                />
                                            </label>
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                    <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">Reference Dictionaries</div>
                                    <div className="mt-4 grid gap-3">
                                        <div className="rounded-xl border border-border-muted bg-bg-primary/80 p-3">
                                            <div className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">Strategy codes</div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {strategies.map((strategy) => (
                                                    <span key={strategy.id} className="rounded-full border border-border-muted bg-bg-secondary px-3 py-1 text-xs font-medium text-text-primary">
                                                        {strategy.code}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-border-muted bg-bg-primary/80 p-3">
                                            <div className="text-xs font-bold uppercase tracking-[0.2em] text-text-muted">Exit rule codes</div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {exitRules.map((rule) => (
                                                    <span key={rule.id} className="rounded-full border border-border-muted bg-bg-secondary px-3 py-1 text-xs font-medium text-text-primary">
                                                        {rule.code}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        {selectedRun ? (
                                            <div className="rounded-xl border border-border-muted bg-bg-primary/80 p-3 text-sm text-text-secondary">
                                                Existing run defaults: <span className="font-semibold text-text-primary">{selectedRun.symbol}</span> / <span className="font-semibold text-text-primary">{selectedRun.timeframe}</span> / <span className="font-semibold text-text-primary">{selectedRun.strategyCode ?? "mixed strategy"}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </SectionCard>

                        <div className="grid gap-6 xl:grid-cols-2">
                            <SectionCard
                                title="Signals Dataset"
                                description="Import signal rows (JSON/CSV)"
                                icon={<FileSpreadsheet className="h-5 w-5" />}
                            >
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setSignalsFormat("csv")}
                                            className={`rounded-full px-3 py-1.5 text-xs font-bold ${signalsFormat === "csv" ? "bg-accent text-bg-secondary" : "border border-border-muted text-text-secondary"}`}
                                        >
                                            CSV
                                        </button>
                                        <button
                                            onClick={() => setSignalsFormat("json")}
                                            className={`rounded-full px-3 py-1.5 text-xs font-bold ${signalsFormat === "json" ? "bg-accent text-bg-secondary" : "border border-border-muted text-text-secondary"}`}
                                        >
                                            JSON
                                        </button>
                                        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-full border border-border-muted px-3 py-1.5 text-xs font-bold text-text-primary">
                                            <Inbox className="h-4 w-4" />
                                            Load file
                                            <input
                                                type="file"
                                                accept={signalsFormat === "csv" ? ".csv,text/csv" : ".json,application/json"}
                                                onChange={(event) => handleFileUpload(event, setSignalsInput)}
                                                className="hidden"
                                            />
                                        </label>
                                    </div>

                                    <textarea
                                        value={signalsInput}
                                        onChange={(event) => setSignalsInput(event.target.value)}
                                        rows={16}
                                        placeholder={signalsFormat === "csv"
                                            ? "signalKey,symbol,timeframe,side,strategyCode,session,entryTime,entryPrice,stopLoss,takeProfit1,takeProfit2,notes"
                                            : '[{"signalKey":"sig-1","symbol":"BTCUSD","timeframe":"1h","side":"LONG","strategyCode":"CURL_MF","session":"LONDON","entryTime":"2026-03-01T08:00:00.000Z","entryPrice":62000,"stopLoss":61600}]'}
                                        className="w-full rounded-2xl border border-border-muted bg-bg-secondary/80 px-4 py-3 font-mono text-sm text-text-primary outline-none focus:border-accent/50"
                                    />

                                    <div className="rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-sm text-text-secondary">
                                        Parsed rows: <span className="font-semibold text-text-primary">{parsedSignals.rows.length}</span>
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard
                                title="Results Dataset"
                                description="Link results to signals"
                                icon={<FileJson className="h-5 w-5" />}
                            >
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setResultsFormat("csv")}
                                            className={`rounded-full px-3 py-1.5 text-xs font-bold ${resultsFormat === "csv" ? "bg-accent text-bg-secondary" : "border border-border-muted text-text-secondary"}`}
                                        >
                                            CSV
                                        </button>
                                        <button
                                            onClick={() => setResultsFormat("json")}
                                            className={`rounded-full px-3 py-1.5 text-xs font-bold ${resultsFormat === "json" ? "bg-accent text-bg-secondary" : "border border-border-muted text-text-secondary"}`}
                                        >
                                            JSON
                                        </button>
                                        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-full border border-border-muted px-3 py-1.5 text-xs font-bold text-text-primary">
                                            <Inbox className="h-4 w-4" />
                                            Load file
                                            <input
                                                type="file"
                                                accept={resultsFormat === "csv" ? ".csv,text/csv" : ".json,application/json"}
                                                onChange={(event) => handleFileUpload(event, setResultsInput)}
                                                className="hidden"
                                            />
                                        </label>
                                    </div>

                                    <textarea
                                        value={resultsInput}
                                        onChange={(event) => setResultsInput(event.target.value)}
                                        rows={16}
                                        placeholder={resultsFormat === "csv"
                                            ? "signalKey,exitRuleCode,resultSide,session,win,isOpen,rMultiple,pnlUsd,maxDrawdownPct,exitReason,exitTime,exitPrice"
                                            : '[{"signalKey":"sig-1","exitRuleCode":"SL_TP2","resultSide":"LONG","session":"LONDON","win":true,"isOpen":false,"rMultiple":1.8,"pnlUsd":360,"exitReason":"TAKE_PROFIT_2"}]'}
                                        className="w-full rounded-2xl border border-border-muted bg-bg-secondary/80 px-4 py-3 font-mono text-sm text-text-primary outline-none focus:border-accent/50"
                                    />

                                    <div className="rounded-xl border border-border-muted bg-bg-secondary/70 p-3 text-sm text-text-secondary">
                                        Parsed rows: <span className="font-semibold text-text-primary">{parsedResults.rows.length}</span>
                                    </div>
                                </div>
                            </SectionCard>
                        </div>

                        <SectionCard
                            title="Validation And Import"
                            description="Review before import"
                            icon={<Database className="h-5 w-5" />}
                        >
                            <div className="grid gap-4 lg:grid-cols-2">
                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                    <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                        <CheckCircle2 className="h-4 w-4 text-price-up" />
                                        Ready payload
                                    </div>
                                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                        <div className="rounded-xl border border-border-muted bg-bg-primary/80 p-3">
                                            <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted">Signals</div>
                                            <div className="mt-2 text-2xl font-black text-text-primary">{validation.signals.length}</div>
                                        </div>
                                        <div className="rounded-xl border border-border-muted bg-bg-primary/80 p-3">
                                            <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted">Results</div>
                                            <div className="mt-2 text-2xl font-black text-text-primary">{validation.results.length}</div>
                                        </div>
                                        <div className="rounded-xl border border-border-muted bg-bg-primary/80 p-3">
                                            <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted">Signal errors</div>
                                            <div className={`mt-2 text-2xl font-black ${validation.signalErrors.length === 0 ? "text-price-up" : "text-price-down"}`}>
                                                {validation.signalErrors.length}
                                            </div>
                                        </div>
                                        <div className="rounded-xl border border-border-muted bg-bg-primary/80 p-3">
                                            <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted">Result errors</div>
                                            <div className={`mt-2 text-2xl font-black ${validation.resultErrors.length === 0 ? "text-price-up" : "text-price-down"}`}>
                                                {validation.resultErrors.length}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={!canSubmit || isSubmitting}
                                        className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                                        Import Bundle
                                    </button>
                                    {success ? (
                                        <StateBanner
                                            tone="success"
                                            size="compact"
                                            className="mt-4 rounded-xl"
                                            message={success}
                                        />
                                    ) : null}
                                    {error ? (
                                        <StateBanner
                                            tone="danger"
                                            size="compact"
                                            className="mt-4 rounded-xl"
                                            message={error}
                                        />
                                    ) : null}
                                </div>

                                <div className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                    <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                        <AlertTriangle className="h-4 w-4 text-accent" />
                                        Validation log
                                    </div>
                                    <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto">
                                        {validation.signalErrors.length === 0 && validation.resultErrors.length === 0 ? (
                                            <StateBanner
                                                tone="success"
                                                size="compact"
                                                className="rounded-xl"
                                                message="Dataset is valid and ready to import."
                                            />
                                        ) : (
                                            [...validation.signalErrors, ...validation.resultErrors].map((message) => (
                                                <StateBanner
                                                    key={message}
                                                    tone="danger"
                                                    size="compact"
                                                    className="rounded-xl"
                                                    message={message}
                                                />
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-5 grid gap-4 lg:grid-cols-2">
                                <details className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                    <summary className="cursor-pointer text-sm font-bold text-text-primary">CSV template hints</summary>
                                    <div className="mt-3 space-y-3 text-sm text-text-secondary">
                                        <p>Signals columns: `signalKey,symbol,timeframe,side,strategyCode,session,entryTime,entryPrice,stopLoss,takeProfit1,takeProfit2,invalidationPrice,notes`</p>
                                        <p>Results columns: `signalKey,exitRuleCode,resultSide,session,win,isOpen,rMultiple,pnlUsd,maxDrawdownPct,exitReason,exitTime,exitPrice,notes`</p>
                                    </div>
                                </details>
                                <details className="rounded-2xl border border-border-muted bg-bg-tertiary/45 p-4">
                                    <summary className="cursor-pointer text-sm font-bold text-text-primary">Run defaults and fallbacks</summary>
                                    <div className="mt-3 space-y-3 text-sm text-text-secondary">
                                        <p>If a signal row omits `symbol`, `timeframe`, or `strategyCode`, the form tries to use the selected run defaults.</p>
                                        <p>When importing results, `signalKey` should match a signal row in the same bundle unless you provide an existing `signalId` directly.</p>
                                    </div>
                                </details>
                            </div>
                        </SectionCard>
                    </>
                )}
            </div>
        </div>
    );
}
