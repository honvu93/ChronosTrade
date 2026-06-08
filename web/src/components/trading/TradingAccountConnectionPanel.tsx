"use client";

import { useEffect, useMemo, useState } from "react";
import {
    AlertTriangle,
    Cable,
    CheckCircle2,
    KeyRound,
    Loader2,
    Pencil,
    Plus,
    RefreshCcw,
    ShieldAlert,
    Trash2,
} from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { listManagedUsers } from "@/lib/authApi";
import SectionCard from "@/components/ui/SectionCard";
import StateBanner from "@/components/ui/StateBanner";
import { useTradingAccounts } from "@/hooks/useTradingAccounts";
import { resolveTradingSetupSelectedAccountId } from "@/lib/tradingAccountSelection";
import { AuthSessionUser } from "@/types/auth";
import { useAppLocale } from "@/hooks/useAppLocale";
import { interpolateCopy, TranslationCatalog } from "@/lib/translations";

type AccountDraft = {
    label: string;
    accountMode: "LIVE" | "PAPER";
    mt5Login: string;
    mt5Password: string;
    mt5Server: string;
};

const emptyDraft: AccountDraft = {
    label: "",
    accountMode: "PAPER",
    mt5Login: "",
    mt5Password: "",
    mt5Server: "",
};

function collectIssues(draft: AccountDraft, hasExistingAccount: boolean, t: TranslationCatalog["tradingConnection"]) {
    const issues: string[] = [];

    if (!draft.label.trim()) {
        issues.push(t.accountLabelRequired);
    }

    if (!draft.mt5Login.trim()) {
        issues.push(t.mt5LoginRequired);
    }

    if (!draft.mt5Server.trim()) {
        issues.push(t.mt5ServerRequired);
    }

    if (!hasExistingAccount && !draft.mt5Password.trim()) {
        issues.push(t.mt5PasswordRequired);
    }

    return issues;
}

function toAccountDraft(account: {
    label: string;
    accountMode: "LIVE" | "PAPER";
    mt5Login: string | null;
    mt5Server: string | null;
}): AccountDraft {
    return {
        label: account.label,
        accountMode: account.accountMode,
        mt5Login: account.mt5Login ?? "",
        mt5Password: "",
        mt5Server: account.mt5Server ?? "",
    };
}

export default function TradingAccountConnectionPanel({
    readEnabled,
    refreshToken = 0,
    ownerUserId = undefined,
    onOwnerUserIdChange,
    selectedAccountId = undefined,
    onSelectedAccountChange,
    onAccountChanged,
}: {
    readEnabled: boolean;
    refreshToken?: number;
    ownerUserId?: string | null;
    onOwnerUserIdChange?: (ownerUserId: string | null) => void;
    selectedAccountId?: string | null;
    onSelectedAccountChange?: (accountId: string | null) => void;
    onAccountChanged?: () => void;
}) {
    const { user, isAdmin } = useAuthSession();
    const {
        status,
        accounts,
        activeAccount,
        activeAccountId,
        error,
        saving,
        deleting,
        selecting,
        refresh,
        saveAccount,
        removeAccount,
        selectAccount,
    } = useTradingAccounts({ refreshToken, ownerUserId });
    const [internalSelectedAccountId, setInternalSelectedAccountId] = useState<string | null>(selectedAccountId ?? null);
    const [draft, setDraft] = useState<AccountDraft>(emptyDraft);
    const [isCreatingNew, setIsCreatingNew] = useState(false);
    const [managedUsers, setManagedUsers] = useState<AuthSessionUser[]>([]);
    const [managedUsersError, setManagedUsersError] = useState<string | null>(null);
    const { copy } = useAppLocale();
    const t = copy.tradingConnection;

    const normalizedOwnerUserId = ownerUserId ?? user?.id ?? null;

    const effectiveSelectedAccountId = selectedAccountId !== undefined
        ? selectedAccountId
        : internalSelectedAccountId;
    const resolvedSelectedAccountId = resolveTradingSetupSelectedAccountId({
        accounts,
        activeAccountId,
        selectedAccountId: effectiveSelectedAccountId,
        isCreatingNew,
    });

    const selectedAccount = useMemo(() => (
        resolvedSelectedAccountId
            ? accounts.find((account) => account.id === resolvedSelectedAccountId) ?? null
            : null
    ), [accounts, resolvedSelectedAccountId]);

    useEffect(() => {
        if (!isAdmin) {
            return;
        }

        let active = true;

        void listManagedUsers()
            .then((rows) => {
                if (!active) {
                    return;
                }

                setManagedUsers(rows);
                setManagedUsersError(null);
            })
            .catch((loadError) => {
                if (!active) {
                    return;
                }

                setManagedUsers([]);
                setManagedUsersError(loadError instanceof Error ? loadError.message : t.unableToLoadUsers);
            });

        return () => {
            active = false;
        };
    }, [isAdmin, t.unableToLoadUsers]);

    const ownerOptions = useMemo(() => {
        const items = new Map<string, AuthSessionUser>();

        if (user) {
            items.set(user.id, user);
        }

        for (const managedUser of managedUsers) {
            items.set(managedUser.id, managedUser);
        }

        return [...items.values()].sort((left, right) => {
            if (left.id === user?.id) {
                return -1;
            }

            if (right.id === user?.id) {
                return 1;
            }

            const leftLabel = (left.displayName ?? left.username ?? left.email).toLowerCase();
            const rightLabel = (right.displayName ?? right.username ?? right.email).toLowerCase();
            return leftLabel.localeCompare(rightLabel);
        });
    }, [managedUsers, user]);

    const selectedOwner = useMemo(() => (
        ownerOptions.find((candidate) => candidate.id === normalizedOwnerUserId) ?? null
    ), [normalizedOwnerUserId, ownerOptions]);

    const issues = collectIssues(draft, Boolean(selectedAccount), t);
    const setSelectedId = (accountId: string | null) => {
        if (selectedAccountId === undefined) {
            setInternalSelectedAccountId(accountId);
        }
        onSelectedAccountChange?.(accountId);
    };
    const ownerScopeLabel = selectedOwner
        ? normalizedOwnerUserId === user?.id
            ? interpolateCopy(t.myAccounts, { name: "" }).replace(/\s*\(\)/, "")
            : `${selectedOwner.displayName ?? selectedOwner.username}`
        : "";
    const ownerAccountCountLabel = normalizedOwnerUserId === user?.id
        ? t.passwordKeepBlank.includes("blank") ? "saved for your current session" : ""
        : "";

    const helperText = issues[0]
        ?? (selectedAccount
            ? t.passwordKeepBlank
            : t.passwordEncrypted);
    const serverLooksDemo = /demo|practice|contest/i.test(draft.mt5Server);
    const modeMismatchWarning = draft.mt5Server.trim().length > 0
        ? (draft.accountMode === "LIVE" && serverLooksDemo
            ? t.serverDemoModeLive
            : draft.accountMode === "PAPER" && !serverLooksDemo && draft.mt5Server.trim().length > 2
                ? t.serverNotDemoModePaper
                : null)
        : null;
    const modeHelperText = draft.accountMode === "PAPER"
        ? t.paperModeHelper
        : t.liveModeHelper;

    const handleOwnerScopeChange = (nextOwnerUserId: string) => {
        onOwnerUserIdChange?.(nextOwnerUserId || null);
        setIsCreatingNew(false);
        setSelectedId(null);
        setDraft(emptyDraft);
    };

    return (
        <SectionCard
            title={t.mt5AccountSetup}
            description={t.manageAccounts}
            icon={<Cable className="h-5 w-5" />}
            headerAside={(
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => { void refresh(); }}
                        disabled={status === "loading"}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary disabled:cursor-wait disabled:opacity-60"
                    >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t.refresh}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setIsCreatingNew(true);
                            setSelectedId(null);
                            setDraft(emptyDraft);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-black text-bg-secondary"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        {t.addAccount}
                    </button>
                </div>
            )}
        >
            {!readEnabled ? (
                <StateBanner
                    tone="neutral"
                    title={t.connectionSetupAvailable}
                    icon={<ShieldAlert className="h-4 w-4" />}
                    message={t.mt5SetupReadNeeded}
                    className="rounded-2xl"
                />
            ) : null}

            {isAdmin ? (
                <div className="rounded-[24px] border border-border-muted bg-bg-tertiary/28 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">{t.accountOwnerScope}</div>
                            <div className="mt-1 text-sm font-black text-text-primary">
                                {t.adminDefaultsPersonal}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-text-secondary">
                                {t.chooseUserInspect}
                            </div>
                        </div>

                        <label className="block min-w-0 lg:w-[22rem]">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">{t.viewingAccountsFor}</div>
                            <select
                                value={normalizedOwnerUserId ?? ""}
                                onChange={(event) => handleOwnerScopeChange(event.target.value)}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-secondary px-4 text-sm text-text-primary outline-none transition focus:border-accent/30"
                            >
                                {ownerOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.id === user?.id
                                            ? interpolateCopy(t.myAccounts, { name: option.displayName ?? option.username ?? "" })
                                            : `${option.displayName ?? option.username} (${option.email})`}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {managedUsersError ? (
                        <div className="mt-3 text-xs text-price-down">{managedUsersError}</div>
                    ) : (
                        <div className="mt-3 text-xs text-text-secondary">
                            {t.currentScope} <span className="font-black text-text-primary">{ownerScopeLabel}</span>
                        </div>
                    )}
                </div>
            ) : null}

            {status === "loading" && accounts.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    {t.loadingSetup}
                </div>
            ) : null}

            {error ? (
                <StateBanner
                    tone="caution"
                    title={t.requestFailed}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    message={error}
                    className="rounded-2xl"
                />
            ) : null}

            <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
                <div className="space-y-3">
                    <div className="rounded-[28px] border border-border-muted bg-bg-tertiary/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">{t.savedAccounts}</div>
                                <div className="mt-1 text-sm text-text-secondary">
                                    {interpolateCopy(t.accountCount, { count: accounts.length, scope: ownerAccountCountLabel })}
                                </div>
                            </div>
                            {activeAccount ? (
                                <span className="rounded-full border border-price-up/30 bg-price-up/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-price-up">
                                    {interpolateCopy(t.active, { label: activeAccount.label })}
                                </span>
                            ) : null}
                        </div>

                        <div className="mt-4 space-y-3">
                            {accounts.map((account) => {
                                const isSelected = selectedAccount?.id === account.id && !isCreatingNew;
                                return (
                                    <button
                                        key={account.id}
                                        type="button"
                                        onClick={() => {
                                            setIsCreatingNew(false);
                                            setSelectedId(account.id);
                                            setDraft(toAccountDraft(account));
                                        }}
                                        className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                                            isSelected
                                                ? "border-accent/30 bg-accent/8"
                                                : "border-border-muted bg-bg-secondary/60 hover:border-accent/20"
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-black text-text-primary">{account.label}</div>
                                            <div className="mt-1 text-xs text-text-secondary">
                                                {account.mt5Login ?? "No login"} / {account.mt5Server ?? "No server"}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-1">
                                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                                                account.accountMode === "PAPER"
                                                    ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                                                    : "border-price-down/25 bg-price-down/10 text-price-down"
                                            }`}>
                                                {account.accountMode === "PAPER" ? "Paper" : "Live"}
                                            </span>
                                            {account.isActive ? (
                                                <span className="rounded-full border border-price-up/30 bg-price-up/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-price-up">
                                                    Active
                                                    </span>
                                                ) : null}
                                                <span className="rounded-full border border-border-muted bg-bg-tertiary px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">
                                                    {account.status}
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}

                            {accounts.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-border-muted bg-bg-tertiary/15 px-4 py-5 text-sm text-text-secondary">
                                    {interpolateCopy(t.noAccountSaved, { scope: normalizedOwnerUserId === user?.id ? "this scope" : "the selected user" })}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="space-y-4 rounded-[28px] border border-border-muted bg-bg-tertiary/30 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">
                                {isCreatingNew ? t.createNewAccount : t.selectedAccount}
                            </div>
                            <div className="mt-1 text-lg font-black text-text-primary">
                                {isCreatingNew ? t.newMt5Account : selectedAccount?.label ?? t.chooseAnAccount}
                            </div>
                            <div className="mt-1 text-sm text-text-secondary">
                                {isCreatingNew
                                    ? t.addAnotherAccount
                                    : selectedAccount
                                        ? t.editSelectedAccount
                                        : t.selectOrAdd}
                            </div>
                        </div>
                        {!isCreatingNew && selectedAccount ? (
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsCreatingNew(false);
                                        setDraft(toAccountDraft(selectedAccount));
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-2 text-xs font-black text-text-primary"
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                    {t.edit}
                                </button>
                                <button
                                    type="button"
                                    disabled={selectedAccount.isActive || selecting}
                                    onClick={() => {
                                        void selectAccount(selectedAccount.id)
                                            .then(() => {
                                                onAccountChanged?.();
                                            })
                                            .catch(() => { });
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full border border-price-up/30 bg-price-up/10 px-3 py-2 text-xs font-black text-price-up disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {selecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                    {selectedAccount.isActive ? t.currentlyActive : t.setActive}
                                </button>
                                <button
                                    type="button"
                                    disabled={deleting}
                                    onClick={() => {
                                        void removeAccount(selectedAccount.id)
                                            .then(() => {
                                                setIsCreatingNew(false);
                                                setSelectedId(null);
                                                setDraft(emptyDraft);
                                                onAccountChanged?.();
                                            })
                                            .catch(() => { });
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full border border-price-down/30 bg-price-down/10 px-3 py-2 text-xs font-black text-price-down disabled:cursor-wait disabled:opacity-60"
                                >
                                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                    {t.delete}
                                </button>
                            </div>
                        ) : null}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">{t.accountLabel}</div>
                            <input
                                value={draft.label}
                                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm"
                                placeholder="Primary MT5"
                            />
                        </label>

                        <div className="block md:col-span-2">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">{t.tradingMode}</div>
                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={() => setDraft((current) => ({ ...current, accountMode: "PAPER" }))}
                                    className={`rounded-2xl border px-4 py-3 text-left ${
                                        draft.accountMode === "PAPER"
                                            ? "border-accent/30 bg-accent/10"
                                            : "border-border-muted bg-bg-secondary/60"
                                    }`}
                                >
                                    <div className="text-sm font-black text-text-primary">{t.paperDemo}</div>
                                    <div className="mt-1 text-xs text-text-secondary">
                                        {t.paperDemoDescription}
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDraft((current) => ({ ...current, accountMode: "LIVE" }))}
                                    className={`rounded-2xl border px-4 py-3 text-left ${
                                        draft.accountMode === "LIVE"
                                            ? "border-price-down/30 bg-price-down/10"
                                            : "border-border-muted bg-bg-secondary/60"
                                    }`}
                                >
                                    <div className="text-sm font-black text-text-primary">{t.live}</div>
                                    <div className="mt-1 text-xs text-text-secondary">
                                        {t.liveDescription}
                                    </div>
                                </button>
                            </div>
                            <div className="mt-2 rounded-2xl border border-border-muted bg-bg-secondary/60 px-4 py-3 text-xs text-text-secondary">
                                {modeHelperText}
                            </div>
                            {modeMismatchWarning ? (
                                <div className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    {modeMismatchWarning}
                                </div>
                            ) : null}
                        </div>

                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">{t.mt5Login}</div>
                            <input
                                value={draft.mt5Login}
                                onChange={(event) => setDraft((current) => ({ ...current, mt5Login: event.target.value }))}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm"
                                placeholder="10001"
                            />
                        </label>

                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">{t.mt5Server}</div>
                            <input
                                value={draft.mt5Server}
                                onChange={(event) => setDraft((current) => ({ ...current, mt5Server: event.target.value }))}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm"
                                placeholder="Broker-Demo"
                            />
                        </label>

                        <label className="block">
                            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-text-muted">
                                <KeyRound className="h-3.5 w-3.5" />
                                {t.mt5Password}
                            </div>
                            <input
                                type="password"
                                value={draft.mt5Password}
                                onChange={(event) => setDraft((current) => ({ ...current, mt5Password: event.target.value }))}
                                className="mt-2 h-11 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm"
                                placeholder={selectedAccount ? "Leave blank to keep saved password" : "Enter MT5 password"}
                            />
                        </label>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            disabled={saving || issues.length > 0}
                            onClick={() => {
                                void saveAccount(
                                    {
                                        ownerUserId: normalizedOwnerUserId,
                                        label: draft.label,
                                        accountMode: draft.accountMode,
                                        mt5Login: draft.mt5Login,
                                        mt5Password: draft.mt5Password.trim() ? draft.mt5Password : null,
                                        mt5Server: draft.mt5Server,
                                    },
                                    { accountId: isCreatingNew ? null : selectedAccount?.id ?? null },
                                ).then((saved) => {
                                    setIsCreatingNew(false);
                                    setSelectedId(saved.id);
                                    setDraft(toAccountDraft(saved));
                                    onAccountChanged?.();
                                }).catch(() => { });
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-black text-bg-secondary disabled:cursor-wait disabled:opacity-70"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cable className="h-4 w-4" />}
                            {isCreatingNew ? t.saveNewAccount : selectedAccount ? t.saveAccountChanges : t.createAccount}
                        </button>

                        {isCreatingNew ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCreatingNew(false);
                                    const fallbackAccount = activeAccount ?? accounts[0] ?? null;
                                    setSelectedId(fallbackAccount?.id ?? null);
                                    setDraft(fallbackAccount
                                        ? toAccountDraft(fallbackAccount)
                                        : emptyDraft);
                                }}
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-4 py-2.5 text-sm font-black text-text-primary"
                            >
                                {t.cancelNewAccount}
                            </button>
                        ) : null}
                    </div>

                    <div className="rounded-2xl border border-border-muted bg-bg-secondary/60 px-4 py-3 text-xs text-text-secondary">
                        {helperText}
                    </div>
                </div>
            </div>
        </SectionCard>
    );
}
