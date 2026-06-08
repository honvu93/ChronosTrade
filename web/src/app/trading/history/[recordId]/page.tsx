"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import AccessGate from "@/components/auth/AccessGate";
import TradeHistoryDetailPage from "@/components/trading/TradeHistoryDetailPage";

export default function TradingHistoryDetailPage() {
    const params = useParams();
    const recordId = typeof params.recordId === "string"
        ? params.recordId
        : Array.isArray(params.recordId)
            ? params.recordId[0]
            : "";

    return (
        <AccessGate requiredModules={["trading"]}>
            <Suspense fallback={null}>
                <TradeHistoryDetailPage recordId={recordId} />
            </Suspense>
        </AccessGate>
    );
}
