"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Search, User, X } from "lucide-react";
import { logoutCurrentSession } from "@/lib/authApi";
import { clearStoredAuthAccessToken } from "@/lib/authSessionStorage";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useAppLocale } from "@/hooks/useAppLocale";
import { useAuthStore } from "@/store/useAuthStore";
import { useMarketStore } from "@/store/useMarketStore";
import {
    buildPrimaryNavigation,
    isNavigationItemActive,
    resolveWorkspaceContextForLocale,
} from "./navigationModel";
import { interpolateCopy } from "@/lib/translations";
import LanguageSwitch from "./LanguageSwitch";

const getSourceLabel = (
    symbol: string,
    {
        mt5Source,
        marketSource,
    }: {
        mt5Source: string;
        marketSource: string;
    },
) => {
    if (symbol.endsWith("c") || ["XAUUSD", "XAGUSD"].includes(symbol)) {
        return mt5Source;
    }
    return marketSource;
};

export default function TopNav() {
    const { symbol: currentSymbol, setSymbol } = useMarketStore();
    const pathname = usePathname();
    const router = useRouter();
    const { user, hasModule } = useAuthSession();
    const { locale, copy } = useAppLocale();
    const setAnonymous = useAuthStore((state) => state.setAnonymous);
    const [search, setSearch] = useState("");
    const [symbols, setSymbols] = useState<string[]>([]);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!user) {
            setSymbols([]);
            return;
        }

        let active = true;

        const fetchSymbols = async () => {
            try {
                const response = await fetch("/api/symbols");
                const data = await response.json();
                if (active && Array.isArray(data)) {
                    setSymbols(data);
                }
            } catch (error) {
                console.error("Failed to fetch symbols:", error);
            }
        };

        void fetchSymbols();

        return () => {
            active = false;
        };
    }, [user]);

    const filteredSymbols = useMemo(() => {
        if (search.trim() === "") {
            return symbols.slice(0, 10);
        }

        return symbols
            .filter((symbol) => symbol.toLowerCase().includes(search.toLowerCase()))
            .slice(0, 10);
    }, [search, symbols]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setIsSearchOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const navItems = useMemo(
        () => buildPrimaryNavigation(user, locale),
        [locale, user],
    );
    const workspace = useMemo(
        () => resolveWorkspaceContextForLocale(pathname, locale),
        [locale, pathname],
    );

    const handleSelect = (symbol: string) => {
        setSymbol(symbol);
        setSearch("");
        setIsSearchOpen(false);
    };

    const handleLogout = async () => {
        setIsSigningOut(true);

        try {
            await logoutCurrentSession();
        } catch {
            // Continue clearing local session state even when the server logout call fails.
        } finally {
            clearStoredAuthAccessToken();
            setAnonymous(null);
            setIsSigningOut(false);
            router.replace("/login");
        }
    };

    return (
        <header className="z-30 border-b border-border-muted/80 bg-bg-secondary/78 px-4 py-3 backdrop-blur-xl md:px-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent shadow-[0_12px_32px_rgba(77,140,255,0.14)] lg:hidden">
                        <span className="text-sm font-black tracking-[0.16em]">TV</span>
                    </div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-text-muted">
                            <span className="text-accent">{workspace.moduleLabel}</span>
                            <span className="rounded-full border border-border-muted bg-bg-primary/70 px-2.5 py-1 text-[10px] text-text-secondary">
                                {copy.workspace.sharedShell}
                            </span>
                        </div>
                        <h1 className="mt-2 text-lg font-black tracking-tight text-text-primary md:text-xl">
                            {workspace.title}
                        </h1>
                        <p className="mt-1 hidden max-w-2xl text-xs leading-5 text-text-secondary sm:block md:text-sm">
                            {workspace.description}
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-3 xl:w-[min(52rem,100%)] xl:items-end">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
                        <div className="relative flex-1 md:max-w-md" ref={searchRef}>
                            <div className="group relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted transition-colors group-focus-within:text-accent" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(event) => {
                                        setSearch(event.target.value);
                                        setIsSearchOpen(true);
                                    }}
                                    onFocus={() => setIsSearchOpen(true)}
                                    placeholder={copy.topNav.searchPlaceholder}
                                    className="h-10 w-full rounded-full border border-border-muted bg-bg-primary/80 pl-10 pr-10 text-sm font-medium text-text-primary transition-all focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/18"
                                />
                                {search ? (
                                    <button
                                        type="button"
                                        onClick={() => setSearch("")}
                                        className="absolute right-3 top-1/2 rounded-full p-1 text-text-muted transition-colors hover:bg-white/5"
                                        aria-label={copy.topNav.clearSymbolSearch}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                ) : null}
                            </div>

                            {isSearchOpen ? (
                                <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-[24px] border border-border-muted bg-bg-primary/96 p-1 shadow-[0_26px_70px_rgba(4,10,22,0.32)] backdrop-blur-xl">
                                    <div className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">
                                        {copy.topNav.symbolContext}
                                    </div>
                                    {filteredSymbols.length > 0 ? filteredSymbols.map((symbol) => (
                                        <button
                                            key={symbol}
                                            type="button"
                                            onClick={() => handleSelect(symbol)}
                                            className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 transition ${
                                                symbol === currentSymbol
                                                    ? "border-accent/24 bg-accent/10"
                                                    : "border-transparent hover:bg-bg-tertiary/60"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="font-bold text-text-primary">{symbol}</span>
                                                <span className="rounded-full border border-border-muted bg-bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-text-muted">
                                                    {getSourceLabel(symbol, copy.topNav)}
                                                </span>
                                            </div>
                                            {symbol === currentSymbol ? <div className="h-2 w-2 rounded-full bg-accent" /> : null}
                                        </button>
                                    )) : (
                                        <div className="px-3 py-4 text-center text-sm italic text-text-muted">
                                            {interpolateCopy(copy.topNav.noSymbolsFound, { search })}
                                        </div>
                                    )}
                                </div>
                            ) : null}
                        </div>

                        <div className="flex items-center justify-end gap-2">
                            <LanguageSwitch />
                            <div className="hidden rounded-full border border-border-muted bg-bg-primary/72 px-3 py-2 text-right sm:block">
                                <div className="text-xs font-black text-text-primary">{user?.displayName || user?.username}</div>
                                <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">{user?.role}</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    void handleLogout();
                                }}
                                disabled={isSigningOut}
                                className="flex items-center gap-2 rounded-full border border-border-muted bg-bg-primary/72 px-3 py-2 text-sm font-bold text-text-primary transition-colors hover:border-accent/24 hover:bg-bg-primary disabled:cursor-wait disabled:opacity-70"
                            >
                                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border-muted bg-bg-tertiary/70">
                                    <User className="h-4 w-4 text-text-secondary" />
                                </div>
                                <span className="hidden md:inline">{copy.common.signOut}</span>
                                <LogOut className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <nav className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
                        {hasModule("chart") ? (
                            <Link
                                href="/"
                                className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] transition ${
                                    isNavigationItemActive(pathname, "chart")
                                        ? "border-accent/30 bg-accent/10 text-text-primary"
                                        : "border-border-muted bg-bg-primary/58 text-text-secondary"
                                }`}
                            >
                                {copy.navigation.chart}
                            </Link>
                        ) : null}
                        {navItems
                            .filter((item) => item.key !== "chart")
                            .map((item) => (
                                <Link
                                    key={item.key}
                                    href={item.href}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] transition ${
                                        isNavigationItemActive(pathname, item.key)
                                            ? "border-accent/30 bg-accent/10 text-text-primary"
                                            : "border-border-muted bg-bg-primary/58 text-text-secondary"
                                    }`}
                                >
                                    {item.label}
                                </Link>
                            ))}
                    </nav>
                </div>
            </div>
        </header>
    );
}
