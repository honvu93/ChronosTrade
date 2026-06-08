"use client";

import Link from "next/link";
import { ArrowRight, LayoutTemplate } from "lucide-react";
import { useAppLocale } from "@/hooks/useAppLocale";

export default function ModulePlaceholder({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    const { copy } = useAppLocale();

    return (
        <div className="command-deck-canvas grid h-full place-items-center p-6">
            <div className="max-w-xl rounded-[28px] border border-border-muted bg-bg-primary/90 p-10 text-center shadow-[0_32px_90px_rgba(0,0,0,0.35)]">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                    <LayoutTemplate className="h-7 w-7" />
                </div>
                <h1 className="mt-5 text-3xl font-black tracking-tight text-text-primary">{title}</h1>
                <p className="mt-3 text-sm leading-6 text-text-secondary">{description}</p>
                <Link
                    href="/engine"
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-bg-secondary transition-transform hover:translate-x-0.5"
                >
                    {copy.modulePlaceholder.openEngine}
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        </div>
    );
}
