import { AppLocale, DEFAULT_APP_LOCALE, toIntlLocale } from "./appLocale";

export function formatNumberForLocale(
    value: number,
    locale: AppLocale = DEFAULT_APP_LOCALE,
    options?: Intl.NumberFormatOptions,
): string {
    return new Intl.NumberFormat(toIntlLocale(locale), options).format(value);
}

export function formatDateTimeForLocale(
    value: string | number | Date | null | undefined,
    locale: AppLocale = DEFAULT_APP_LOCALE,
    options?: Intl.DateTimeFormatOptions,
    fallback = "n/a",
): string {
    if (!value) {
        return fallback;
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return fallback;
    }

    return new Intl.DateTimeFormat(toIntlLocale(locale), options).format(date);
}

export function formatPercentForLocale(
    value: number,
    locale: AppLocale = DEFAULT_APP_LOCALE,
    options?: Intl.NumberFormatOptions,
): string {
    return `${formatNumberForLocale(value, locale, options)}%`;
}

export function formatCompactNumberForLocale(
    value: number,
    locale: AppLocale = DEFAULT_APP_LOCALE,
    options?: Intl.NumberFormatOptions,
): string {
    return new Intl.NumberFormat(toIntlLocale(locale), {
        notation: "compact",
        maximumFractionDigits: 1,
        ...options,
    }).format(value);
}
