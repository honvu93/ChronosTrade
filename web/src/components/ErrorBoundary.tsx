"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { getTranslationCatalog } from "@/lib/translations";
import { readStoredAppLocale } from "@/lib/localeStorage";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
    };

    public static getDerivedStateFromError(_: Error): State {
        return { hasError: true };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            const locale = readStoredAppLocale();
            const copy = getTranslationCatalog(locale);

            return (
                this.props.fallback || (
                    <div className="w-full h-full flex items-center justify-center bg-bg-secondary p-8 border border-red-900/30 rounded-lg">
                        <div className="text-center">
                            <h2 className="text-red-500 font-bold mb-2">{copy.errorBoundary.somethingWentWrong}</h2>
                            <p className="text-text-secondary text-sm">{copy.errorBoundary.failedToRender}</p>
                            <button
                                className="mt-4 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded text-sm transition-colors"
                                onClick={() => this.setState({ hasError: false })}
                            >
                                {copy.errorBoundary.tryAgain}
                            </button>
                        </div>
                    </div>
                )
            );
        }

        return this.props.children;
    }
}
