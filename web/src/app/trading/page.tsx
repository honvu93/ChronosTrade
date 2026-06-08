import AccessGate from "@/components/auth/AccessGate";
import TradingWorkspace from "@/components/trading/TradingWorkspace";

export default function TradingPage() {
    return (
        <AccessGate requiredModules={["trading"]}>
            <TradingWorkspace />
        </AccessGate>
    );
}
