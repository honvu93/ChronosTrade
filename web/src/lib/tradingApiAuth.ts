"use client";

import { useAuthStore } from "@/store/useAuthStore";

const COOKIE_SESSION_SENTINEL = "__cookie_session__";

export const hasTradingAuthSession = () => {
    const { status, session } = useAuthStore.getState();
    return status === "authenticated" && Boolean(session);
};

export const readTradingAuthToken = () => (
    hasTradingAuthSession()
        ? COOKIE_SESSION_SENTINEL
        : null
);

export const buildTradingAuthHeaders = (_authToken: string | null): HeadersInit => ({});
