const STORAGE_PREFIX = "trading.workspace.selectedAccount";

function buildStorageKey(userId: string) {
    return `${STORAGE_PREFIX}:${userId}`;
}

export function readStoredTradingWorkspaceAccountId(
    userId: string | null | undefined,
    storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): string | null {
    if (!userId || !storage) {
        return null;
    }

    try {
        const value = storage.getItem(buildStorageKey(userId));
        return value?.trim() || null;
    } catch {
        return null;
    }
}

export function persistStoredTradingWorkspaceAccountId(
    userId: string | null | undefined,
    accountId: string,
    storage: Pick<Storage, "setItem"> | null = typeof window === "undefined" ? null : window.localStorage,
) {
    if (!userId || !storage) {
        return;
    }

    try {
        storage.setItem(buildStorageKey(userId), accountId);
    } catch {
        return;
    }
}

export function clearStoredTradingWorkspaceAccountId(
    userId: string | null | undefined,
    storage: Pick<Storage, "removeItem"> | null = typeof window === "undefined" ? null : window.localStorage,
) {
    if (!userId || !storage) {
        return;
    }

    try {
        storage.removeItem(buildStorageKey(userId));
    } catch {
        return;
    }
}
