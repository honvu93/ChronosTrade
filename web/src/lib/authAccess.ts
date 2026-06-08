import {
    AuthModuleKey,
    AuthRoleKey,
    AuthSessionSnapshot,
    AuthSessionUser,
} from "@/types/auth";

export const moduleLabels: Record<AuthModuleKey, string> = {
    chart: "Chart",
    signal: "Signal",
    report: "Analytics",
    trading: "Trading",
    engine: "Analytics",
};

export const buildFirstAllowedPath = (
    role: AuthRoleKey,
    modules: AuthModuleKey[],
) => {
    if (role === "ADMIN") {
        return "/";
    }

    const orderedModules: AuthModuleKey[] = ["chart", "signal", "report", "trading", "engine"];
    for (const moduleKey of orderedModules) {
        if (!modules.includes(moduleKey)) {
            continue;
        }

        switch (moduleKey) {
            case "chart":
                return "/";
            case "signal":
                return "/signals";
            case "report":
            case "engine":
                return "/reports";
            case "trading":
                return "/trading";
            default:
                break;
        }
    }

    return null;
};

export const hasModuleAccess = (
    user: Pick<AuthSessionUser, "role" | "modules"> | null | undefined,
    moduleKey: AuthModuleKey,
) => {
    if (!user) {
        return false;
    }

    return user.role === "ADMIN" || user.modules.includes(moduleKey);
};

export const hasAnyModuleAccess = (
    user: Pick<AuthSessionUser, "role" | "modules"> | null | undefined,
    moduleKeys: AuthModuleKey[],
) => {
    if (!user) {
        return false;
    }

    return user.role === "ADMIN" || moduleKeys.some((moduleKey) => user.modules.includes(moduleKey));
};

const normalizeRequestedPath = (value: string | null | undefined) => {
    if (!value || typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
        return null;
    }

    return trimmed;
};

export const canAccessPath = (
    session: AuthSessionSnapshot | null | undefined,
    pathname: string,
) => {
    if (!session) {
        return false;
    }

    if (session.user.role === "ADMIN") {
        return true;
    }

    if (pathname === "/") {
        return hasModuleAccess(session.user, "chart");
    }

    if (pathname.startsWith("/signals/backtests")) {
        return hasAnyModuleAccess(session.user, ["signal", "report"]);
    }

    if (pathname.startsWith("/signals")) {
        return hasModuleAccess(session.user, "signal");
    }

    if (pathname.startsWith("/reports") || pathname.startsWith("/engine")) {
        return hasAnyModuleAccess(session.user, ["report", "engine"]);
    }

    if (pathname.startsWith("/trading")) {
        return hasModuleAccess(session.user, "trading");
    }

    if (pathname.startsWith("/indicators")) {
        return hasAnyModuleAccess(session.user, ["signal", "engine"]);
    }

    if (pathname.startsWith("/admin")) {
        return false;
    }

    return true;
};

export const resolvePostLoginPath = (
    session: AuthSessionSnapshot,
    requestedPath?: string | null,
) => {
    const normalizedRequestedPath = normalizeRequestedPath(requestedPath);
    if (normalizedRequestedPath && normalizedRequestedPath !== "/login" && canAccessPath(session, normalizedRequestedPath)) {
        return normalizedRequestedPath;
    }

    return session.firstAllowedPath || buildFirstAllowedPath(session.user.role, session.user.modules) || "/";
};
