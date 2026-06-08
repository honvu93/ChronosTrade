import { hasAnyModuleAccess, hasModuleAccess } from "@/lib/authAccess";
import { AuthModuleKey, AuthSessionUser } from "@/types/auth";
import { AppLocale, DEFAULT_APP_LOCALE } from "@/lib/appLocale";
import { getTranslationCatalog } from "@/lib/translations";

export type PrimaryNavigationKey = AuthModuleKey | "indicators" | "admin" | "docs";

export interface PrimaryNavigationItem {
    key: PrimaryNavigationKey;
    label: string;
    href: string;
}

export interface WorkspaceRouteContext {
    navKey: PrimaryNavigationKey;
    moduleLabel: string;
    title: string;
    description: string;
}

const primaryOrder: Array<{
    key: AuthModuleKey;
    label: string;
    href: string;
}> = [
    { key: "chart", label: "Chart", href: "/" },
    { key: "signal", label: "Signals", href: "/signals" },
    { key: "report", label: "Analytics", href: "/reports" },
    { key: "trading", label: "Trading", href: "/trading" },
];

export const buildPrimaryNavigation = (
    user: Pick<AuthSessionUser, "role" | "modules"> | null | undefined,
    locale: AppLocale = DEFAULT_APP_LOCALE,
): PrimaryNavigationItem[] => {
    if (!user) {
        return [];
    }

    const copy = getTranslationCatalog(locale);
    const items = primaryOrder.filter((item) => {
        // "report" key now represents merged Analytics — grant access to users with either "report" or "engine" module
        if (item.key === "report") {
            return hasAnyModuleAccess(user, ["report", "engine"]);
        }
        return hasModuleAccess(user, item.key);
    });
    const localizedItems: PrimaryNavigationItem[] = items.map((item) => ({
        ...item,
        label: item.key === "chart"
            ? copy.navigation.chart
            : item.key === "signal"
                ? copy.navigation.signals
                : item.key === "report"
                    ? copy.navigation.reports
                    : copy.navigation.trading,
    }));
    if (hasAnyModuleAccess(user, ["signal", "engine"])) {
        const reportIndex = localizedItems.findIndex((item) => item.key === "report");
        const signalIndex = localizedItems.findIndex((item) => item.key === "signal");
        const indicatorItem: PrimaryNavigationItem = {
            key: "indicators",
            label: copy.navigation.indicators,
            href: "/indicators",
        };
        if (reportIndex >= 0) {
            localizedItems.splice(reportIndex + 1, 0, indicatorItem);
        } else if (signalIndex >= 0) {
            localizedItems.splice(signalIndex + 1, 0, indicatorItem);
        } else {
            localizedItems.push(indicatorItem);
        }
    }
    // Docs link — visible to all authenticated users
    localizedItems.push({ key: "docs", label: "Docs", href: "/docs" });

    if (user.role === "ADMIN") {
        return [...localizedItems.slice(0, -1), { key: "admin", label: copy.navigation.admin, href: "/admin/monitoring" }, localizedItems[localizedItems.length - 1]];
    }

    return localizedItems;
};

export const getActiveNavigationKey = (pathname: string): PrimaryNavigationKey => {
    if (pathname.startsWith("/admin")) {
        return "admin";
    }

    if (pathname.startsWith("/indicators")) {
        return "indicators";
    }

    if (pathname.startsWith("/engine")) {
        return "report";
    }

    if (pathname.startsWith("/trading")) {
        return "trading";
    }

    if (pathname.startsWith("/reports")) {
        return "report";
    }

    if (pathname.startsWith("/signals")) {
        return "signal";
    }

    if (pathname.startsWith("/docs")) {
        return "docs";
    }

    return "chart";
};

export const isNavigationItemActive = (
    pathname: string,
    key: PrimaryNavigationKey,
) => getActiveNavigationKey(pathname) === key;

export const resolveWorkspaceContext = (pathname: string): WorkspaceRouteContext => {
    return resolveWorkspaceContextForLocale(pathname, DEFAULT_APP_LOCALE);
};

export const resolveWorkspaceContextForLocale = (
    pathname: string,
    locale: AppLocale = DEFAULT_APP_LOCALE,
): WorkspaceRouteContext => {
    const routeCopy = getTranslationCatalog(locale).workspace.routeContext;
    if (pathname.startsWith("/admin/monitoring")) {
        return {
            navKey: "admin",
            ...routeCopy.adminMonitoring,
        };
    }

    if (pathname.startsWith("/admin/indicator-catalog")) {
        return {
            navKey: "admin",
            ...routeCopy.adminIndicatorCatalog,
        };
    }

    if (pathname.startsWith("/admin/backtest-knowledge")) {
        return {
            navKey: "admin",
            moduleLabel: "Admin",
            title: "Backtest Knowledge Base",
            description: "Optimization history, config rules, and production decisions",
        };
    }

    if (pathname.startsWith("/admin")) {
        return {
            navKey: "admin",
            ...routeCopy.adminAccess,
        };
    }

    if (pathname.startsWith("/signals/backtests")) {
        return {
            navKey: "signal",
            ...routeCopy.signalsBacktests,
        };
    }

    if (pathname.startsWith("/signals/composer")) {
        return {
            navKey: "signal",
            ...routeCopy.signalsComposer,
        };
    }

    if (pathname.startsWith("/signals")) {
        return {
            navKey: "signal",
            ...routeCopy.signals,
        };
    }

    if (pathname.startsWith("/reports")) {
        return {
            navKey: "report",
            ...routeCopy.reports,
        };
    }

    if (pathname.startsWith("/trading")) {
        return {
            navKey: "trading",
            ...routeCopy.trading,
        };
    }

    if (pathname.startsWith("/engine")) {
        return {
            navKey: "report",
            ...routeCopy.engine,
        };
    }

    if (pathname.startsWith("/indicators")) {
        return {
            navKey: "indicators",
            ...routeCopy.indicators,
        };
    }

    if (pathname.startsWith("/docs")) {
        return {
            navKey: "docs",
            moduleLabel: "Docs",
            title: "User Guide",
            description: "Platform documentation and usage guide",
        };
    }

    return {
        navKey: "chart",
        ...routeCopy.chart,
    };
};
