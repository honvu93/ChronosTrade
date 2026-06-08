import {
    AUTH_TOKEN_STORAGE_KEYS,
    AuthTokenStorageSnapshot,
    getStoredAuthToken,
} from "./authTokenStorage";

const readStorageValue = (
    storage: Pick<Storage, "getItem"> | null,
    key: (typeof AUTH_TOKEN_STORAGE_KEYS)[number],
) => {
    if (!storage) {
        return null;
    }

    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
};

export const readStoredAuthSnapshot = (
    storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): AuthTokenStorageSnapshot => AUTH_TOKEN_STORAGE_KEYS.reduce((result, key) => {
    result[key] = readStorageValue(storage, key);
    return result;
}, {} as AuthTokenStorageSnapshot);

export const readStoredAuthAccessToken = (
    storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage,
) => getStoredAuthToken(readStoredAuthSnapshot(storage));

export const persistStoredAuthAccessToken = (
    token: string,
    storage: Pick<Storage, "setItem"> | null = typeof window === "undefined" ? null : window.localStorage,
) => {
    if (!storage) {
        return;
    }

    for (const key of AUTH_TOKEN_STORAGE_KEYS) {
        try {
            storage.setItem(key, token);
        } catch {
            return;
        }
    }
};

export const clearStoredAuthAccessToken = (
    storage: Pick<Storage, "removeItem"> | null = typeof window === "undefined" ? null : window.localStorage,
) => {
    if (!storage) {
        return;
    }

    for (const key of AUTH_TOKEN_STORAGE_KEYS) {
        try {
            storage.removeItem(key);
        } catch {
            return;
        }
    }
};
