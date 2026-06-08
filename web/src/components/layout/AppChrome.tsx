"use client";

import { usePathname } from "next/navigation";
import NotificationToaster from "@/components/layout/NotificationToaster";
import ModuleRail from "@/components/layout/ModuleRail";
import TopNav from "@/components/layout/TopNav";
import { useAuthSession } from "@/hooks/useAuthSession";

export default function AppChrome({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { isAuthenticated } = useAuthSession();
    const hideChrome = pathname === "/login" || pathname.startsWith("/public") || !isAuthenticated;

    return (
        <>
            {!hideChrome ? <NotificationToaster /> : null}
            {hideChrome ? (
                <div className="min-h-screen overflow-auto">{children}</div>
            ) : (
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        <TopNav />
                        <div className="flex min-h-0 flex-1 overflow-hidden">
                            <ModuleRail />
                            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
