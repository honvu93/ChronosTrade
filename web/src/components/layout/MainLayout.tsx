"use client";

import React from 'react';

interface MainLayoutProps {
    children: React.ReactNode;
    leftSidebar?: React.ReactNode;
    rightSidebar?: React.ReactNode;
}

export default function MainLayout({ children, leftSidebar, rightSidebar }: MainLayoutProps) {
    return (
        <div className="command-deck-canvas flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto p-3 md:p-4 xl:flex-row xl:overflow-hidden xl:p-5">
            {leftSidebar ? (
                <>
                    <div className="flex items-center gap-2 overflow-x-auto rounded-[24px] border border-border-muted bg-bg-primary/86 p-2 shadow-[0_18px_48px_rgba(4,10,22,0.2)] lg:hidden">
                        {leftSidebar}
                    </div>
                    <aside className="hidden w-16 shrink-0 flex-col items-center gap-4 overflow-hidden rounded-[28px] border border-border-muted bg-bg-primary/86 py-4 shadow-[0_20px_60px_rgba(4,10,22,0.24)] lg:flex">
                        {leftSidebar}
                    </aside>
                </>
            ) : null}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:flex-row xl:overflow-hidden">
                <main className="command-deck-surface relative min-h-[58vh] min-w-0 flex-1 overflow-hidden rounded-[28px] border border-border-muted xl:min-h-0">
                    {children}
                </main>

                {rightSidebar ? (
                    <>
                        <div className="command-deck-surface min-h-[280px] overflow-hidden rounded-[28px] border border-border-muted xl:hidden">
                            {rightSidebar}
                        </div>
                        <aside className="command-deck-surface hidden w-[352px] shrink-0 overflow-hidden rounded-[28px] border border-border-muted xl:block">
                            {rightSidebar}
                        </aside>
                    </>
                ) : null}
            </div>
        </div>
    );
}
