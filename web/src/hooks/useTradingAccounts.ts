"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    createTradingAccount,
    deleteTradingAccount,
    listTradingAccounts,
    selectTradingAccount,
    updateTradingAccount,
} from "@/lib/tradingAccountApi";
import { resolveActiveTradingAccount } from "@/lib/tradingAccountSelection";
import { TradingAccountMutationInput, TradingAccountSummary } from "@/types/trading";

type HookStatus = "idle" | "loading" | "ready" | "error";

export interface UseTradingAccountsResult {
    status: HookStatus;
    accounts: TradingAccountSummary[];
    account: TradingAccountSummary | null;
    activeAccount: TradingAccountSummary | null;
    activeAccountId: string | null;
    error: string | null;
    saving: boolean;
    deleting: boolean;
    selecting: boolean;
    refresh: () => Promise<void>;
    saveAccount: (
        input: TradingAccountMutationInput,
        options?: { accountId?: string | null },
    ) => Promise<TradingAccountSummary>;
    removeAccount: (accountId: string) => Promise<void>;
    selectAccount: (accountId: string) => Promise<void>;
}

export function useTradingAccounts(
    {
        enabled = true,
        refreshToken = 0,
        ownerUserId,
    }: {
        enabled?: boolean;
        refreshToken?: number;
        ownerUserId?: string | null;
    } = {},
): UseTradingAccountsResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [accounts, setAccounts] = useState<TradingAccountSummary[]>([]);
    const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [selecting, setSelecting] = useState(false);
    const activeRef = useRef(true);

    const load = useCallback(async () => {
        if (!enabled) {
            if (activeRef.current) {
                setAccounts([]);
                setActiveAccountId(null);
                setStatus("idle");
                setError(null);
            }
            return;
        }

        setStatus("loading");
        setError(null);

        try {
            const result = await listTradingAccounts({ ownerUserId });
            if (!activeRef.current) {
                return;
            }

            setAccounts(result.accounts);
            setActiveAccountId(result.activeAccountId);
            setStatus("ready");
        } catch (loadError) {
            if (!activeRef.current) {
                return;
            }

            setError(loadError instanceof Error ? loadError.message : "Unable to load MT5 account settings.");
            setStatus("error");
        }
    }, [enabled, ownerUserId]);

    useEffect(() => {
        activeRef.current = true;
        void load();
        return () => {
            activeRef.current = false;
        };
    }, [load, refreshToken]);

    const refresh = useCallback(async () => {
        await load();
    }, [load]);

    const saveAccount = useCallback(async (
        input: TradingAccountMutationInput,
        options?: { accountId?: string | null },
    ) => {
        setSaving(true);
        setError(null);

        try {
            const saved = options?.accountId
                ? await updateTradingAccount(options.accountId, input, { ownerUserId })
                : await createTradingAccount(input);

            if (activeRef.current) {
                await load();
            }

            return saved;
        } catch (saveError) {
            if (activeRef.current) {
                setError(saveError instanceof Error ? saveError.message : "Unable to save the MT5 account.");
            }
            throw saveError;
        } finally {
            if (activeRef.current) {
                setSaving(false);
            }
        }
    }, [load, ownerUserId]);

    const removeAccount = useCallback(async (accountId: string) => {
        setDeleting(true);
        setError(null);

        try {
            const result = await deleteTradingAccount(accountId, { ownerUserId });
            if (activeRef.current) {
                setActiveAccountId(result.activeAccountId);
                await load();
            }
        } catch (deleteError) {
            if (activeRef.current) {
                setError(deleteError instanceof Error ? deleteError.message : "Unable to delete the MT5 account.");
            }
            throw deleteError;
        } finally {
            if (activeRef.current) {
                setDeleting(false);
            }
        }
    }, [load, ownerUserId]);

    const selectAccount = useCallback(async (accountId: string) => {
        setSelecting(true);
        setError(null);

        try {
            const result = await selectTradingAccount(accountId, { ownerUserId });
            if (activeRef.current) {
                setActiveAccountId(result.activeAccountId);
                await load();
            }
        } catch (selectError) {
            if (activeRef.current) {
                setError(selectError instanceof Error ? selectError.message : "Unable to switch the MT5 account.");
            }
            throw selectError;
        } finally {
            if (activeRef.current) {
                setSelecting(false);
            }
        }
    }, [load, ownerUserId]);

    const activeAccount = useMemo(
        () => resolveActiveTradingAccount(accounts, activeAccountId),
        [accounts, activeAccountId],
    );

    return {
        status,
        accounts,
        account: activeAccount,
        activeAccount,
        activeAccountId: activeAccount?.id ?? activeAccountId,
        error,
        saving,
        deleting,
        selecting,
        refresh,
        saveAccount,
        removeAccount,
        selectAccount,
    };
}
