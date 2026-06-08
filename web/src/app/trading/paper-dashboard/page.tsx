import AccessGate from "@/components/auth/AccessGate";
import PaperDashboard from "@/components/trading/PaperDashboard";

export default function PaperDashboardPage() {
    return (
        <AccessGate requiredModules={["trading"]}>
            <PaperDashboard />
        </AccessGate>
    );
}
