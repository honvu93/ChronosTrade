export const AUTH_TOKEN_STORAGE_KEYS = [
    "tvgit.accessToken",
    "accessToken",
    "authToken",
] as const;

export type AuthTokenStorageSnapshot = Partial<Record<(typeof AUTH_TOKEN_STORAGE_KEYS)[number], string | null>>;

export function getStoredAuthToken(
    storage: AuthTokenStorageSnapshot = {},
): string | null {
    for (const key of AUTH_TOKEN_STORAGE_KEYS) {
        const value = storage[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }

    return null;
}
