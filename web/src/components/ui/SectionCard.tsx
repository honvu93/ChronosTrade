import { ReactNode } from "react";
import { clsx } from "clsx";

type SectionCardVariant = "command" | "compact";

export default function SectionCard({
    title,
    description,
    icon,
    headerAside,
    children,
    variant = "command",
    className,
    contentClassName,
    iconContainerClassName,
}: {
    title: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    headerAside?: ReactNode;
    children: ReactNode;
    variant?: SectionCardVariant;
    className?: string;
    contentClassName?: string;
    iconContainerClassName?: string;
}) {
    const isCompact = variant === "compact";

    return (
        <section
            className={clsx(
                "border border-border-muted",
                isCompact
                    ? "rounded-lg bg-bg-primary/60 p-3"
                    : "rounded-xl bg-bg-primary/90 p-4",
                className,
            )}
        >
            <div className={clsx("flex gap-3", headerAside ? "justify-between" : "", isCompact ? "items-start" : "items-start")}>
                <div className="flex min-w-0 items-start gap-3">
                    {icon ? (
                        <div
                            className={clsx(
                                "shrink-0",
                                isCompact
                                    ? "rounded-md border border-border-muted bg-bg-secondary/70 p-1.5 text-text-secondary"
                                    : "flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent",
                                iconContainerClassName,
                            )}
                        >
                            {icon}
                        </div>
                    ) : null}
                    <h2
                        className={clsx(
                            "text-text-primary",
                            isCompact
                                ? "text-[11px] font-bold uppercase tracking-[0.18em]"
                                : "text-sm font-bold tracking-tight",
                        )}
                    >
                        {title}
                    </h2>
                </div>
                {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
            </div>

            <div className={clsx(isCompact ? "mt-3 space-y-3" : "mt-4", contentClassName)}>
                {children}
            </div>
        </section>
    );
}
