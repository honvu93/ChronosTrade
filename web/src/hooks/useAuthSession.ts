"use client";

import { useMemo } from "react";
import { hasAnyModuleAccess, hasModuleAccess } from "@/lib/authAccess";
import { useAuthStore } from "@/store/useAuthStore";
import { AuthModuleKey } from "@/types/auth";

export function useAuthSession() {
    const status = useAuthStore((state) => state.status);
    const session = useAuthStore((state) => state.session);
    const accessToken = useAuthStore((state) => state.accessToken);
    const error = useAuthStore((state) => state.error);

    return useMemo(() => {
        const user = session?.user ?? null;
        return {
            status,
            session,
            user,
            accessToken,
            error,
            isAuthenticated: status === "authenticated" && Boolean(session),
            isAdmin: user?.role === "ADMIN",
            hasModule: (moduleKey: AuthModuleKey) => hasModuleAccess(user, moduleKey),
            hasAnyModule: (moduleKeys: AuthModuleKey[]) => hasAnyModuleAccess(user, moduleKeys),
        };
    }, [accessToken, error, session, status]);
}
