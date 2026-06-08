"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useMarketStore } from '@/store/useMarketStore';
import { AVAILABLE_TIMEFRAMES } from '@/components/layout/workspaceContext';

export interface LegendData {
    symbol: string;
    timeframe: string;
    open: string;
    high: string;
    low: string;
    close: string;
    change: string;
    isUp: boolean;
}

interface ChartLegendProps {
    data: LegendData;
}

export default function ChartLegend({ data }: ChartLegendProps) {
    const { setTimeframe } = useMarketStore();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="flex flex-col gap-1 select-none pointer-events-none">
            <div className="flex items-center gap-2 pointer-events-auto">
                <span className="text-xl font-bold text-text-primary tracking-tight">{data.symbol}</span>

                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary border border-border-muted hover:border-accent/50 hover:bg-white/5 transition-colors group cursor-pointer"
                    >
                        <span className="text-[10px] font-bold text-text-secondary group-hover:text-text-primary">{data.timeframe}</span>
                        <ChevronDown className={`w-3 h-3 text-text-muted group-hover:text-text-primary transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isOpen && (
                        <div className="absolute top-full left-0 mt-1 w-36 bg-bg-secondary/95 backdrop-blur-xl border border-border-muted rounded-lg shadow-xl z-50 overflow-hidden p-1.5 grid grid-cols-4 gap-1">
                            {AVAILABLE_TIMEFRAMES.map((tf) => (
                                <button
                                    key={tf}
                                    type="button"
                                    onClick={() => {
                                        setTimeframe(tf);
                                        setIsOpen(false);
                                    }}
                                    className={`text-[10px] font-bold rounded py-1 transition-colors cursor-pointer ${tf === data.timeframe ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-white/10 hover:text-text-primary'}`}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono whitespace-nowrap overflow-hidden">
                <div className="flex items-center gap-1">
                    <span className="text-text-muted uppercase">O</span>
                    <span className="text-text-primary min-w-[60px]">{data.open}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-text-muted uppercase">H</span>
                    <span className="text-text-primary min-w-[60px]">{data.high}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-text-muted uppercase">L</span>
                    <span className="text-text-primary min-w-[60px]">{data.low}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-text-muted uppercase">C</span>
                    <span className="text-text-primary min-w-[60px]">{data.close}</span>
                </div>
                <span className={`font-bold ${data.isUp ? 'text-price-up' : 'text-price-down'}`}>
                    {data.change}
                </span>
            </div>
        </div>
    );
}
