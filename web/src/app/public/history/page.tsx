import { Suspense } from "react";
import PublicTradeHistory from "@/components/public/PublicTradeHistory";

export const metadata = {
    title: "TradeHVV | Trade History",
    description: "Public trade history and performance metrics.",
};

export default function PublicHistoryPage() {
    return (
        <Suspense fallback={null}>
            <PublicTradeHistory />
        </Suspense>
    );
}
