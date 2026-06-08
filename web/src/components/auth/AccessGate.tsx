"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Lock, Loader2, ShieldAlert } from "lucide-react";
import { moduleLabels } from "@/lib/authAccess";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useAppLocale } from "@/hooks/useAppLocale";
import { interpolateCopy } from "@/lib/translations";
import { AuthModuleKey } from "@/types/auth";

function FullScreenState({
    icon,
    title,
    message,
    cta,
}: {
    icon: React.ReactNode;
    title: string;
    message: string;
    cta?: React.ReactNode;
}) {
    const { copy } = useAppLocale();
    return (
        <div className="command-deck-canvas flex min-h-screen items-center justify-center px-6 py-10 text-text-primary">
            <section className="w-full max-w-2xl rounded-[32px] border border-border-muted bg-bg-primary/92 p-8 shadow-[0_28px_90px_rgba(0,0,0,0.28)]">
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-accent">
                    {icon}
                    {copy.accessGate.accessControl}
                </div>
                <h1 className="mt-4 text-3xl font-black tracking-tight">{title}</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-text-secondary">{message}</p>
                {cta ? <div className="mt-6 flex flex-wrap gap-3">{cta}</div> : null}
            </section>
        </div>
    );
}

export default function AccessGate({
    children,
    requiredModules,
    requireAdmin = false,
}: {
    children: React.ReactNode;
    requiredModules?: AuthModuleKey[];
    requireAdmin?: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const { status, session, isAuthenticated, isAdmin, hasAnyModule } = useAuthSession();
    const { copy } = useAppLocale();

    useEffect(() => {
        if (status !== "anonymous") {
            return;
        }

        const query = typeof window === "undefined" ? "" : window.location.search.slice(1);
        const nextPath = `${pathname}${query ? `?${query}` : ""}`;
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
    }, [pathname, router, status]);

    if (status === "loading") {
        return (
            <FullScreenState
                icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
                title={copy.accessGate.restoringSession}
                message={copy.accessGate.validatingSession}
            />
        );
    }

    if (!isAuthenticated || !session) {
        return (
            <FullScreenState
                icon={<Lock className="h-3.5 w-3.5" />}
                title={copy.accessGate.redirectingToSignIn}
                message={copy.accessGate.redirectingMessage}
            />
        );
    }

    if (requireAdmin && !isAdmin) {
        return (
            <FullScreenState
                icon={<ShieldAlert className="h-3.5 w-3.5" />}
                title={copy.accessGate.adminAccessRequired}
                message={copy.accessGate.adminAccessRequiredMessage}
                cta={session.firstAllowedPath ? (
                    <Link
                        href={session.firstAllowedPath}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                    >
                        {copy.accessGate.openAllowedWorkspace}
                    </Link>
                ) : null}
            />
        );
    }

    if (requiredModules && requiredModules.length > 0 && !isAdmin && !hasAnyModule(requiredModules)) {
        const requiredLabels = requiredModules.map((moduleKey) => moduleLabels[moduleKey]).join(" or ");
        return (
            <FullScreenState
                icon={<ShieldAlert className="h-3.5 w-3.5" />}
                title={interpolateCopy(copy.accessGate.moduleAccessNotEnabled, { modules: requiredLabels })}
                message={interpolateCopy(copy.accessGate.moduleGatedMessage, { modules: requiredLabels })}
                cta={session.firstAllowedPath ? (
                    <Link
                        href={session.firstAllowedPath}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-black text-bg-secondary"
                    >
                        {copy.accessGate.openAllowedWorkspace}
                    </Link>
                ) : null}
            />
        );
    }

    return <>{children}</>;
}
