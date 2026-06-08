import { Suspense } from "react";
import AccessGate from "@/components/auth/AccessGate";
import PortfolioBacktestWorkspace from "@/components/reports/PortfolioBacktestWorkspace";

export default function PortfolioPage() {
    return (
        <AccessGate requiredModules={["report", "engine"]}>
            <Suspense fallback={null}>
                <PortfolioBacktestWorkspace />
            </Suspense>
        </AccessGate>
    );
}
