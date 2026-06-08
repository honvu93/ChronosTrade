"use client";

import React, { useEffect, useState } from 'react';
import { Database, Clock, CalendarDays, RefreshCw } from 'lucide-react';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useAppLocale } from '@/hooks/useAppLocale';
import { formatDateTimeForLocale, formatNumberForLocale } from '@/lib/localeFormatting';
import { useMarketStore } from '@/store/useMarketStore';

interface SyncStats {
    symbol: string;
    timeframe: string;
    oldest: string | null;
    latest: string | null;
    totalCandles: number;
}

export default function SyncStatus() {
    const { isAdmin } = useAuthSession();
    const { symbol, timeframe } = useMarketStore();
    const { locale, copy } = useAppLocale();
    const [stats, setStats] = useState<SyncStats | null>(null);
    const [isPolling, setIsPolling] = useState(false);

    useEffect(() => {
        if (!isAdmin) {
            setStats(null);
            setIsPolling(false);
            return;
        }

        let mounted = true;

        const fetchStats = async () => {
            try {
                setIsPolling(true);
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
                const response = await fetch(`${apiUrl}/api/sync-status/${symbol}?timeframe=${timeframe}`);
                const data = await response.json();
                if (mounted) {
                    setStats(data);
                }
            } catch (error) {
                console.error("Failed to fetch sync status:", error);
            } finally {
                if (mounted) setIsPolling(false);
            }
        };

        // Fetch immediately on mount and whenever symbol/timeframe changes.
        fetchStats();

        // Keep polling every 3 seconds.
        const interval = setInterval(fetchStats, 3000);

        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [isAdmin, symbol, timeframe]);

    if (!isAdmin || !stats) return null;

    const formatDate = (dateStr: string | null) => {
        return formatDateTimeForLocale(dateStr, locale, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }, copy.syncStatus.unavailable);
    };

    return (
        <div className="flex items-center gap-4 px-3 py-1.5 bg-bg-secondary/50 backdrop-blur-md border border-border-muted rounded-lg text-[11px] font-mono select-none">
            <div className="flex items-center gap-1.5 text-text-secondary">
                <Database size={12} className={isPolling ? "text-accent" : ""} />
                <span className="font-bold text-text-primary">
                    {formatNumberForLocale(stats?.totalCandles ?? 0, locale)} <span className="text-text-muted font-normal">{copy.syncStatus.candles}</span>
                </span>

                {/* Keep the spinner subtle during background polling. */}
                {isPolling && <RefreshCw size={10} className="animate-spin text-accent/50 ml-1" />}
            </div>

            <div className="w-px h-3 bg-border-muted"></div>

            <div className="flex items-center gap-1.5 text-text-secondary" title={copy.syncStatus.oldestData}>
                <CalendarDays size={12} className="text-price-down" />
                <span>{formatDate(stats.oldest)}</span>
            </div>

            <div className="flex items-center gap-1.5 text-text-secondary" title={copy.syncStatus.latestData}>
                <Clock size={12} className="text-price-up" />
                <span>{formatDate(stats.latest)}</span>
            </div>
        </div>
    );
}
