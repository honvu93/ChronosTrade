"use client";

import type { AppLocale } from "../../lib/appLocale";

interface LanguageSwitchViewProps {
    locale: AppLocale;
    onLocaleChange: (locale: AppLocale) => void;
    label: string;
    englishLabel: string;
    vietnameseLabel: string;
    className?: string;
}

export default function LanguageSwitchView({
    locale,
    onLocaleChange,
    label,
    englishLabel,
    vietnameseLabel,
    className,
}: LanguageSwitchViewProps) {
    return (
        <div
            role="group"
            aria-label={label}
            className={`inline-flex items-center gap-1 rounded-full border border-border-muted bg-bg-primary/72 p-1 ${className ?? ""}`.trim()}
        >
            <span className="px-2 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">
                {label}
            </span>
            {([
                ["en", englishLabel],
                ["vi", vietnameseLabel],
            ] as const).map(([value, valueLabel]) => (
                <button
                    key={value}
                    type="button"
                    onClick={() => onLocaleChange(value)}
                    aria-pressed={locale === value}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] transition-colors ${
                        locale === value
                            ? "bg-accent text-bg-secondary"
                            : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                    }`}
                    title={valueLabel}
                >
                    {value}
                </button>
            ))}
        </div>
    );
}
