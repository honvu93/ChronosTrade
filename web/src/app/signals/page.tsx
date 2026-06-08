import { Suspense } from "react";
import AccessGate from "@/components/auth/AccessGate";
import SignalsWorkspace from "@/components/signals/SignalsWorkspace";

export default function SignalsPage() {
    return (
        <AccessGate requiredModules={["signal"]}>
            <Suspense fallback={null}>
                <SignalsWorkspace />
            </Suspense>
        </AccessGate>
    );
}
