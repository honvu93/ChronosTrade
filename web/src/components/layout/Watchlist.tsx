"use client";

import { useEffect, useRef, useState } from 'react';
import { useMarketStore } from '@/store/useMarketStore';
import { io, Socket } from 'socket.io-client';
import { TrendingUp, TrendingDown } from 'lucide-react';
import Sparkline from '../ui/Sparkline';
import { resolveSocketUrl } from '@/lib/socketUrl';
import { useAppLocale } from '@/hooks/useAppLocale';
import {
    formatCompactNumberForLocale,
    formatNumberForLocale,
    formatPercentForLocale,
} from '@/lib/localeFormatting';


interface MarketSummary {
    symbol: string;
    lastPrice: number;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    volume: number;
    changePercent: number;
    sparkline?: number[];
}

interface MarketTickPayload {
    s: string;
    close: number;
    open: number;
    high: number;
    low: number;
    volume: number;
}

function splitSymbol(sym: string): { base: string; quote: string } {
    // Strip MT5 contract suffix 'c' (BTCUSD → BTCUSD) before splitting
    const s = sym.endsWith('c') ? sym.slice(0, -1) : sym;
    for (const q of ['USDT', 'USDC', 'USD', 'BTC', 'ETH', 'BNB', 'EUR', 'GBP']) {
        if (s.endsWith(q)) return { base: s.slice(0, -q.length), quote: q };
    }
    return { base: sym, quote: '' };
}

export default function Watchlist() {
    const { symbol: currentSymbol, setSymbol } = useMarketStore();
    const { locale, copy } = useAppLocale();
    const [summaries, setSummaries] = useState<MarketSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [priceGlow, setPriceGlow] = useState<Record<string, 'up' | 'down' | null>>({});
    const summariesRef = useRef<MarketSummary[]>([]);
    const subscriptionKey = summaries.map((summary) => summary.symbol).join("|");

    useEffect(() => {
        summariesRef.current = summaries;
    }, [summaries]);

    useEffect(() => {
        // Fetch initial market summaries
        const fetchSummaries = async () => {
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
                const response = await fetch(`${apiUrl}/api/market-summary`);
                if (response.ok) {
                    const data = await response.json();
                    setSummaries(data);
                }
            } catch (error) {
                console.error("Failed to fetch market summaries", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSummaries();
    }, []);

    useEffect(() => {
        const subscriptionSymbols = subscriptionKey ? subscriptionKey.split("|") : [];
        if (subscriptionSymbols.length === 0) return;

        // Establish socket connection for real-time `1d` tick updates
        const socketUrl = resolveSocketUrl();
        const socket: Socket = io(socketUrl, {
            withCredentials: true,
        });
        socket.on('connect', () => {
            subscriptionSymbols.forEach((symbol) => {
                socket.emit('subscribe', { symbol, timeframe: '1d' });
            });
        });

        socket.on('tick', (data: MarketTickPayload) => {
            setPriceGlow(prev => ({
                ...prev,
                [data.s]: data.close > (summariesRef.current.find((summary) => summary.symbol === data.s)?.lastPrice || 0) ? 'up' : 'down'
            }));

            // Revert glow after 500ms
            setTimeout(() => {
                setPriceGlow(prev => ({ ...prev, [data.s]: null }));
            }, 500);

            // Update the corresponding symbol in the summaries array
            setSummaries((prev) => prev.map((item) => {
                if (item.symbol.toLowerCase() === data.s.toLowerCase()) {
                    const lastPrice = data.close;
                    const changePercent = ((data.close - data.open) / data.open) * 100;

                    // Update sparkline with latest price
                    const newSparkline = [...(item.sparkline || [])];
                    if (newSparkline.length > 0) {
                        newSparkline[newSparkline.length - 1] = lastPrice;
                    }

                    return {
                        ...item,
                        lastPrice,
                        changePercent,
                        highPrice: Math.max(item.highPrice, data.high),
                        lowPrice: Math.min(item.lowPrice, data.low),
                        volume: item.volume + data.volume,
                        sparkline: newSparkline
                    };
                }
                return item;
            }));
        });

        return () => {
            subscriptionSymbols.forEach((symbol) => {
                socket.emit('unsubscribe', { symbol, timeframe: '1d' });
            });
            socket.disconnect();
        };
    }, [subscriptionKey]); // Reconnect only when the symbol set changes.

    if (isLoading) {
        return (
            <div className="w-full text-center mt-8 space-y-3">
                <div className="h-10 bg-bg-tertiary animate-pulse rounded-md" />
                <div className="h-10 bg-bg-tertiary animate-pulse rounded-md" />
            </div>
        );
    }

    if (summaries.length === 0) {
        return <p className="text-text-muted text-xs italic mt-8 text-center">{copy.watchlist.empty}</p>;
    }

    return (
        <div className="w-full mt-4 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
            {summaries.map((s) => {
                const isPositive = s.changePercent >= 0;
                const isSelected = currentSymbol === s.symbol;

                const glowType = priceGlow[s.symbol];
                const glowClass = glowType === 'up' ? 'bg-price-up/16 border-price-up/30' : glowType === 'down' ? 'bg-semantic-error/20 border-semantic-error/30' : '';

                return (
                    <div
                        key={s.symbol}
                        onClick={() => setSymbol(s.symbol)}
                        className={`flex items-center justify-between p-2.5 rounded-md cursor-pointer transition-all border border-transparent 
                            ${isSelected ? 'bg-bg-tertiary border-border-muted shadow-sm' : 'hover:bg-bg-tertiary hover:border-border-muted/50'} ${glowClass}`}
                    >
                        <div className="flex flex-col min-w-[70px]">
                            <span className="font-bold text-sm text-text-primary tracking-wide">
                                {splitSymbol(s.symbol).base}{' '}
                                <span className="text-[10px] text-text-muted font-normal">{splitSymbol(s.symbol).quote}</span>
                            </span>
                            <span className="text-[10px] text-text-muted">
                                {copy.watchlist.volumePrefix} {s.volume > 1e6
                                    ? formatCompactNumberForLocale(s.volume, locale)
                                    : formatNumberForLocale(s.volume, locale, { maximumFractionDigits: 0 })}
                            </span>
                        </div>

                        {s.sparkline && (
                            <div className="flex-1 px-4 opacity-70">
                                <Sparkline data={s.sparkline} isUp={isPositive} width={80} height={20} />
                            </div>
                        )}

                        <div className="flex flex-col items-end min-w-[80px]">
                            <span className={`font-mono font-medium text-sm transition-colors duration-300 ${glowType === 'up' ? 'text-price-up shadow-[0_0_10px_rgba(44,166,164,0.34)]' : glowType === 'down' ? 'text-semantic-error shadow-[0_0_10px_rgba(216,96,96,0.34)]' : (isPositive ? 'text-price-up' : 'text-semantic-error')}`}>
                                {formatNumberForLocale(s.lastPrice, locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                            </span>
                            <div className={`flex items-center gap-1 text-[11px] font-medium ${isPositive ? 'text-price-up' : 'text-semantic-error'}`}>
                                {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                <span>{formatPercentForLocale(Math.abs(s.changePercent), locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
