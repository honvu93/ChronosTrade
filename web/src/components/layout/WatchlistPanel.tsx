"use client";

import { useAppLocale } from "@/hooks/useAppLocale";
import Watchlist from "./Watchlist";

export default function WatchlistPanel() {
    const { copy } = useAppLocale();

    return (
        <section className="flex h-full flex-col p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-black uppercase tracking-[0.18em] text-text-secondary">
                        {copy.watchlist.title}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                        {copy.watchlist.description}
                    </p>
                </div>
            </div>
            <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border-muted pt-2">
                <Watchlist />
            </div>
        </section>
    );
}
