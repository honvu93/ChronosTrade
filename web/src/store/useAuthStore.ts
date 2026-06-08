"use client";

import { create } from "zustand";
import { AuthSessionSnapshot } from "@/types/auth";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthStoreState {
    status: AuthStatus;
    accessToken: string | null;
    session: AuthSessionSnapshot | null;
    error: string | null;
    setLoading: () => void;
    setAuthenticated: (session: AuthSessionSnapshot, accessToken?: string | null) => void;
    setAnonymous: (error?: string | null) => void;
}

export const useAuthStore = create<AuthStoreState>((set) => ({
    status: "loading",
    accessToken: null,
    session: null,
    error: null,
    setLoading: () => set((state) => ({
        status: state.session ? "authenticated" : "loading",
        accessToken: state.accessToken,
        session: state.session,
        error: null,
    })),
    setAuthenticated: (session, accessToken = null) => set({
        status: "authenticated",
        accessToken,
        session,
        error: null,
    }),
    setAnonymous: (error = null) => set({
        status: "anonymous",
        accessToken: null,
        session: null,
        error,
    }),
}));
