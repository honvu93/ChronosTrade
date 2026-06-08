"use client";

import { useEffect } from "react";
import { useAppLocale } from "@/hooks/useAppLocale";

export default function LocaleEffects() {
    const { locale, intlLocale } = useAppLocale();

    useEffect(() => {
        document.documentElement.lang = locale;
        document.documentElement.dataset.locale = locale;
        document.documentElement.dataset.intlLocale = intlLocale;
    }, [intlLocale, locale]);

    return null;
}
