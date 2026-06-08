'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Loader2, AlertCircle } from 'lucide-react';
import { TechIndicatorDefinition, TechIndicatorConditionDef } from '@/types/signals';
import { useAppLocale } from '@/hooks/useAppLocale';

interface Props {
    indicators: TechIndicatorDefinition[];
    loading: boolean;
    error: string | null;
    onAddCondition: (indicator: TechIndicatorDefinition, condition: TechIndicatorConditionDef) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
    momentum: 'Momentum',
    trend: 'Trend',
    structure: 'Structure',
    volatility: 'Volatility',
    fibonacci: 'Fibonacci',
    utility: 'Utility',
};

const CATEGORY_COLORS: Record<string, string> = {
    momentum: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
    trend: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
    structure: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    volatility: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
    fibonacci: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    utility: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
};

export default function IndicatorBlockCatalog({ indicators, loading, error, onAddCondition }: Props) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const { copy } = useAppLocale();

    const toggle = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Group by category
    const grouped = indicators.reduce<Record<string, TechIndicatorDefinition[]>>((acc, ind) => {
        const cat = ind.category || 'other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(ind);
        return acc;
    }, {});

    return (
        <aside className="w-72 shrink-0 flex flex-col bg-bg-tertiary border-r border-border-muted overflow-hidden">
            <div className="px-4 py-3 border-b border-border-muted shrink-0">
                <h2 className="text-xs font-black uppercase tracking-widest text-text-muted">{copy.indicatorCatalog.title}</h2>
                <p className="text-[10px] text-text-muted/60 mt-0.5">{copy.indicatorCatalog.subtitle}</p>
            </div>

            <div className="flex-1 overflow-y-auto py-2 space-y-1 px-2">
                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={20} className="animate-spin text-text-muted" />
                    </div>
                )}

                {error && (
                    <div className="flex items-center gap-2 p-3 bg-price-down/10 border border-price-down/20 rounded-xl text-price-down text-xs">
                        <AlertCircle size={14} />
                        <span>{error}</span>
                    </div>
                )}

                {!loading && !error && Object.entries(grouped).map(([category, inds]) => (
                    <div key={category} className="space-y-1">
                        <div className="px-2 py-1 text-[9px] font-black uppercase tracking-widest text-text-muted/50">
                            {copy.indicatorCatalog.categories[category] ?? CATEGORY_LABELS[category] ?? category}
                        </div>

                        {inds.map(indicator => {
                            const isOpen = expanded.has(indicator.id);
                            const colorCls = CATEGORY_COLORS[indicator.category] ?? 'text-text-muted border-border-muted bg-bg-primary';

                            return (
                                <div key={indicator.id} className="rounded-xl border border-border-muted overflow-hidden">
                                    {/* Indicator header */}
                                    <button
                                        onClick={() => toggle(indicator.id)}
                                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                                    >
                                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${colorCls} shrink-0`}>
                                            {indicator.id}
                                        </span>
                                        <span className="flex-1 text-xs font-semibold text-text-primary leading-tight">
                                            {indicator.name}
                                        </span>
                                        {isOpen
                                            ? <ChevronDown size={12} className="text-text-muted shrink-0" />
                                            : <ChevronRight size={12} className="text-text-muted shrink-0" />
                                        }
                                    </button>

                                    {/* Conditions list */}
                                    {isOpen && (
                                        <div className="border-t border-border-muted bg-bg-primary/50">
                                            <p className="px-3 py-1.5 text-[9px] text-text-muted/60 italic">
                                                {indicator.description}
                                            </p>
                                            {indicator.conditions.map(cond => (
                                                <button
                                                    key={cond.id}
                                                    onClick={() => onAddCondition(indicator, cond)}
                                                    className="w-full flex items-start gap-2 px-3 py-2 hover:bg-accent/10 transition-colors text-left group border-t border-border-muted/50 first:border-t-0"
                                                    title={cond.description}
                                                >
                                                    <Plus size={12} className="text-text-muted group-hover:text-accent mt-0.5 shrink-0 transition-colors" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs text-text-secondary group-hover:text-text-primary transition-colors leading-tight">
                                                            {cond.name}
                                                        </div>
                                                        <div className="text-[9px] text-text-muted/60 mt-0.5 leading-relaxed line-clamp-2">
                                                            {cond.description}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </aside>
    );
}
