"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { loginWithPassword } from "@/lib/authApi";
import { resolvePostLoginPath } from "@/lib/authAccess";
import { clearStoredAuthAccessToken } from "@/lib/authSessionStorage";
import { useAppLocale } from "@/hooks/useAppLocale";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useAuthStore } from "@/store/useAuthStore";
import LanguageSwitch from "@/components/layout/LanguageSwitch";

export default function LoginWorkspace() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextPath = searchParams.get("next");
    const { status, session } = useAuthSession();
    const { copy } = useAppLocale();
    const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
    const setAnonymous = useAuthStore((state) => state.setAnonymous);
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const redirectPath = useMemo(
        () => (session ? resolvePostLoginPath(session, nextPath) : "/"),
        [nextPath, session],
    );

    useEffect(() => {
        if (status === "authenticated" && session) {
            router.replace(redirectPath);
        }
    }, [redirectPath, router, session, status]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPending(true);
        setError(null);

        try {
            const issued = await loginWithPassword(identifier.trim(), password);
            clearStoredAuthAccessToken();
            setAuthenticated(issued.session);
            router.replace(resolvePostLoginPath(issued.session, nextPath));
        } catch (submitError) {
            clearStoredAuthAccessToken();
            setAnonymous(submitError instanceof Error ? submitError.message : copy.login.signInFallbackError);
            setError(submitError instanceof Error ? submitError.message : copy.login.signInFallbackError);
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="command-deck-canvas flex min-h-screen items-center justify-center px-6 py-10">
            <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.05fr,0.95fr]">
                <section className="rounded-[36px] border border-border-muted bg-bg-primary/92 p-8 shadow-[0_32px_100px_rgba(0,0,0,0.3)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-accent">
                            <LockKeyhole className="h-3.5 w-3.5" />
                            {copy.login.authenticatedLogin}
                        </div>
                        <LanguageSwitch />
                    </div>
                    <h1 className="mt-4 text-4xl font-black tracking-tight text-text-primary">
                        {copy.login.title}
                    </h1>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-text-secondary">
                        {copy.login.description}
                    </p>

                    <div className="mt-8 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-3xl border border-border-muted bg-bg-tertiary/65 p-5">
                            <div className="text-xs font-black uppercase tracking-[0.2em] text-text-muted">{copy.login.adminLane}</div>
                            <div className="mt-3 text-lg font-black text-text-primary">{copy.login.adminLaneTitle}</div>
                            <p className="mt-2 text-sm leading-6 text-text-secondary">
                                {copy.login.adminLaneDescription}
                            </p>
                        </div>
                        <div className="rounded-3xl border border-border-muted bg-bg-tertiary/65 p-5">
                            <div className="text-xs font-black uppercase tracking-[0.2em] text-text-muted">{copy.login.userLane}</div>
                            <div className="mt-3 text-lg font-black text-text-primary">{copy.login.userLaneTitle}</div>
                            <p className="mt-2 text-sm leading-6 text-text-secondary">
                                {copy.login.userLaneDescription}
                            </p>
                        </div>
                    </div>
                </section>

                <section className="rounded-[36px] border border-border-muted bg-bg-primary/94 p-8 shadow-[0_32px_100px_rgba(0,0,0,0.3)]">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                            <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="text-sm font-black uppercase tracking-[0.2em] text-text-muted">{copy.login.sessionGate}</div>
                            <div className="text-xl font-black text-text-primary">/login</div>
                        </div>
                    </div>

                    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">{copy.login.emailOrUsername}</div>
                            <input
                                type="text"
                                value={identifier}
                                onChange={(event) => setIdentifier(event.target.value)}
                                className="mt-2 h-12 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/40"
                                placeholder={copy.login.emailOrUsernamePlaceholder}
                                autoComplete="username"
                                required
                            />
                        </label>

                        <label className="block">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">{copy.login.password}</div>
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className="mt-2 h-12 w-full rounded-2xl border border-border-muted bg-bg-tertiary px-4 text-sm text-text-primary outline-none transition focus:border-accent/40"
                                placeholder={copy.login.passwordPlaceholder}
                                autoComplete="current-password"
                                required
                            />
                        </label>

                        {error ? (
                            <div className="rounded-2xl border border-price-down/30 bg-price-down/10 px-4 py-3 text-sm text-price-down">
                                {error}
                            </div>
                        ) : null}

                        <button
                            type="submit"
                            disabled={pending}
                            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-sm font-black text-bg-secondary transition hover:translate-y-[-1px] disabled:cursor-wait disabled:opacity-70"
                        >
                            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                            {copy.login.signIn}
                        </button>
                    </form>
                </section>
            </div>
        </div>
    );
}
