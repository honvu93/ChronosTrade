import { ReactNode } from "react";
import { clsx } from "clsx";

type StateBannerTone = "success" | "caution" | "danger" | "info" | "neutral";
type StateBannerSize = "default" | "compact";

const toneStyles: Record<StateBannerTone, string> = {
    success: "border-price-up/25 bg-price-up/10 text-price-up",
    caution: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    danger: "border-price-down/25 bg-price-down/10 text-price-down",
    info: "border-accent/25 bg-accent/10 text-accent",
    neutral: "border-border-muted bg-bg-tertiary/45 text-text-secondary",
};

export default function StateBanner({
    tone,
    title,
    message,
    icon,
    action,
    size = "default",
    className,
}: {
    tone: StateBannerTone;
    title?: ReactNode;
    message: ReactNode;
    icon?: ReactNode;
    action?: ReactNode;
    size?: StateBannerSize;
    className?: string;
}) {
    return (
        <section
            className={clsx(
                "rounded-lg border",
                size === "compact" ? "px-3 py-2 text-xs" : "px-4 py-3",
                toneStyles[tone],
                className,
            )}
        >
            {title || icon ? (
                <div className={clsx("flex items-center gap-2", size === "compact" ? "text-[10px] font-bold uppercase tracking-[0.18em]" : "text-xs font-black uppercase tracking-[0.18em]")}>
                    {icon}
                    {title}
                </div>
            ) : null}
            <div className={clsx(title || icon ? "mt-1" : "", size === "compact" ? "text-xs leading-5" : "text-sm leading-5")}>
                {message}
            </div>
            {action ? <div className="mt-3">{action}</div> : null}
        </section>
    );
}
