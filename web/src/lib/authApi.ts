import {
    AuthErrorResponseEnvelope,
    AuthSessionResponseEnvelope,
    AuthUserResponseEnvelope,
    AuthUsersResponseEnvelope,
    AuthUserUpsertInput,
} from "@/types/auth";

const buildJsonRequest = (init: RequestInit = {}): RequestInit => ({
    cache: "no-store",
    credentials: "include",
    ...init,
    headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
    },
});

const readJson = async <T,>(response: Response) => response.json().catch(() => null) as Promise<T | null>;

const unwrapEnvelope = <T extends { success: true },>(
    response: Response,
    payload: T | AuthErrorResponseEnvelope | null,
    fallbackMessage: string,
) => {
    if (!response.ok || !payload || payload.success === false) {
        throw new Error(
            payload && payload.success === false
                ? payload.error.message
                : fallbackMessage,
        );
    }

    return payload;
};

export const loginWithPassword = async (identifier: string, password: string) => {
    const response = await fetch("/api/auth/login", buildJsonRequest({
        method: "POST",
        body: JSON.stringify({ identifier, password }),
    }));
    const payload = await readJson<AuthSessionResponseEnvelope | AuthErrorResponseEnvelope>(response);
    return unwrapEnvelope(response, payload, "Unable to sign in.").data;
};

export const loadCurrentSession = async () => {
    const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "include",
    });
    const payload = await readJson<AuthSessionResponseEnvelope | AuthErrorResponseEnvelope>(response);
    return unwrapEnvelope(response, payload, "Unable to load the current session.").data;
};

export const refreshCurrentSession = async () => {
    const response = await fetch("/api/auth/refresh", buildJsonRequest({
        method: "POST",
        body: JSON.stringify({}),
    }));
    const payload = await readJson<AuthSessionResponseEnvelope | AuthErrorResponseEnvelope>(response);
    return unwrapEnvelope(response, payload, "Unable to refresh the current session.").data;
};

export const logoutCurrentSession = async () => {
    const response = await fetch("/api/auth/logout", buildJsonRequest({
        method: "POST",
        body: JSON.stringify({}),
    }));
    const payload = await readJson<{ success: true } | AuthErrorResponseEnvelope>(response);
    return unwrapEnvelope(response, payload, "Unable to sign out.");
};

export const listManagedUsers = async () => {
    const response = await fetch("/api/auth/users", {
        cache: "no-store",
        credentials: "include",
    });
    const payload = await readJson<AuthUsersResponseEnvelope | AuthErrorResponseEnvelope>(response);
    return unwrapEnvelope(response, payload, "Unable to load user access settings.").data.users;
};

export const createManagedUser = async (input: AuthUserUpsertInput) => {
    const response = await fetch("/api/auth/users", buildJsonRequest({
        method: "POST",
        body: JSON.stringify(input),
    }));
    const payload = await readJson<AuthUserResponseEnvelope | AuthErrorResponseEnvelope>(response);
    return unwrapEnvelope(response, payload, "Unable to create the user.").data.user;
};

export const updateManagedUser = async (userId: string, input: AuthUserUpsertInput) => {
    const response = await fetch(`/api/auth/users/${encodeURIComponent(userId)}`, buildJsonRequest({
        method: "PATCH",
        body: JSON.stringify(input),
    }));
    const payload = await readJson<AuthUserResponseEnvelope | AuthErrorResponseEnvelope>(response);
    return unwrapEnvelope(response, payload, "Unable to update the user.").data.user;
};
