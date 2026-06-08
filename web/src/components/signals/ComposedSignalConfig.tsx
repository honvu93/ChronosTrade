'use client';

import React from 'react';
import { Loader2, Save, AlertCircle, ShieldAlert, ArrowRightLeft, Shield, Flag } from 'lucide-react';
import {
    ComposedExitManagementProfileCode,
    ComposedMatchMode,
    ComposedSide,
    ComposedSlType,
    ComposedTpType,
} from '@/types/signals';
import {
    ComposerValidationIssue,
    EXIT_PROFILE_OPTIONS,
    describeExitManagementPlan,
} from '@/lib/composedSignalConfig';
import SectionCard from '@/components/ui/SectionCard';
import StateBanner from '@/components/ui/StateBanner';

export interface SignalFormState {
    name: string;
    description: string;
    symbol: string;
    timeframe: string;
    matchMode: ComposedMatchMode;
    windowBars: number;
    side: ComposedSide;
    stopLossType: ComposedSlType;
    stopLossValue: number;
    stopLossLookback: number;
    takeProfitType: ComposedTpType;
    takeProfitValue: number;
    exitManagementProfile: ComposedExitManagementProfileCode;
}

interface Props {
    form: SignalFormState;
    blockCount: number;
    saving: boolean;
    saveError: string | null;
    validationIssues: ComposerValidationIssue[];
    onFormChange: (patch: Partial<SignalFormState>) => void;
    onSave: () => void;
}

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

function FieldLabel({ label }: { label: string }) {
    return <label className="text-[9px] font-bold uppercase tracking-widest text-text-muted">{label}</label>;
}

function FieldError({ message }: { message?: string }) {
    if (!message) {
        return null;
    }

    return <div className="text-[11px] text-price-down">{message}</div>;
}

function Row({
    label,
    error,
    children,
}: {
    label: string;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <FieldLabel label={label} />
            {children}
            <FieldError message={error} />
        </div>
    );
}

const inputCls = 'w-full rounded-lg border border-border-muted bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent';
const inputErrorCls = 'border-price-down focus:border-price-down';

const findIssue = (issues: ComposerValidationIssue[], field: string) => issues.find((issue) => issue.field === field)?.message;
const countSectionIssues = (issues: ComposerValidationIssue[], section: ComposerValidationIssue['section']) => issues.filter((issue) => issue.section === section).length;
const renderIssueBadge = (issueCount: number) => (
    <span
        className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${issueCount > 0
            ? 'border-price-down/30 bg-price-down/10 text-price-down'
            : 'border-price-up/30 bg-price-up/10 text-price-up'
            }`}
    >
        {issueCount > 0 ? `${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'Ready'}
    </span>
);

export default function ComposedSignalConfig({
    form,
    blockCount,
    saving,
    saveError,
    validationIssues,
    onFormChange,
    onSave,
}: Props) {
    const nameIssue = findIssue(validationIssues, 'name');
    const symbolIssue = findIssue(validationIssues, 'symbol');
    const timeframeIssue = findIssue(validationIssues, 'timeframe');
    const sideIssue = findIssue(validationIssues, 'side');
    const matchModeIssue = findIssue(validationIssues, 'matchMode');
    const windowBarsIssue = findIssue(validationIssues, 'windowBars');
    const blocksIssue = findIssue(validationIssues, 'blocks');
    const stopLossTypeIssue = findIssue(validationIssues, 'stopLossType');
    const stopLossValueIssue = findIssue(validationIssues, 'stopLossValue');
    const stopLossLookbackIssue = findIssue(validationIssues, 'stopLossLookback');
    const takeProfitTypeIssue = findIssue(validationIssues, 'takeProfitType');
    const takeProfitValueIssue = findIssue(validationIssues, 'takeProfitValue');
    const exitManagementIssue = findIssue(validationIssues, 'exitManagementProfile');

    const entryIssueCount = countSectionIssues(validationIssues, 'entry');
    const protectionIssueCount = countSectionIssues(validationIssues, 'protection');
    const exitIssueCount = countSectionIssues(validationIssues, 'exit');

    const selectedExitProfile = EXIT_PROFILE_OPTIONS.find((option) => option.value === form.exitManagementProfile);

    return (
        <aside className="w-[22rem] shrink-0 overflow-hidden border-l border-border-muted bg-bg-tertiary">
            <div className="border-b border-border-muted px-4 py-4">
                <h2 className="text-xs font-black uppercase tracking-widest text-text-muted">Trade Plan</h2>
                <p className="mt-1 text-[11px] leading-5 text-text-muted">
                    Save entry, protection, and exit decisions as part of the signal definition.
                </p>
            </div>

            <div className="flex h-[calc(100%-89px)] flex-col">
                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    <SectionCard
                        title="Entry Setup"
                        description="Entry conditions and market context"
                        icon={<ArrowRightLeft size={15} />}
                        variant="compact"
                        headerAside={renderIssueBadge(entryIssueCount)}
                    >
                        <Row label="Signal Name" error={nameIssue}>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(event) => onFormChange({ name: event.target.value })}
                                placeholder="e.g. RSI + Structure Long"
                                aria-invalid={Boolean(nameIssue)}
                                className={`${inputCls} ${nameIssue ? inputErrorCls : ''}`}
                            />
                        </Row>

                        <Row label="Description (optional)">
                            <textarea
                                value={form.description}
                                onChange={(event) => onFormChange({ description: event.target.value })}
                                placeholder="Short description of the trade idea..."
                                rows={3}
                                className={`${inputCls} resize-none`}
                            />
                        </Row>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Row label="Symbol" error={symbolIssue}>
                                <input
                                    type="text"
                                    value={form.symbol}
                                    onChange={(event) => onFormChange({ symbol: event.target.value.toUpperCase() })}
                                    placeholder="BTCUSDT"
                                    aria-invalid={Boolean(symbolIssue)}
                                    className={`${inputCls} ${symbolIssue ? inputErrorCls : ''}`}
                                />
                            </Row>

                            <Row label="Timeframe" error={timeframeIssue}>
                                <select
                                    value={form.timeframe}
                                    onChange={(event) => onFormChange({ timeframe: event.target.value })}
                                    aria-invalid={Boolean(timeframeIssue)}
                                    className={`${inputCls} cursor-pointer ${timeframeIssue ? inputErrorCls : ''}`}
                                >
                                    {TIMEFRAMES.map((timeframe) => (
                                        <option key={timeframe} value={timeframe}>{timeframe}</option>
                                    ))}
                                </select>
                            </Row>
                        </div>

                        <Row label="Direction" error={sideIssue}>
                            <div className="grid grid-cols-2 gap-2">
                                {(['LONG', 'SHORT'] as ComposedSide[]).map((side) => (
                                    <button
                                        key={side}
                                        type="button"
                                        onClick={() => onFormChange({ side })}
                                        aria-pressed={form.side === side}
                                        className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${form.side === side
                                            ? side === 'LONG'
                                                ? 'border-price-up/40 bg-price-up/15 text-price-up'
                                                : 'border-price-down/40 bg-price-down/15 text-price-down'
                                            : `border-border-muted bg-bg-primary text-text-muted hover:border-accent/30 ${sideIssue ? inputErrorCls : ''}`
                                            }`}
                                    >
                                        {side}
                                    </button>
                                ))}
                            </div>
                        </Row>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Row label="Condition Connector" error={matchModeIssue}>
                                <select
                                    value={form.matchMode}
                                    onChange={(event) => onFormChange({ matchMode: event.target.value as ComposedMatchMode })}
                                    aria-invalid={Boolean(matchModeIssue)}
                                    className={`${inputCls} cursor-pointer ${matchModeIssue ? inputErrorCls : ''}`}
                                >
                                    <option value="ALL">All conditions align</option>
                                    <option value="ANY">Any condition can trigger</option>
                                    <option value="SEQUENCE">Conditions must trigger in order</option>
                                </select>
                            </Row>

                            <Row label="Confirmation Window (bars)" error={windowBarsIssue}>
                                <input
                                    type="number"
                                    value={form.windowBars}
                                    min={1}
                                    max={200}
                                    onChange={(event) => onFormChange({ windowBars: Number(event.target.value) })}
                                    aria-invalid={Boolean(windowBarsIssue)}
                                    className={`${inputCls} ${windowBarsIssue ? inputErrorCls : ''}`}
                                />
                            </Row>
                        </div>

                        <div className={`rounded-xl border px-3 py-3 text-xs ${blocksIssue
                            ? 'border-price-down/30 bg-price-down/10 text-price-down'
                            : 'border-border-muted bg-bg-secondary/70 text-text-secondary'
                            }`}>
                            <div className="font-bold uppercase tracking-[0.16em]">
                                Condition Stack
                            </div>
                            <div className="mt-1">
                                {blockCount} condition{blockCount === 1 ? '' : 's'} currently define the entry logic.
                            </div>
                            {blocksIssue ? <div className="mt-2">{blocksIssue}</div> : null}
                        </div>
                    </SectionCard>

                    <SectionCard
                        title="Protection Plan"
                        description="Stop loss and position protection"
                        icon={<Shield size={15} />}
                        variant="compact"
                        headerAside={renderIssueBadge(protectionIssueCount)}
                    >
                        <Row label="Stop-Loss Method" error={stopLossTypeIssue}>
                            <select
                                value={form.stopLossType}
                                onChange={(event) => onFormChange({ stopLossType: event.target.value as ComposedSlType })}
                                aria-invalid={Boolean(stopLossTypeIssue)}
                                className={`${inputCls} cursor-pointer ${stopLossTypeIssue ? inputErrorCls : ''}`}
                            >
                                <option value="BELOW_STRUCTURE">Below structure</option>
                                <option value="FIXED_PERCENT">Fixed distance from entry</option>
                            </select>
                        </Row>

                        {form.stopLossType === 'FIXED_PERCENT' ? (
                            <Row label="Stop-Loss Distance (%)" error={stopLossValueIssue}>
                                <input
                                    type="number"
                                    value={form.stopLossValue}
                                    min={0.01}
                                    step={0.01}
                                    onChange={(event) => onFormChange({ stopLossValue: Number(event.target.value) })}
                                    aria-invalid={Boolean(stopLossValueIssue)}
                                    className={`${inputCls} ${stopLossValueIssue ? inputErrorCls : ''}`}
                                />
                            </Row>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Row label="Structure Lookback (bars)" error={stopLossLookbackIssue}>
                                    <input
                                        type="number"
                                        value={form.stopLossLookback}
                                        min={1}
                                        max={200}
                                        step={1}
                                        onChange={(event) => onFormChange({ stopLossLookback: Number(event.target.value) })}
                                        aria-invalid={Boolean(stopLossLookbackIssue)}
                                        className={`${inputCls} ${stopLossLookbackIssue ? inputErrorCls : ''}`}
                                    />
                                </Row>
                                <Row label="Protective Buffer (%)" error={stopLossValueIssue}>
                                    <input
                                        type="number"
                                        value={form.stopLossValue}
                                        min={0.01}
                                        step={0.01}
                                        onChange={(event) => onFormChange({ stopLossValue: Number(event.target.value) })}
                                        aria-invalid={Boolean(stopLossValueIssue)}
                                        className={`${inputCls} ${stopLossValueIssue ? inputErrorCls : ''}`}
                                    />
                                </Row>
                            </div>
                        )}
                    </SectionCard>

                    <SectionCard
                        title="Exit Plan"
                        description="Profit target and exit management"
                        icon={<Flag size={15} />}
                        variant="compact"
                        headerAside={renderIssueBadge(exitIssueCount)}
                    >
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Row label="Profit Target Method" error={takeProfitTypeIssue}>
                                <select
                                    value={form.takeProfitType}
                                    onChange={(event) => onFormChange({ takeProfitType: event.target.value as ComposedTpType })}
                                    aria-invalid={Boolean(takeProfitTypeIssue)}
                                    className={`${inputCls} cursor-pointer ${takeProfitTypeIssue ? inputErrorCls : ''}`}
                                >
                                    <option value="R_MULTIPLE">Risk multiple</option>
                                    <option value="FIXED_PERCENT">Fixed distance from entry</option>
                                </select>
                            </Row>

                            <Row
                                label={form.takeProfitType === 'R_MULTIPLE' ? 'Target (R)' : 'Target Distance (%)'}
                                error={takeProfitValueIssue}
                            >
                                <input
                                    type="number"
                                    value={form.takeProfitValue}
                                    min={0.01}
                                    step={0.01}
                                    onChange={(event) => onFormChange({ takeProfitValue: Number(event.target.value) })}
                                    aria-invalid={Boolean(takeProfitValueIssue)}
                                    className={`${inputCls} ${takeProfitValueIssue ? inputErrorCls : ''}`}
                                />
                            </Row>
                        </div>

                        <Row label="Open-Trade Management" error={exitManagementIssue}>
                            <select
                                value={form.exitManagementProfile}
                                onChange={(event) => onFormChange({ exitManagementProfile: event.target.value as ComposedExitManagementProfileCode })}
                                aria-invalid={Boolean(exitManagementIssue)}
                                className={`${inputCls} cursor-pointer ${exitManagementIssue ? inputErrorCls : ''}`}
                            >
                                {EXIT_PROFILE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </Row>

                        <div className="rounded-xl border border-border-muted bg-bg-secondary/70 px-3 py-3 text-xs text-text-secondary">
                            <div className="font-bold uppercase tracking-[0.16em] text-text-primary">
                                {selectedExitProfile?.label || 'Exit profile'}
                            </div>
                            <div className="mt-2 leading-5">
                                {describeExitManagementPlan(form.exitManagementProfile)}
                            </div>
                        </div>
                    </SectionCard>
                </div>

                <div className="space-y-3 border-t border-border-muted px-4 py-4">
                    {validationIssues.length > 0 ? (
                        <StateBanner
                            tone="danger"
                            className="rounded-xl p-3 text-xs"
                            title={(
                                <span className="flex items-center gap-2">
                                    <ShieldAlert size={13} />
                                    Save blocked
                                </span>
                            )}
                            message={(
                                <>
                                    <div className="leading-5">
                                        Fix the incomplete entry, protection, or exit decisions below before the signal can be saved.
                                    </div>
                                    <ul className="mt-2 space-y-1.5 pl-4">
                                        {validationIssues.map((issue) => (
                                            <li key={`${issue.section}-${issue.field}-${issue.message}`}>{issue.message}</li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        />
                    ) : null}

                    {saveError ? (
                        <StateBanner
                            tone="danger"
                            size="compact"
                            className="rounded-xl p-3 text-xs"
                            message={(
                                <span className="flex items-start gap-2">
                                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                                    <span>{saveError}</span>
                                </span>
                            )}
                        />
                    ) : null}

                    <button
                        type="button"
                        onClick={onSave}
                        disabled={saving}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-accent py-2.5 text-sm font-black text-bg-secondary transition-all hover:bg-accent/90 disabled:border-border-muted disabled:bg-bg-primary disabled:text-text-muted"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        {saving ? 'Saving...' : 'Save Signal'}
                    </button>

                    <div className="text-center text-[10px] leading-5 text-text-muted">
                        Saving preserves the entry, protection, and exit plan for later validation and backtesting.
                    </div>
                </div>
            </div>
        </aside>
    );
}
