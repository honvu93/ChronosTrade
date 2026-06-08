"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, ChevronLeft, X, Loader2, AlertTriangle } from "lucide-react";
import { useTradingAccounts } from "@/hooks/useTradingAccounts";
import { TradingAccountSummary } from "@/types/trading";
import { activatePaperBinding, paperSetup, PaperSetupResponse } from "@/lib/paperSetupApi";
import { useAppLocale } from "@/hooks/useAppLocale";
import { interpolateCopy, TranslationCatalog } from "@/lib/translations";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WizardProps {
    signalCode: string;
    signalVersion: number;
    signalName: string;
    onClose: () => void;
    /** Called after the binding is successfully activated */
    onSuccess?: (result: PaperSetupResponse) => void;
}

type WizardStep = "account" | "risk" | "review";

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: WizardStep }) {
    const { copy } = useAppLocale();
    const STEPS: Array<{ id: WizardStep; label: string }> = [
        { id: "account", label: copy.paperWizard.account },
        { id: "risk", label: copy.paperWizard.risk },
        { id: "review", label: copy.paperWizard.review },
    ];
    const currentIndex = STEPS.findIndex((s) => s.id === current);
    return (
        <div className="flex items-center gap-0" role="tablist" aria-label="Wizard steps">
            {STEPS.map((step, i) => {
                const isDone = i < currentIndex;
                const isActive = i === currentIndex;
                return (
                    <div key={step.id} className="flex items-center">
                        <span
                            className={`text-[11px] font-black uppercase tracking-[0.14em] ${
                                isActive
                                    ? "text-accent"
                                    : isDone
                                        ? "text-price-up"
                                        : "text-text-muted"
                            }`}
                        >
                            {step.label}
                        </span>
                        {i < STEPS.length - 1 ? (
                            <span className={`mx-2 h-px w-8 ${isDone ? "bg-price-up/40" : "bg-border-muted"}`} />
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Step 1: Account ─────────────────────────────────────────────────────────

function AccountStep({
    paperAccounts,
    selectedId,
    onSelect,
    loading,
}: {
    paperAccounts: TradingAccountSummary[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    loading: boolean;
}) {
    const { copy } = useAppLocale();
    const t = copy.paperWizard;

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-6 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                {t.loadingAccounts}
            </div>
        );
    }

    if (paperAccounts.length === 0) {
        return (
            <div className="rounded-xl border border-price-down/20 bg-price-down/8 px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-price-down" />
                    <span className="font-bold text-price-down">{t.noPaperAccountFound}</span>
                </div>
                <p className="mt-1.5 text-[12px] text-text-secondary">
                    {t.connectPaperFirst}
                </p>
                <a
                    href="/trading?tab=accounts"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-accent underline underline-offset-2"
                >
                    {t.goToAccountSettings}
                </a>
            </div>
        );
    }

    if (paperAccounts.length === 1) {
        const acct = paperAccounts[0];
        return (
            <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">{t.paperAccount}</div>
                <div className="flex items-center justify-between rounded-xl border border-border-muted bg-bg-tertiary/60 px-4 py-3">
                    <div>
                        <div className="text-sm font-black text-text-primary">{acct.label}</div>
                        <div className="mt-0.5 text-[11px] text-text-muted">{acct.mt5Login} · {acct.mt5Server ?? "Demo"}</div>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                        acct.status === "ACTIVE"
                            ? "border-price-up/30 bg-price-up/10 text-price-up"
                            : "border-border-muted bg-bg-tertiary text-text-muted"
                    }`}>
                        {acct.status}
                    </span>
                </div>
                <p className="text-[11px] text-text-muted">
                    {t.autoSelected}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <label htmlFor="paper-account-select" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
                {t.selectPaperAccount}
            </label>
            <select
                id="paper-account-select"
                value={selectedId ?? ""}
                onChange={(e) => { onSelect(e.target.value); }}
                className="w-full rounded-xl border border-border-muted bg-bg-tertiary/60 px-4 py-2.5 text-sm font-bold text-text-primary focus:border-accent focus:outline-none"
            >
                {paperAccounts.map((acct) => (
                    <option key={acct.id} value={acct.id}>
                        {acct.label} ({acct.mt5Login}) — {acct.status}
                    </option>
                ))}
            </select>
        </div>
    );
}

// ─── Step 2: Risk config ─────────────────────────────────────────────────────

function RiskStep({
    riskPercent,
    onRiskChange,
    maxOpenPositions,
    onMaxPositionsChange,
}: {
    riskPercent: number;
    onRiskChange: (v: number) => void;
    maxOpenPositions: number;
    onMaxPositionsChange: (v: number) => void;
}) {
    const { copy } = useAppLocale();
    const t = copy.paperWizard;
    const dailyLossCap = Math.round(riskPercent * 3 * 100) / 100;

    return (
        <div className="space-y-5">
            <div>
                <div className="flex items-center justify-between">
                    <label htmlFor="risk-slider" className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
                        {t.riskPerTrade}
                    </label>
                    <span className="text-sm font-black text-text-primary">{riskPercent.toFixed(1)}%</span>
                </div>
                <input
                    id="risk-slider"
                    type="range"
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={riskPercent}
                    onChange={(e) => { onRiskChange(Number(e.target.value)); }}
                    className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border-muted accent-accent"
                    aria-label={`${t.riskPerTrade}: ${riskPercent.toFixed(1)}%`}
                />
                <div className="mt-1 flex justify-between text-[10px] text-text-muted">
                    <span>0.1%</span>
                    <span>5.0%</span>
                </div>
            </div>

            <div>
                <label htmlFor="max-positions" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
                    {t.maxOpenPositions}
                </label>
                <input
                    id="max-positions"
                    type="number"
                    min={1}
                    max={10}
                    value={maxOpenPositions}
                    onChange={(e) => {
                        const v = Math.max(1, Math.min(10, Math.trunc(Number(e.target.value)) || 1));
                        onMaxPositionsChange(v);
                    }}
                    className="mt-2 w-24 rounded-xl border border-border-muted bg-bg-tertiary/60 px-3 py-2 text-sm font-black text-text-primary focus:border-accent focus:outline-none"
                    aria-label={t.maxOpenPositions}
                />
            </div>

            <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 px-4 py-3 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">
                    {t.autoCalculatedGuardrails}
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-[12px] text-text-secondary">{t.dailyLossCap}</span>
                    <span className="text-[12px] font-black text-text-primary">–{dailyLossCap.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-[12px] text-text-secondary">{t.killSwitchDrawdown}</span>
                    <span className="text-[12px] font-black text-text-primary">–15.0%</span>
                </div>
            </div>
        </div>
    );
}

// ─── Step 3: Review ──────────────────────────────────────────────────────────

function ReviewStep({
    signalName,
    signalCode,
    signalVersion,
    accountLabel,
    riskPercent,
    maxOpenPositions,
    submitting,
    error,
    onApprove,
}: {
    signalName: string;
    signalCode: string;
    signalVersion: number;
    accountLabel: string;
    riskPercent: number;
    maxOpenPositions: number;
    submitting: boolean;
    error: string | null;
    onApprove: () => void;
}) {
    const { copy } = useAppLocale();
    const t = copy.paperWizard;
    const dailyLossCap = Math.round(riskPercent * 3 * 100) / 100;

    return (
        <div className="space-y-4">
            <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">{t.signal}</div>
                <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-sm font-black text-text-primary">{signalName}</span>
                    <span className="rounded-full border border-border-muted bg-bg-tertiary px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-text-muted">
                        {signalCode} @v{signalVersion}
                    </span>
                </div>
            </div>

            <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">{t.account}</div>
                <div className="mt-1 text-sm font-bold text-text-primary">{accountLabel}</div>
            </div>

            <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">{t.riskConfig}</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                        { label: t.riskTrade, value: `${riskPercent.toFixed(1)}%` },
                        { label: t.maxPositions, value: String(maxOpenPositions) },
                        { label: t.dailyCap, value: `–${dailyLossCap.toFixed(1)}%` },
                        { label: t.killSwitch, value: "–15.0%" },
                    ].map(({ label, value }) => (
                        <div key={label} className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-2.5">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">{label}</div>
                            <div className="mt-1 text-sm font-black text-text-primary">{value}</div>
                        </div>
                    ))}
                </div>
            </div>

            {error ? (
                <div className="rounded-xl border border-price-down/20 bg-price-down/8 px-3 py-2 text-[12px] text-price-down">
                    <span className="font-bold">{t.setupFailed}</span>{error}
                </div>
            ) : null}

            <button
                type="button"
                onClick={onApprove}
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-black text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                aria-label={t.approveActivateAria}
            >
                {submitting ? (
                    <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t.activating}
                    </>
                ) : (
                    <>
                        <CheckCircle2 className="h-4 w-4" />
                        {t.approveAndActivate}
                    </>
                )}
            </button>
        </div>
    );
}

// ─── Success state ───────────────────────────────────────────────────────────

function SuccessState({ signalName }: { signalName: string }) {
    const { copy } = useAppLocale();
    const t = copy.paperWizard;

    return (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="rounded-full border border-price-up/30 bg-price-up/10 p-4">
                <CheckCircle2 className="h-8 w-8 text-price-up" />
            </div>
            <div>
                <div className="text-sm font-black text-text-primary">{t.paperTradingActive}</div>
                <p className="mt-1 text-[12px] text-text-secondary">
                    {interpolateCopy(t.signalRunningPaper, { name: signalName })}
                    <br />
                    {t.monitorAutomation}
                </p>
            </div>
        </div>
    );
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

export default function StartPaperTradingWizard({
    signalCode,
    signalVersion,
    signalName,
    onClose,
    onSuccess,
}: WizardProps) {
    const [step, setStep] = useState<WizardStep>("account");
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [riskPercent, setRiskPercent] = useState(0.5);
    const [maxOpenPositions, setMaxOpenPositions] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [succeeded, setSucceeded] = useState(false);
    const overlayRef = useRef<HTMLDivElement>(null);
    const { copy } = useAppLocale();
    const t = copy.paperWizard;

    const STEP_IDS: WizardStep[] = ["account", "risk", "review"];

    const { accounts, status: accountsStatus } = useTradingAccounts({ enabled: true });
    const paperAccounts = accounts.filter((a) => a.accountMode === "PAPER");
    const accountsLoading = accountsStatus === "loading" || accountsStatus === "idle";

    // Auto-select the only paper account
    useEffect(() => {
        if (paperAccounts.length === 1 && !selectedAccountId) {
            setSelectedAccountId(paperAccounts[0].id);
        }
    }, [paperAccounts, selectedAccountId]);

    // Keyboard: Esc to close
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !submitting) onClose();
        };
        window.addEventListener("keydown", handleKey);
        return () => { window.removeEventListener("keydown", handleKey); };
    }, [onClose, submitting]);

    // Auto-close after success
    useEffect(() => {
        if (succeeded) {
            const timer = setTimeout(() => { onClose(); }, 2000);
            return () => { clearTimeout(timer); };
        }
    }, [succeeded, onClose]);

    const selectedAccount = paperAccounts.find((a) => a.id === selectedAccountId);

    const canAdvanceFromAccount = paperAccounts.length > 0 && Boolean(selectedAccountId);
    const currentStepIndex = STEP_IDS.indexOf(step);

    const handleNext = () => {
        if (step === "account" && canAdvanceFromAccount) setStep("risk");
        else if (step === "risk") setStep("review");
    };

    const handleBack = () => {
        if (step === "risk") setStep("account");
        else if (step === "review") setStep("risk");
    };

    const handleApprove = async () => {
        if (!selectedAccountId) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const result = await paperSetup(selectedAccountId, {
                signalCode,
                signalVersion,
                riskPercent,
                symbol: "XAUUSD",
                timeframe: "H1",
            });
            await activatePaperBinding(selectedAccountId, result.bindingId);
            setSucceeded(true);
            onSuccess?.(result);
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : "Setup failed. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        /* Overlay */
        <div
            ref={overlayRef}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={(e) => { if (e.target === overlayRef.current && !submitting) onClose(); }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wizard-title"
        >
            <div className="relative w-full max-w-[540px] rounded-2xl border border-border-muted bg-bg-primary shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border-muted px-5 py-4">
                    <div id="wizard-title" className="text-sm font-black text-text-primary">
                        {t.startPaperTrading}
                    </div>
                    {!succeeded ? <StepIndicator current={step} /> : null}
                    <button
                        type="button"
                        onClick={() => { if (!submitting) onClose(); }}
                        className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                        aria-label={t.closeWizard}
                        disabled={submitting}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="px-5 py-5">
                    {succeeded ? (
                        <SuccessState signalName={signalName} />
                    ) : step === "account" ? (
                        <AccountStep
                            paperAccounts={paperAccounts}
                            selectedId={selectedAccountId}
                            onSelect={setSelectedAccountId}
                            loading={accountsLoading}
                        />
                    ) : step === "risk" ? (
                        <RiskStep
                            riskPercent={riskPercent}
                            onRiskChange={setRiskPercent}
                            maxOpenPositions={maxOpenPositions}
                            onMaxPositionsChange={setMaxOpenPositions}
                        />
                    ) : (
                        <ReviewStep
                            signalName={signalName}
                            signalCode={signalCode}
                            signalVersion={signalVersion}
                            accountLabel={selectedAccount?.label ?? selectedAccountId ?? ""}
                            riskPercent={riskPercent}
                            maxOpenPositions={maxOpenPositions}
                            submitting={submitting}
                            error={submitError}
                            onApprove={handleApprove}
                        />
                    )}
                </div>

                {/* Footer — nav buttons (not shown on review step or success) */}
                {!succeeded && step !== "review" ? (
                    <div className="flex items-center justify-between border-t border-border-muted px-5 py-4">
                        <button
                            type="button"
                            onClick={handleBack}
                            disabled={currentStepIndex === 0}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <ChevronLeft className="h-3 w-3" />
                            {t.back}
                        </button>
                        <div className="text-[11px] text-text-muted">
                            {currentStepIndex + 1} of {STEP_IDS.length}
                        </div>
                        <button
                            type="button"
                            onClick={handleNext}
                            disabled={step === "account" && !canAdvanceFromAccount}
                            className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {t.next}
                            <ChevronRight className="h-3 w-3" />
                        </button>
                    </div>
                ) : null}

                {/* Back button on review step */}
                {!succeeded && step === "review" ? (
                    <div className="border-t border-border-muted px-5 py-3">
                        <button
                            type="button"
                            onClick={handleBack}
                            disabled={submitting}
                            className="text-xs font-bold text-text-muted transition-colors hover:text-text-primary disabled:opacity-40"
                        >
                            {t.backToRiskConfig}
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
