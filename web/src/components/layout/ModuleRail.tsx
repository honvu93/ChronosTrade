"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Activity,
    BookOpen,
    CandlestickChart,
    Cpu,
    FileSpreadsheet,
    Shield,
    Sigma,
    Users,
} from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import {
    buildPrimaryNavigation,
    isNavigationItemActive,
    type PrimaryNavigationKey,
} from "./navigationModel";
import { useAppLocale } from "@/hooks/useAppLocale";

const navIcons: Record<PrimaryNavigationKey, typeof CandlestickChart> = {
    chart: CandlestickChart,
    signal: Sigma,
    report: FileSpreadsheet,
    trading: Shield,
    engine: Cpu,
    indicators: Activity,
    admin: Users,
    docs: BookOpen,
};

export default function ModuleRail() {
    const pathname = usePathname();
    const { user } = useAuthSession();
    const { locale } = useAppLocale();

    if (!user) {
        return null;
    }

    const items = buildPrimaryNavigation(user, locale);

    return (
        <aside className="hidden w-[104px] shrink-0 border-r border-border-muted/80 bg-bg-secondary/76 px-3 py-4 backdrop-blur-xl lg:flex lg:flex-col">
            <nav className="flex flex-1 flex-col gap-2">
                {items.map((item) => {
                    const Icon = navIcons[item.key];
                    const active = isNavigationItemActive(pathname, item.key);

                    return (
                        <Link
                            key={item.key}
                            href={item.href}
                            className={`flex flex-col items-center gap-2 rounded-[22px] border px-2 py-3 text-center transition ${
                                active
                                    ? "border-accent/30 bg-accent/10 text-text-primary shadow-[0_10px_28px_rgba(77,140,255,0.12)]"
                                    : "border-transparent bg-transparent text-text-secondary hover:border-border-muted hover:bg-bg-primary/55 hover:text-text-primary"
                            }`}
                        >
                            <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${
                                active ? "bg-accent/14 text-accent" : "bg-bg-primary/70 text-text-muted"
                            }`}>
                                <Icon className="h-4 w-4" />
                            </div>
                            <span className="text-[11px] font-black tracking-[0.08em]">{item.label}</span>
                        </Link>
                    );
                })}
            </nav>
        </aside>
    );
}
