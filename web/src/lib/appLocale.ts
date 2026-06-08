export const APP_LOCALES = ["en", "vi"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "en";

const APP_INTL_LOCALE_MAP: Record<AppLocale, string> = {
    en: "en-US",
    vi: "vi-VN",
};

export function isAppLocale(value: unknown): value is AppLocale {
    return typeof value === "string" && APP_LOCALES.includes(value as AppLocale);
}

export function toIntlLocale(locale: AppLocale): string {
    return APP_INTL_LOCALE_MAP[locale];
}

export function resolveAppLocale(value: unknown): AppLocale {
    return isAppLocale(value) ? value : DEFAULT_APP_LOCALE;
}
