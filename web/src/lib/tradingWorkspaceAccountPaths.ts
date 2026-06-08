export function buildScopedTradingWorkspaceAccountPath(
    accountId: string,
    suffix = "",
    ownerUserId?: string | null,
) {
    const path = `/api/trading/accounts/${encodeURIComponent(accountId)}${suffix}`;
    if (!ownerUserId) {
        return path;
    }

    const params = new URLSearchParams({ userId: ownerUserId });
    return `${path}?${params.toString()}`;
}
