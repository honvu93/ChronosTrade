"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import AccessGate from "@/components/auth/AccessGate";
import BacktestDetailWorkspace from "@/components/signals/backtests/BacktestDetailWorkspace";

export default function SignalBacktestDetailPage() {
    const params = useParams();
    const runId = typeof params.runId === "string"
        ? params.runId
        : Array.isArray(params.runId)
            ? params.runId[0]
            : "";

    return (
        <AccessGate requiredModules={["signal", "report"]}>
            <Suspense fallback={null}>
                <BacktestDetailWorkspace runId={runId} />
            </Suspense>
        </AccessGate>
    );
}
