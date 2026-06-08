import { TradingAccountSummary } from "@/types/trading";

export function resolveActiveTradingAccount(
    accounts: TradingAccountSummary[],
    activeAccountId: string | null,
): TradingAccountSummary | null {
    if (activeAccountId) {
        const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
        if (activeAccount) {
            return activeAccount;
        }
    }

    return accounts.find((account) => account.isActive) ?? accounts[0] ?? null;
}

export function resolveTradingSetupSelectedAccountId({
    accounts,
    activeAccountId,
    selectedAccountId,
    isCreatingNew,
}: {
    accounts: TradingAccountSummary[];
    activeAccountId: string | null;
    selectedAccountId: string | null;
    isCreatingNew: boolean;
}): string | null {
    if (isCreatingNew) {
        return null;
    }

    if (selectedAccountId && accounts.some((account) => account.id === selectedAccountId)) {
        return selectedAccountId;
    }

    return resolveActiveTradingAccount(accounts, activeAccountId)?.id ?? null;
}
