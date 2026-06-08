"use client";

import { useMemo } from "react";
import { getTranslationCatalog } from "@/lib/translations";
import { toIntlLocale } from "@/lib/appLocale";
import { useLocaleStore } from "@/store/useLocaleStore";

export function useAppLocale() {
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);

    const copy = useMemo(() => getTranslationCatalog(locale), [locale]);
    const intlLocale = useMemo(() => toIntlLocale(locale), [locale]);

    return {
        locale,
        intlLocale,
        copy,
        setLocale,
    };
}
