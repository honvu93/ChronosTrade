"use client";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useTradingFeatureFlags } from "@/hooks/useTradingFeatureFlags";
import TradeHistoryAuditPanel from "@/components/trading/TradeHistoryAuditPanel";

export default function TradeHistoryStandalonePage() {
    const { isAuthenticated } = useAuthSession();
    const { snapshot: featureFlags } = useTradingFeatureFlags({ enabled: isAuthenticated });
    const readEnabled = Boolean(featureFlags?.capabilities.read.enabled);

    return (
        <div className="space-y-5">
            <div className="flex items-center gap-3">
                <Link
                    href="/trading?tab=overview"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs font-bold text-text-primary transition-colors hover:border-accent hover:text-accent"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Back to Trading
                </Link>
                <h1 className="text-sm font-black text-text-primary">Trade History & Audit</h1>
            </div>

            <Suspense fallback={null}>
                <TradeHistoryAuditPanel enabled={readEnabled} />
            </Suspense>
        </div>
    );
}
