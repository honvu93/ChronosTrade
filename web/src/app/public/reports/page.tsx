import { Suspense } from "react";
import PublicReports from "@/components/public/PublicReports";

export const metadata = {
    title: "TradeHVV | Reports",
    description: "Public trading performance reports and analytics.",
};

export default function PublicReportsPage() {
    return (
        <Suspense fallback={null}>
            <PublicReports />
        </Suspense>
    );
}
