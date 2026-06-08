'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { Eye, FileEdit, Layers, PlusCircle, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import {
    TechIndicatorDefinition,
    TechIndicatorConditionDef,
    ComposedBlockConfig,
    ComposedSignal,
} from '@/types/signals';
import { useTechIndicatorCatalog, useComposedSignals } from '@/hooks/useTechIndicators';
import { buildReviewedConditions } from '@/lib/composedSignalReview';
import {
    ComposerValidationIssue,
    normalizeDisplayPercent,
    toStoredPercentFraction,
    validateComposerConfiguration,
} from '@/lib/composedSignalConfig';
import {
    ComposedSignalLifecycleFilter,
    filterComposedSignalsByLifecycle,
    getComposedSignalLifecycleState,
    summarizeComposedSignalLifecycles,
} from '@/lib/composedSignalLifecycle';
import {
    buildReusableSignalDraft,
    buildSignalRefinementLineage,
} from '@/lib/composedSignalReuse';
import { buildGeneratedBacktestLaunchHref } from '@/lib/generatedBacktestContext';
import { useMarketStore } from '@/store/useMarketStore';
import { mapMarketTimeframe } from '@/lib/signalContextUtils';
import IndicatorBlockCatalog from './IndicatorBlockCatalog';
import CompositionCanvas from './CompositionCanvas';
import ComposedSignalConfig, { SignalFormState } from './ComposedSignalConfig';
import SignalDefinitionReviewPanel from './SignalDefinitionReviewPanel';
import { ComposedSignalLineage } from '@/types/signals';

const mergeValidationIssues = (
    clientIssues: ComposerValidationIssue[],
    serverIssues: ComposerValidationIssue[],
) => {
    const issueMap = new Map<string, ComposerValidationIssue>();

    [...clientIssues, ...serverIssues].forEach((issue) => {
        issueMap.set(`${issue.section}:${issue.field}:${issue.message}`, issue);
    });

    return Array.from(issueMap.values());
};

const readApiValidationIssues = (error: unknown): ComposerValidationIssue[] => {
    const payload = typeof error === 'object' && error !== null && 'response' in error
        ? (error as { response?: { data?: { issues?: unknown } } }).response?.data?.issues
        : undefined;

    if (!Array.isArray(payload)) {
        return [];
    }

    return payload
        .filter((issue): issue is ComposerValidationIssue => (
            typeof issue === 'object'
            && issue !== null
            && 'field' in issue
            && 'section' in issue
            && 'message' in issue
        ))
        .map((issue) => ({
            field: String(issue.field),
            section: issue.section as ComposerValidationIssue['section'],
            message: String(issue.message),
        }));
};

const defaultFormFromContext = (): SignalFormState => {
    const { symbol, timeframe } = useMarketStore.getState();
    return {
        name: '',
        description: '',
        symbol,
        timeframe: mapMarketTimeframe(timeframe),
        matchMode: 'ALL',
        windowBars: 5,
        side: 'LONG',
        stopLossType: 'BELOW_STRUCTURE',
        stopLossValue: 0.2,
        stopLossLookback: 20,
        takeProfitType: 'R_MULTIPLE',
        takeProfitValue: 2,
        exitManagementProfile: 'HARD_SIGNAL_TP',
    };
};

const formStateFromDefinition = (
    signalName: string,
    description: string,
    composedBlocks: ComposedSignal['composedBlocks'],
): SignalFormState => ({
    name: signalName,
    description,
    symbol: composedBlocks.symbol ?? 'BTCUSDT',
    timeframe: composedBlocks.timeframe ?? 'H1',
    matchMode: composedBlocks.matchMode,
    windowBars: composedBlocks.windowBars,
    side: composedBlocks.side,
    stopLossType: composedBlocks.stopLoss.type,
    stopLossValue: normalizeDisplayPercent(composedBlocks.stopLoss.value, 0.2),
    stopLossLookback: composedBlocks.stopLoss.lookback ?? 20,
    takeProfitType: composedBlocks.takeProfit.type,
    takeProfitValue: composedBlocks.takeProfit.type === 'FIXED_PERCENT'
        ? normalizeDisplayPercent(composedBlocks.takeProfit.value, 2)
        : composedBlocks.takeProfit.value,
    exitManagementProfile: composedBlocks.exitManagement?.profileCode ?? 'HARD_SIGNAL_TP',
});

function SavedSignalRow({
    signal,
    indicators,
    isRetiring,
    onRetire,
    onEdit,
    onInspect,
}: {
    signal: ComposedSignal;
    indicators: TechIndicatorDefinition[];
    isRetiring: boolean;
    onRetire: (signal: ComposedSignal) => void | Promise<void>;
    onEdit: (signal: ComposedSignal) => void;
    onInspect: (signal: ComposedSignal) => void;
}) {
    const blocks = signal.composedBlocks?.blocks ?? [];
    const reviewedConditions = buildReviewedConditions(blocks, indicators);
    const previewLabels = reviewedConditions
        .slice(0, 2)
        .map((condition) => condition.conditionLabel);
    const lifecycleState = getComposedSignalLifecycleState(signal);
    const isRetired = lifecycleState === 'RETIRED';
    const lineage = signal.composedBlocks.lineage;

    return (
        <div className="group flex items-center gap-3 border-b border-border-muted px-4 py-3 transition-colors hover:bg-bg-primary/30">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-text-primary">{signal.name}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-black ${isRetired
                        ? 'border-price-down/30 bg-price-down/10 text-price-down'
                        : 'border-price-up/30 bg-price-up/10 text-price-up'
                        }`}>
                        {lifecycleState}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] font-black ${signal.isActive
                        ? 'border-price-up/30 bg-price-up/10 text-price-up'
                        : 'border-border-muted bg-bg-primary text-text-muted'
                        }`}>
                        {signal.isActive ? 'Validation-ready' : 'Inspect-only'}
                    </span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 font-mono text-[10px] text-text-muted">
                    <span>{signal.composedBlocks?.matchMode}</span>
                    <span>|</span>
                    <span>{blocks.length} conditions</span>
                    <span>|</span>
                    <span>{signal.composedBlocks?.side}</span>
                    <span>|</span>
                    <span className="text-text-muted/60">v{signal.version}</span>
                </div>
                {lineage ? (
                    <div className="mt-1 text-[10px] font-medium text-text-muted">
                        Derived from {lineage.parentName} ({lineage.parentCode} v{lineage.parentVersion})
                    </div>
                ) : null}
                {previewLabels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {previewLabels.map((label) => (
                            <span
                                key={`${signal.id}-${label}`}
                                className="rounded-full border border-border-muted bg-bg-primary px-2.5 py-1 text-[10px] font-medium text-text-secondary"
                            >
                                {label}
                            </span>
                        ))}
                        {reviewedConditions.length > previewLabels.length && (
                            <span className="rounded-full border border-border-muted bg-bg-primary px-2.5 py-1 text-[10px] font-medium text-text-muted">
                                +{reviewedConditions.length - previewLabels.length} more
                            </span>
                        )}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                <button
                    type="button"
                    onClick={() => onInspect(signal)}
                    className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-[10px] font-bold text-text-primary transition-colors hover:border-border-muted hover:bg-white/10"
                >
                    <Eye size={12} />
                    Inspect
                </button>
                {isRetired ? (
                    <span className="rounded-lg border border-price-down/20 bg-price-down/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-price-down">
                        Retired snapshot
                    </span>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={() => onEdit(signal)}
                            className="rounded-lg border border-transparent px-2 py-1 text-[10px] font-bold text-accent transition-colors hover:border-accent/20 hover:bg-accent/10"
                        >
                            Reopen
                        </button>
                        <button
                            type="button"
                            onClick={() => onRetire(signal)}
                            disabled={isRetiring}
                            aria-label={`Retire ${signal.name}`}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-price-down transition-colors hover:bg-price-down/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            <Trash2 size={13} />
                            {isRetiring ? 'Retiring...' : 'Retire'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

type ActiveTab = 'composer' | 'saved';

export default function SignalComposerPage() {
    const router = useRouter();
    const { indicators, loading: catalogLoading, error: catalogError } = useTechIndicatorCatalog();
    const { signals, loading: signalsLoading, create, update, retire } = useComposedSignals();

    const [activeTab, setActiveTab] = useState<ActiveTab>('composer');
    const [blocks, setBlocks] = useState<ComposedBlockConfig[]>([]);
    const [form, setForm] = useState<SignalFormState>(defaultFormFromContext());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [reviewingSignal, setReviewingSignal] = useState<ComposedSignal | null>(null);
    const [retiringId, setRetiringId] = useState<string | null>(null);
    const [draftLineage, setDraftLineage] = useState<ComposedSignalLineage | null>(null);
    const [lineageSource, setLineageSource] = useState<ComposedSignal | null>(null);
    const [isReuseDraft, setIsReuseDraft] = useState(false);
    const [lifecycleFilter, setLifecycleFilter] = useState<ComposedSignalLifecycleFilter>('ALL');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedOk, setSavedOk] = useState(false);
    const [showValidationState, setShowValidationState] = useState(false);
    const [serverValidationIssues, setServerValidationIssues] = useState<ComposerValidationIssue[]>([]);

    const validationIssues = mergeValidationIssues(
        showValidationState ? validateComposerConfiguration({
            name: form.name,
            symbol: form.symbol,
            timeframe: form.timeframe,
            matchMode: form.matchMode,
            windowBars: form.windowBars,
            side: form.side,
            stopLossType: form.stopLossType,
            stopLossValue: form.stopLossValue,
            stopLossLookback: form.stopLossLookback,
            takeProfitType: form.takeProfitType,
            takeProfitValue: form.takeProfitValue,
            exitManagementProfile: form.exitManagementProfile,
            blockCount: blocks.length,
        }) : [],
        serverValidationIssues,
    );

    const lifecycleSummary = useMemo(() => summarizeComposedSignalLifecycles(signals), [signals]);
    const visibleSignals = useMemo(
        () => filterComposedSignalsByLifecycle(signals, lifecycleFilter),
        [lifecycleFilter, signals],
    );

    const openComposerDraft = useCallback((input: {
        name: string;
        description: string;
        composedBlocks: ComposedSignal['composedBlocks'];
        editingId: string | null;
        lineage: ComposedSignalLineage | null;
        lineageSource: ComposedSignal | null;
        isReuseDraft: boolean;
    }) => {
        setBlocks(input.composedBlocks.blocks.map((block) => ({ ...block, id: block.id || uuidv4() })));
        setForm(formStateFromDefinition(input.name, input.description, input.composedBlocks));
        setEditingId(input.editingId);
        setDraftLineage(input.lineage);
        setLineageSource(input.lineageSource);
        setIsReuseDraft(input.isReuseDraft);
        setReviewingSignal(null);
        setSaveError(null);
        setSavedOk(false);
        setShowValidationState(false);
        setServerValidationIssues([]);
        setActiveTab('composer');
    }, []);

    const patchForm = useCallback((patch: Partial<SignalFormState>) => {
        setForm((prev) => ({ ...prev, ...patch }));
        setSaveError(null);
        setSavedOk(false);
        setServerValidationIssues([]);
    }, []);

    const resetComposer = useCallback(() => {
        setBlocks([]);
        setForm(defaultFormFromContext());
        setEditingId(null);
        setDraftLineage(null);
        setLineageSource(null);
        setIsReuseDraft(false);
        setSaveError(null);
        setSavedOk(false);
        setShowValidationState(false);
        setServerValidationIssues([]);
    }, []);

    const closeReview = useCallback(() => {
        setReviewingSignal(null);
    }, []);

    const handleAddCondition = useCallback((
        indicator: TechIndicatorDefinition,
        condition: TechIndicatorConditionDef,
    ) => {
        const indicatorParams: Record<string, unknown> = {};
        indicator.paramSchema.forEach((field) => {
            if (field.default !== undefined) {
                indicatorParams[field.id] = field.default;
            }
        });

        const conditionParams: Record<string, unknown> = {};
        condition.paramSchema.forEach((field) => {
            if (field.default !== undefined) {
                conditionParams[field.id] = field.default;
            }
        });

        setBlocks((prev) => [...prev, {
            id: uuidv4(),
            indicatorId: indicator.id,
            conditionId: condition.id,
            indicatorParams,
            conditionParams,
        }]);
        setSavedOk(false);
        setSaveError(null);
        setServerValidationIssues([]);
    }, []);

    const handleRemoveBlock = useCallback((id: string) => {
        setBlocks((prev) => prev.filter((block) => block.id !== id));
        setSavedOk(false);
        setSaveError(null);
        setServerValidationIssues([]);
    }, []);

    const handleUpdateBlock = useCallback((id: string, patch: Partial<ComposedBlockConfig>) => {
        setBlocks((prev) => prev.map((block) => block.id === id ? { ...block, ...patch } : block));
        setSavedOk(false);
        setSaveError(null);
        setServerValidationIssues([]);
    }, []);

    const handleMoveBlock = useCallback((id: string, direction: 'up' | 'down') => {
        setBlocks((prev) => {
            const index = prev.findIndex((block) => block.id === id);
            if (index < 0) {
                return prev;
            }

            const next = [...prev];
            const swapIndex = direction === 'up' ? index - 1 : index + 1;
            if (swapIndex < 0 || swapIndex >= next.length) {
                return prev;
            }

            [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
            return next;
        });
        setSaveError(null);
        setSavedOk(false);
        setServerValidationIssues([]);
    }, []);

    const handleEdit = useCallback((signal: ComposedSignal) => {
        if (!signal.isActive) {
            setReviewingSignal(signal);
            setActiveTab('saved');
            return;
        }

        const lineage = signal.composedBlocks.lineage ?? null;
        const sourceSignal = lineage
            ? signals.find((candidate) => candidate.id === lineage.parentSignalId) ?? null
            : null;

        openComposerDraft({
            name: signal.name,
            description: signal.description ?? '',
            composedBlocks: signal.composedBlocks,
            editingId: signal.id,
            lineage,
            lineageSource: sourceSignal,
            isReuseDraft: false,
        });
    }, [openComposerDraft, signals]);

    const handleReuse = useCallback((signal: ComposedSignal) => {
        const reusableDraft = buildReusableSignalDraft(signal, uuidv4);
        openComposerDraft({
            name: reusableDraft.name,
            description: reusableDraft.description,
            composedBlocks: reusableDraft.composedBlocks,
            editingId: null,
            lineage: reusableDraft.composedBlocks.lineage ?? buildSignalRefinementLineage(signal),
            lineageSource: signal,
            isReuseDraft: true,
        });
    }, [openComposerDraft]);

    const handleInspect = useCallback((signal: ComposedSignal) => {
        setReviewingSignal(signal);
        setActiveTab('saved');
    }, []);

    const handleRunBacktest = useCallback((signal: ComposedSignal) => {
        router.push(buildGeneratedBacktestLaunchHref(signal));
    }, [router]);

    const handleRetire = useCallback(async (signal: ComposedSignal) => {
        if (!signal.isActive || retiringId === signal.id) {
            return;
        }

        const confirmed = typeof window === 'undefined'
            ? true
            : window.confirm(`Retire "${signal.name}"? It will remain inspectable but no longer behave like an active definition.`);

        if (!confirmed) {
            return;
        }

        setRetiringId(signal.id);
        setSaveError(null);
        setSavedOk(false);
        setServerValidationIssues([]);

        try {
            const retiredSignal = await retire(signal.id);
            setReviewingSignal((current) => current?.id === signal.id ? retiredSignal : current);
            if (editingId === signal.id) {
                resetComposer();
            }
        } catch (error: unknown) {
            const apiMessage = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            const fallbackMessage = error instanceof Error ? error.message : 'Failed to retire signal';
            setSaveError(apiMessage || fallbackMessage);
        } finally {
            setRetiringId(null);
        }
    }, [editingId, resetComposer, retire, retiringId]);

    const handleSave = useCallback(async () => {
        const clientIssues = validateComposerConfiguration({
            name: form.name,
            symbol: form.symbol,
            timeframe: form.timeframe,
            matchMode: form.matchMode,
            windowBars: form.windowBars,
            side: form.side,
            stopLossType: form.stopLossType,
            stopLossValue: form.stopLossValue,
            stopLossLookback: form.stopLossLookback,
            takeProfitType: form.takeProfitType,
            takeProfitValue: form.takeProfitValue,
            exitManagementProfile: form.exitManagementProfile,
            blockCount: blocks.length,
        });

        setShowValidationState(true);
        setServerValidationIssues([]);
        if (clientIssues.length > 0) {
            setSaveError(null);
            return;
        }

        setSaving(true);
        setSaveError(null);

        const payload = {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            composedBlocks: {
                matchMode: form.matchMode,
                windowBars: form.windowBars,
                side: form.side,
                blocks,
                stopLoss: form.stopLossType === 'BELOW_STRUCTURE'
                    ? {
                        type: 'BELOW_STRUCTURE' as const,
                        value: toStoredPercentFraction(form.stopLossValue),
                        lookback: form.stopLossLookback,
                    }
                    : {
                        type: 'FIXED_PERCENT' as const,
                        value: toStoredPercentFraction(form.stopLossValue),
                    },
                takeProfit: form.takeProfitType === 'FIXED_PERCENT'
                    ? {
                        type: 'FIXED_PERCENT' as const,
                        value: toStoredPercentFraction(form.takeProfitValue),
                    }
                    : {
                        type: 'R_MULTIPLE' as const,
                        value: Number(form.takeProfitValue.toFixed(4)),
                    },
                exitManagement: {
                    profileCode: form.exitManagementProfile,
                },
                ...(draftLineage ? { lineage: draftLineage } : {}),
                symbol: form.symbol,
                timeframe: form.timeframe,
            },
        };

        try {
            if (editingId) {
                await update(editingId, payload);
            } else {
                await create(payload);
            }
            setReviewingSignal(null);
            resetComposer();
            setActiveTab('saved');
            setSavedOk(true);
            setShowValidationState(false);
        } catch (error: unknown) {
            const apiIssues = readApiValidationIssues(error);
            const apiMessage = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            const fallbackMessage = error instanceof Error ? error.message : 'Failed to save signal';
            if (apiIssues.length > 0) {
                setServerValidationIssues(apiIssues);
                setShowValidationState(true);
                setSaveError(null);
            } else {
                setSaveError(apiMessage || fallbackMessage);
            }
        } finally {
            setSaving(false);
        }
    }, [blocks, create, draftLineage, editingId, form, resetComposer, update]);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-bg-secondary text-text-primary">
            <header className="shrink-0 flex items-center justify-between border-b border-border-muted px-6 py-4">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-black tracking-tight text-text-primary">
                            Signal Composer
                        </h1>
                        {activeTab === 'composer' && editingId === null && (blocks.length > 0 || form.name.trim() !== '') && (
                            <span
                                aria-label="Signal is in draft state"
                                className="flex items-center gap-1 rounded border border-text-muted/30 bg-bg-tertiary px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-text-muted"
                            >
                                <FileEdit size={10} aria-hidden="true" />
                                Draft
                            </span>
                        )}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                        Mix conditions from indicator blocks into one readable signal definition.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {savedOk && (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-price-up">
                            <CheckCircle2 size={14} />
                            <span>Saved!</span>
                        </div>
                    )}

                    <div className="flex gap-0.5 rounded-xl border border-border-muted bg-bg-tertiary p-0.5">
                        <button
                            type="button"
                            onClick={() => setActiveTab('composer')}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${activeTab === 'composer'
                                ? 'bg-accent text-bg-secondary'
                                : 'text-text-muted hover:text-text-primary'
                                }`}
                        >
                            <PlusCircle size={13} />
                            Composer
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('saved')}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${activeTab === 'saved'
                                ? 'bg-accent text-bg-secondary'
                                : 'text-text-muted hover:text-text-primary'
                                }`}
                        >
                            <Layers size={13} />
                            Saved
                            {signals.length > 0 && (
                                <span className="rounded bg-bg-primary px-1 text-[9px] text-text-muted">{signals.length}</span>
                            )}
                        </button>
                    </div>

                    {editingId && (
                        <button
                            type="button"
                            onClick={resetComposer}
                            className="flex items-center gap-1.5 rounded-xl border border-border-muted px-3 py-1.5 text-xs font-bold text-text-muted transition-colors hover:border-accent/30 hover:text-text-primary"
                        >
                            <XCircle size={13} />
                            Cancel Edit
                        </button>
                    )}
                </div>
            </header>

            {activeTab === 'composer' ? (
                <div className="flex flex-1 flex-col overflow-hidden">
                    {draftLineage ? (
                        <div className="border-b border-border-muted px-6 py-3">
                            <div className="rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">
                                        {isReuseDraft ? 'Refinement Draft' : 'Lineage Link'}
                                    </span>
                                    {lineageSource ? (
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${getComposedSignalLifecycleState(lineageSource) === 'RETIRED'
                                            ? 'border-price-down/30 bg-price-down/10 text-price-down'
                                            : 'border-price-up/30 bg-price-up/10 text-price-up'
                                            }`}>
                                            {getComposedSignalLifecycleState(lineageSource)}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-2 text-sm font-bold text-text-primary">
                                    {draftLineage.parentName} ({draftLineage.parentCode} v{draftLineage.parentVersion})
                                </div>
                                <p className="mt-1 text-xs leading-6 text-text-secondary">
                                    {isReuseDraft
                                        ? 'Saving this draft will create a new signal linked back to the original for future refinement history.'
                                        : 'Editing this signal preserves its link back to the original source signal.'}
                                </p>
                            </div>
                        </div>
                    ) : null}

                    <div className="flex flex-1 overflow-hidden">
                        <IndicatorBlockCatalog
                            indicators={indicators}
                            loading={catalogLoading}
                            error={catalogError}
                            onAddCondition={handleAddCondition}
                        />

                        <CompositionCanvas
                            blocks={blocks}
                            indicators={indicators}
                            matchMode={form.matchMode}
                            windowBars={form.windowBars}
                            onRemoveBlock={handleRemoveBlock}
                            onUpdateBlock={handleUpdateBlock}
                            onMoveBlock={handleMoveBlock}
                        />

                        <ComposedSignalConfig
                            form={form}
                            blockCount={blocks.length}
                            saving={saving}
                            saveError={saveError}
                            validationIssues={validationIssues}
                            onFormChange={patchForm}
                            onSave={handleSave}
                        />
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto">
                    {signalsLoading && signals.length === 0 ? (
                        <div className="flex h-32 items-center justify-center text-sm text-text-muted">
                            Loading...
                        </div>
                    ) : signals.length === 0 ? (
                        <div className="flex h-64 flex-col items-center justify-center space-y-3 text-text-muted">
                            <Layers size={40} className="opacity-20" />
                            <p className="text-sm">No composed signals yet. Create one in the Composer tab.</p>
                        </div>
                    ) : (
                        <div className="mx-auto max-w-3xl py-4">
                            {saveError ? (
                                <div className="mb-4 rounded-2xl border border-price-down/20 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                                    {saveError}
                                </div>
                            ) : null}
                            <div className="overflow-hidden rounded-2xl border border-border-muted bg-bg-tertiary">
                                <div className="flex flex-col gap-3 border-b border-border-muted px-4 py-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <span className="text-xs font-black uppercase tracking-widest text-text-muted">
                                            {lifecycleSummary.all} Composed Signal{lifecycleSummary.all !== 1 ? 's' : ''}
                                        </span>
                                        <div className="mt-1 text-xs text-text-muted">
                                            {lifecycleSummary.active} active / {lifecycleSummary.retired} retired
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {([
                                            ['ALL', lifecycleSummary.all],
                                            ['ACTIVE', lifecycleSummary.active],
                                            ['RETIRED', lifecycleSummary.retired],
                                        ] as const).map(([filter, count]) => (
                                            <button
                                                key={filter}
                                                type="button"
                                                onClick={() => setLifecycleFilter(filter)}
                                                className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${lifecycleFilter === filter
                                                    ? 'bg-accent text-bg-secondary'
                                                    : 'border border-border-muted text-text-secondary'
                                                    }`}
                                            >
                                                {filter} <span className="opacity-70">{count}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {visibleSignals.length === 0 ? (
                                    <div className="px-4 py-10 text-center text-sm text-text-muted">
                                        No {lifecycleFilter.toLowerCase()} signals in this view yet.
                                    </div>
                                ) : (
                                    visibleSignals.map((signal) => (
                                        <SavedSignalRow
                                            key={signal.id}
                                            signal={signal}
                                            indicators={indicators}
                                            isRetiring={retiringId === signal.id}
                                            onRetire={handleRetire}
                                            onEdit={handleEdit}
                                            onInspect={handleInspect}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <SignalDefinitionReviewPanel
                signal={reviewingSignal}
                indicators={indicators}
                signals={signals}
                isOpen={reviewingSignal !== null}
                onClose={closeReview}
                onInspect={handleInspect}
                onEdit={handleEdit}
                onRunBacktest={handleRunBacktest}
                onReuse={handleReuse}
                onRetire={handleRetire}
                retiringId={retiringId}
            />
        </div>
    );
}
