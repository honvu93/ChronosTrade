export type FactCardTone = "danger" | "success" | "accent" | "neutral";

const factTextToneStyles: Record<FactCardTone, string> = {
    danger: "text-price-down",
    success: "text-price-up",
    accent: "text-accent",
    neutral: "text-text-primary",
};

export default function FactCard({
    label,
    value,
    tone = "neutral",
}: {
    label: string;
    value: string;
    tone?: FactCardTone;
}) {
    return (
        <div className="rounded-2xl border border-border-muted bg-bg-primary/70 p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{label}</div>
            <div className={`mt-2 text-sm font-bold ${factTextToneStyles[tone]}`}>{value}</div>
        </div>
    );
}
