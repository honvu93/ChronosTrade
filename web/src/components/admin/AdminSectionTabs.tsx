"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
    { href: "/admin/monitoring", label: "Monitoring" },
    { href: "/admin/indicator-catalog", label: "Indicator catalog" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/backtest-knowledge", label: "Backtest Knowledge" },
];

export default function AdminSectionTabs() {
    const pathname = usePathname();

    return (
        <nav className="mx-auto mb-4 flex w-full max-w-7xl flex-wrap gap-2 px-3 sm:px-4 lg:px-6">
            {tabs.map((tab) => {
                const active = pathname === tab.href;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition ${
                            active
                                ? "border-accent/28 bg-accent/12 text-text-primary shadow-[0_12px_28px_rgba(77,140,255,0.18)]"
                                : "border-border-muted bg-bg-tertiary/72 text-text-secondary hover:border-accent/18 hover:text-text-primary"
                        }`}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
