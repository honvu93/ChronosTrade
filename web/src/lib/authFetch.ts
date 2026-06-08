import { clearStoredAuthAccessToken } from "./authSessionStorage";
import { useAuthStore } from "../store/useAuthStore";

const resolveRequestUrl = (input: RequestInfo | URL) => {
    if (typeof input === "string") {
        return input;
    }

    if (input instanceof URL) {
        return input.toString();
    }

    return input.url;
};

export const isApiRequestUrl = (url: string) => {
    if (url.startsWith("/api/")) {
        return true;
    }

    if (typeof window === "undefined") {
        return false;
    }

    try {
        const resolved = new URL(url, window.location.origin);
        if (!resolved.pathname.startsWith("/api/")) {
            return false;
        }

        const configuredApiBase = process.env.NEXT_PUBLIC_API_URL?.trim();
        if (!configuredApiBase) {
            return resolved.origin === window.location.origin;
        }

        return resolved.origin === new URL(configuredApiBase, window.location.origin).origin
            || resolved.origin === window.location.origin;
    } catch {
        return false;
    }
};

const AUTH_REFRESH_PATH = "/api/auth/refresh";
const AUTH_EXCLUDED_RETRY_PATHS = new Set([
    "/api/auth/login",
    "/api/auth/logout",
    AUTH_REFRESH_PATH,
]);

type SessionEnvelope = {
    success: true;
    data: {
        session: {
            accessTokenExpiresAt: string;
        } & Record<string, unknown>;
    };
};

let refreshPromise: Promise<void> | null = null;

const resolveAuthRefreshUrl = () => {
    if (typeof window === "undefined") {
        return AUTH_REFRESH_PATH;
    }

    return new URL(AUTH_REFRESH_PATH, window.location.origin).toString();
};

const buildSessionExpiredResponse = () => new Response(JSON.stringify({
    success: false,
    error: {
        code: "AUTH_REFRESH_INVALID",
        message: "Session expired. Sign in again to continue.",
        domain: "auth.session",
    },
}), {
    status: 401,
    headers: {
        "Content-Type": "application/json",
    },
});

const canRetryWithRefresh = (url: string) => {
    if (!isApiRequestUrl(url)) {
        return false;
    }

    try {
        const resolved = typeof window === "undefined"
            ? new URL(url, "http://localhost")
            : new URL(url, window.location.origin);
        return !AUTH_EXCLUDED_RETRY_PATHS.has(resolved.pathname);
    } catch {
        return false;
    }
};

const refreshAuthenticatedSession = async (baseFetch: typeof window.fetch) => {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        const response = await baseFetch(resolveAuthRefreshUrl(), {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        });

        const payload = await response.json().catch(() => null) as SessionEnvelope | null;
        if (!response.ok || !payload || payload.success !== true) {
            throw new Error("Session refresh failed.");
        }

        clearStoredAuthAccessToken();
        useAuthStore.getState().setAuthenticated(payload.data.session as never);
    })().finally(() => {
        refreshPromise = null;
    });

    return refreshPromise;
};

export const createAuthFetch = (
    baseFetch: typeof window.fetch,
): typeof window.fetch => {
    return async (input, init) => {
        const requestUrl = resolveRequestUrl(input);
        if (!isApiRequestUrl(requestUrl)) {
            return baseFetch(input, init);
        }

        const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
        const credentials = init?.credentials ?? "include";
        const request = input instanceof Request
            ? new Request(input, { headers, credentials })
            : new Request(input, {
                ...init,
                credentials,
                headers,
            });

        const response = await baseFetch(request.clone());
        if (response.status !== 401 || !canRetryWithRefresh(requestUrl)) {
            return response;
        }

        try {
            await refreshAuthenticatedSession(baseFetch);
        } catch {
            clearStoredAuthAccessToken();
            useAuthStore.getState().setAnonymous("Session expired. Sign in again to continue.");
            return buildSessionExpiredResponse();
        }

        return baseFetch(request.clone());
    };
};
