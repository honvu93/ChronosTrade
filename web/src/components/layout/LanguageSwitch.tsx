"use client";

import { useAppLocale } from "@/hooks/useAppLocale";
import LanguageSwitchView from "./LanguageSwitchView";

export { default as LanguageSwitchView } from "./LanguageSwitchView";

export default function LanguageSwitch({ className }: { className?: string }) {
    const { locale, setLocale, copy } = useAppLocale();

    return (
        <LanguageSwitchView
            locale={locale}
            onLocaleChange={setLocale}
            label={copy.common.language}
            englishLabel={copy.common.english}
            vietnameseLabel={copy.common.vietnamese}
            className={className}
        />
    );
}
