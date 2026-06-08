"use client";

import { useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useMarketStore } from "@/store/useMarketStore";
import { AVAILABLE_TIMEFRAMES } from "./workspaceContext";

function UrlSyncLogic() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const { symbol, timeframe, setSymbol, setTimeframe } = useMarketStore();
    const isFirstMount = useRef(true);
    const storeInitialized = useRef(false);

    // 1. On Initial Load: Read from URL and write to store (Deep linking)
    useEffect(() => {
        if (!storeInitialized.current) {
            const urlSymbol = searchParams.get("symbol");
            const urlTf = searchParams.get("tf");

            if (urlSymbol && urlSymbol !== symbol) {
                // Preserve original casing — DB stores MT5 contracts as e.g. BTCUSD
                setSymbol(urlSymbol);
            }

            // Guard against arbitrary ?tf= values — only accept known timeframes
            const validTf = AVAILABLE_TIMEFRAMES.includes(urlTf as (typeof AVAILABLE_TIMEFRAMES)[number])
                ? (urlTf as (typeof AVAILABLE_TIMEFRAMES)[number])
                : null;
            if (validTf && validTf !== timeframe) {
                setTimeframe(validTf);
            }

            // Only mark as initialized after the first pass is done.
            // If it had updates, the store state changes will trigger the next useEffect,
            // but we suppress the backward URL push on the very first mount via isFirstMount.
            storeInitialized.current = true;
        }
    }, [searchParams, symbol, timeframe, setSymbol, setTimeframe]);

    // 2. On Store Change: Write to URL 
    useEffect(() => {
        // Skip the initial mount so we don't overwrite valid incoming deep links
        // or trigger an unnecessary router.replace on default values.
        if (isFirstMount.current) {
            isFirstMount.current = false;
            return;
        }

        const currentUrlSymbol = searchParams.get("symbol");
        const currentUrlTf = searchParams.get("tf");

        // Only replace if values actually diverge, preventing an infinite loop
        if (currentUrlSymbol !== symbol || currentUrlTf !== timeframe) {
            const params = new URLSearchParams(searchParams.toString());
            params.set("symbol", symbol);
            params.set("tf", timeframe);

            // Use router.replace to change URL without polluting browser history
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }
    }, [symbol, timeframe, pathname, router, searchParams]);

    return null; // Logic-only component
}

export default function UrlSync() {
    return (
        <Suspense fallback={null}>
            <UrlSyncLogic />
        </Suspense>
    );
}
