import { AppLocale, DEFAULT_APP_LOCALE, isAppLocale } from "./appLocale";

export const APP_LOCALE_STORAGE_KEY = "tvgit.app.locale";

function readLocaleCandidate(value: string | null): AppLocale {
    if (isAppLocale(value)) {
        return value;
    }

    if (!value) {
        return DEFAULT_APP_LOCALE;
    }

    try {
        const parsed = JSON.parse(value) as { state?: { locale?: unknown } } | null;
        return isAppLocale(parsed?.state?.locale) ? parsed.state.locale : DEFAULT_APP_LOCALE;
    } catch {
        return DEFAULT_APP_LOCALE;
    }
}

function serializePersistedAppLocale(locale: AppLocale): string {
    return JSON.stringify({
        state: { locale },
        version: 0,
    });
}

export function readStoredAppLocale(
    storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): AppLocale {
    if (!storage) {
        return DEFAULT_APP_LOCALE;
    }

    try {
        return readLocaleCandidate(storage.getItem(APP_LOCALE_STORAGE_KEY));
    } catch {
        return DEFAULT_APP_LOCALE;
    }
}

export function persistStoredAppLocale(
    locale: AppLocale,
    storage: Pick<Storage, "setItem"> | null = typeof window === "undefined" ? null : window.localStorage,
) {
    if (!storage) {
        return;
    }

    try {
        storage.setItem(APP_LOCALE_STORAGE_KEY, serializePersistedAppLocale(locale));
    } catch {
        return;
    }
}

export function clearStoredAppLocale(
    storage: Pick<Storage, "removeItem"> | null = typeof window === "undefined" ? null : window.localStorage,
) {
    if (!storage) {
        return;
    }

    try {
        storage.removeItem(APP_LOCALE_STORAGE_KEY);
    } catch {
        return;
    }
}
