import { ReactNode } from "react";
import { clsx } from "clsx";

type MetricCardSize = "large" | "medium" | "compact";

export default function MetricCard({
    label,
    value,
    hint,
    accentClassName = "text-text-primary",
    accent,
    tone,
    size = "medium",
    className,
    valueClassName,
}: {
    label: ReactNode;
    value: ReactNode;
    hint?: ReactNode;
    accentClassName?: string;
    accent?: string;
    tone?: string;
    size?: MetricCardSize;
    className?: string;
    valueClassName?: string;
}) {
    const resolvedAccentClassName = accentClassName !== "text-text-primary"
        ? accentClassName
        : accent ?? tone ?? accentClassName;
    const sizeStyles = {
        large: {
            wrapper: "rounded-xl border border-border-muted bg-bg-tertiary/50 px-4 py-3",
            label: "text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted",
            value: "mt-1.5 text-2xl font-black font-mono tabular-nums",
            hint: "mt-1 text-[11px] text-text-muted",
        },
        medium: {
            wrapper: "rounded-xl border border-border-muted bg-bg-tertiary/40 px-3 py-2.5",
            label: "text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted",
            value: "mt-1 text-lg font-black font-mono tabular-nums",
            hint: "mt-0.5 text-[11px] text-text-muted",
        },
        compact: {
            wrapper: "rounded-lg border border-border-muted bg-bg-primary/60 px-3 py-2",
            label: "text-[9px] font-bold uppercase tracking-[0.18em] text-text-muted",
            value: "mt-1 text-sm font-bold font-mono tabular-nums",
            hint: "mt-0.5 text-[10px] text-text-muted",
        },
    } as const;

    const styles = sizeStyles[size];

    return (
        <div className={clsx(styles.wrapper, className)}>
            <div className={styles.label}>{label}</div>
            <div className={clsx(styles.value, resolvedAccentClassName, valueClassName)}>{value}</div>
            {hint ? <div className={styles.hint}>{hint}</div> : null}
        </div>
    );
}
