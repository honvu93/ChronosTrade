"use client";

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';

interface TickerItem {
    symbol: string;
    price: string;
    change: string;
    isUp: boolean;
    volume: string;
}

export default function TickerTape() {
    const [tickers, setTickers] = useState<TickerItem[]>([]);

    useEffect(() => {
        const fetchTickers = async () => {
            try {
                // In a real app, this would be specialized endpoint for all market summaries
                // For now, we'll fetch a baseline set of major pairs
                const majors = ['BTCUSD', 'XAUUSD', 'XAGUSD'];
                const results = await Promise.all(
                    majors.map(async (s) => {
                        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
                        const res = await fetch(`${apiUrl}/api/ohlcv/${s}?limit=2`);
                        const data = await res.json();
                        if (data.length >= 2) {
                            const current = data[data.length - 1];
                            const prev = data[data.length - 2];
                            const change = ((current.close - prev.close) / prev.close) * 100;
                            return {
                                symbol: s,
                                price: current.close.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                                change: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
                                isUp: change >= 0,
                                volume: current.volume.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                            };
                        }
                        return null;
                    })
                );
                setTickers(results.filter((t): t is TickerItem => t !== null));
            } catch (error) {
                console.error('Failed to fetch ticker data:', error);
            }
        };

        fetchTickers();
        const interval = setInterval(fetchTickers, 30000); // Update every 30s
        return () => clearInterval(interval);
    }, []);

    if (tickers.length === 0) return null;

    // Duplicate for seamless loop
    const displayItems = [...tickers, ...tickers, ...tickers];

    return (
        <footer className="h-8 w-full bg-bg-secondary/80 backdrop-blur-md border-t border-border-muted flex items-center overflow-hidden z-20">
            <div className="flex items-center py-1 overflow-hidden">
                <motion.div
                    className="flex items-center gap-12 px-6 whitespace-nowrap"
                    animate={{ x: [0, -tickers.length * 200] }}
                    transition={{
                        duration: tickers.length * 5,
                        repeat: Infinity,
                        ease: "linear"
                    }}
                >
                    {displayItems.map((item, idx) => (
                        <div key={`${item.symbol}-${idx}`} className="flex items-center gap-4 text-xs font-medium">
                            <span className="text-text-primary font-bold">{item.symbol}</span>
                            <span className="text-text-secondary font-mono">{item.price}</span>
                            <div className={`flex items-center gap-1 font-bold ${item.isUp ? 'text-accent' : 'text-error'}`}>
                                {item.isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                <span>{item.change}</span>
                            </div>
                            <span className="text-[10px] text-text-muted">Vol: {item.volume}</span>
                        </div>
                    ))}
                </motion.div>
            </div>
        </footer>
    );
}
