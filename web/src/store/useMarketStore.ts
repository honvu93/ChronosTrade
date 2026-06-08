"use client";

import { create } from 'zustand';

interface MarketState {
    symbol: string;
    timeframe: string;
    setSymbol: (symbol: string) => void;
    setTimeframe: (timeframe: string) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
    symbol: 'BTCUSD',
    timeframe: '1m',
    setSymbol: (symbol) => set({ symbol }),
    setTimeframe: (timeframe) => set({ timeframe }),
}));
