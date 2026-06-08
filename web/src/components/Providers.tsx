"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { loadCurrentSession, refreshCurrentSession } from '@/lib/authApi';
import { createAuthFetch } from '@/lib/authFetch';
import {
    clearStoredAuthAccessToken,
} from '@/lib/authSessionStorage';
import { useAuthStore } from '@/store/useAuthStore';
import { SocketProvider } from './SocketProvider';
import LocaleEffects from "@/components/layout/LocaleEffects";

export function Providers({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                refetchOnWindowFocus: false,
            },
        },
    }));
    const bootstrapStartedRef = useRef(false);
    const baseFetchRef = useRef<typeof window.fetch | null>(null);
    const status = useAuthStore((state) => state.status);
    const session = useAuthStore((state) => state.session);
    const setLoading = useAuthStore((state) => state.setLoading);
    const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
    const setAnonymous = useAuthStore((state) => state.setAnonymous);

    useEffect(() => {
        if (!bootstrapStartedRef.current) {
            bootstrapStartedRef.current = true;
        } else {
            return;
        }

        let active = true;

        const bootstrap = async () => {
            setLoading();

            try {
                const current = await loadCurrentSession();
                if (!active) {
                    return;
                }
                clearStoredAuthAccessToken();
                setAuthenticated(current.session);
                return;
            } catch {
                // fall through to refresh flow
            }

            try {
                const refreshed = await refreshCurrentSession();
                if (!active) {
                    return;
                }
                clearStoredAuthAccessToken();
                setAuthenticated(refreshed.session);
            } catch {
                if (!active) {
                    return;
                }
                clearStoredAuthAccessToken();
                setAnonymous(null);
            }
        };

        void bootstrap();

        return () => {
            active = false;
        };
    }, [setAnonymous, setAuthenticated, setLoading]);

    useEffect(() => {
        if (!session || status !== "authenticated") {
            return;
        }

        const expiryMs = Date.parse(session.accessTokenExpiresAt);
        if (!Number.isFinite(expiryMs)) {
            return;
        }

        const refreshInMs = Math.max(5_000, expiryMs - Date.now() - 60_000);
        const refreshTimer = window.setTimeout(async () => {
            try {
                const refreshed = await refreshCurrentSession();
                clearStoredAuthAccessToken();
                setAuthenticated(refreshed.session);
            } catch {
                clearStoredAuthAccessToken();
                setAnonymous("Session expired. Sign in again to continue.");
            }
        }, refreshInMs);

        return () => {
            window.clearTimeout(refreshTimer);
        };
    }, [session, setAnonymous, setAuthenticated, status]);

    useEffect(() => {
        if (!baseFetchRef.current) {
            baseFetchRef.current = window.fetch.bind(window);
        }

        const baseFetch = baseFetchRef.current;
        window.fetch = createAuthFetch(baseFetch);

        return () => {
            window.fetch = baseFetch;
        };
    }, []);

    const socketEnabled = pathname !== "/login" && status === "authenticated";

    return (
        <QueryClientProvider client={queryClient}>
            <LocaleEffects />
            <SocketProvider enabled={socketEnabled}>
                {children}
            </SocketProvider>
        </QueryClientProvider>
    );
}
