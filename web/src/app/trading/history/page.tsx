import { Suspense } from "react";
import AccessGate from "@/components/auth/AccessGate";
import TradeHistoryStandalonePage from "@/components/trading/TradeHistoryStandalonePage";

export default function TradingHistoryPage() {
    return (
        <AccessGate requiredModules={["trading"]}>
            <Suspense fallback={null}>
                <TradeHistoryStandalonePage />
            </Suspense>
        </AccessGate>
    );
}
