import { Suspense } from "react";
import AccessGate from "@/components/auth/AccessGate";
import ReportsWorkspace from "@/components/reports/ReportsWorkspace";

export default function ReportsPage() {
    return (
        <AccessGate requiredModules={["report", "engine"]}>
            <Suspense fallback={null}>
                <ReportsWorkspace />
            </Suspense>
        </AccessGate>
    );
}
