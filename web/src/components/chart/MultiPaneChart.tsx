"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useChartEngine } from '@/hooks/useChartEngine';
import ChartLegend, { LegendData } from './ChartLegend';
import {
    UTCTimestamp,
    CandlestickData,
    createSeriesMarkers,
    ISeriesApi,
    ISeriesMarkersPluginApi,
    MouseEventParams,
    SeriesMarker,
    SeriesType,
    Time,
} from 'lightweight-charts';
import { calculateSMA, calculateRSI, calculateEMA, calculateWMA } from '@/lib/indicators';
import { GripHorizontal, RefreshCw } from 'lucide-react';
import { useIndicatorOverlays } from '@/hooks/useIndicatorOverlays';
import { useMarketStore } from '@/store/useMarketStore';
import ChartStatusBar from './ChartStatusBar';
import { DateTime } from 'luxon';
import { EngineAnnotation } from '@/types/engine';
import { IndicatorEvent } from '@/types/signals';
import { getTimeframeMs } from '@/lib/freshnessUtils';
import { toChartTimestamp, shiftToDisplayTz, shiftToUtc, DISPLAY_TIMEZONE } from '@/lib/chartTimezone';

interface MultiPaneChartProps {
    annotations?: EngineAnnotation[];
    rangeStart?: string | null;
    rangeEnd?: string | null;
    showSessionShading?: boolean;
    indicatorEvents?: IndicatorEvent[];
    onMarkerClick?: (eventId: string) => void;
    focusedSignalId?: string | null;
}

interface ChartBar {
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

interface SessionShadeBlock {
    key: string;
    label: 'ASIAN' | 'LONDON' | 'NY';
    left: number;
    width: number;
    color: string;
    edge: string;
}

const SESSION_CONFIG = [
    { label: 'ASIAN' as const, startHour: 0, endHour: 8, color: 'rgba(24, 58, 109, 0.16)', edge: 'rgba(76, 152, 255, 0.16)' },
    { label: 'LONDON' as const, startHour: 8, endHour: 13, color: 'rgba(18, 92, 86, 0.14)', edge: 'rgba(38, 200, 112, 0.14)' },
    { label: 'NY' as const, startHour: 13, endHour: 22, color: 'rgba(110, 32, 86, 0.14)', edge: 'rgba(240, 185, 11, 0.14)' },
];
function getTimeframeSeconds(value: string): number {
    return Math.max(Math.floor(getTimeframeMs(value) / 1000), 60);
}

export default function MultiPaneChart({
    annotations = [],
    rangeStart = null,
    rangeEnd = null,
    showSessionShading = false,
    indicatorEvents = [],
    onMarkerClick,
    focusedSignalId = null,
}: MultiPaneChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
    const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const priceLinesRef = useRef<ReturnType<ISeriesApi<SeriesType>['createPriceLine']>[]>([]);
    const chartInitialized = useRef(false);
    const engineRef = useRef<ReturnType<typeof useChartEngine> | null>(null);
    const { symbol, timeframe } = useMarketStore();
    const [isLoading, setIsLoading] = useState(false);

    const engine = useChartEngine();
    engineRef.current = engine;

    const [legendData, setLegendData] = useState<LegendData>({
        symbol,
        timeframe,
        open: '-',
        high: '-',
        low: '-',
        close: '-',
        change: '-',
        isUp: true,
    });

    const { visibility: indicatorVisibility } = useIndicatorOverlays();

    const [paneHeights, setPaneHeightsState] = useState([0.8, 0.2]);
    const [sessionShadeBlocks, setSessionShadeBlocks] = useState<SessionShadeBlock[]>([]);
    const isDragging = useRef<number | null>(null);
    const focusedViewportKeyRef = useRef<string | null>(null);
    const [dataRevision, setDataRevision] = useState(0);

    const getEventColor = (type: string) => {
        switch (type) {
            case 'ENTRY':
            case 'ENTRY_CONFIRMED': return '#F0B90B'; // Gold
            case 'TP1_HIT':
            case 'TP2_HIT':
            case 'COMPLETE_Y': return '#26C870'; // Green
            case 'STOP_HIT':
            case 'FAIL': return '#F6465D'; // Red
            case 'MOVE_SL_BE':
            case 'TRAIL_START': return '#34A853'; // Different Green
            default: return '#BBBBBB';
        }
    };

    const getEventShape = (type: string, isLong: boolean) => {
        if (type === 'ENTRY' || type === 'ENTRY_CONFIRMED') {
            return isLong ? 'arrowUp' as const : 'arrowDown' as const;
        }
        return 'circle' as const;
    };

    const buildMarkers = useCallback((): SeriesMarker<Time>[] => {
        const backtestMarkers: SeriesMarker<Time>[] = annotations.map((annotation) => {
            const isFocused = focusedSignalId === annotation.signalId;

            return {
                time: toChartTimestamp(annotation.entryTime),
                position: annotation.side === 'LONG' ? 'belowBar' as const : 'aboveBar' as const,
                color: isFocused ? '#F0B90B' : annotation.isOpen ? '#F0B90B' : annotation.win ? '#26C870' : '#F6465D',
                shape: annotation.side === 'LONG' ? 'arrowUp' as const : 'arrowDown' as const,
                text: isFocused ? `FOCUS ${annotation.label}` : annotation.label,
                price: annotation.entryPrice,
                id: `backtest-${annotation.signalId}`,
            };
        });

        const indicatorMarkers: SeriesMarker<Time>[] = indicatorEvents.map((event) => {
            const isLong = event.metaJson?.side === 'LONG' || event.label?.includes('LONG');
            return {
                time: toChartTimestamp(event.candleTime),
                position: isLong ? 'belowBar' as const : 'aboveBar' as const,
                color: getEventColor(event.eventType),
                shape: getEventShape(event.eventType, isLong ?? false),
                text: event.label || event.eventType,
                id: event.id,
            };
        });

        return [...backtestMarkers, ...indicatorMarkers];
    }, [annotations, focusedSignalId, indicatorEvents]);

    // Sync indicator visibility from store to chart engine whenever it changes
    useEffect(() => {
        if (!chartInitialized.current) return;
        Object.entries(indicatorVisibility).forEach(([id, visible]) => {
            engineRef.current?.setSeriesVisibility(id, visible);
        });
    }, [indicatorVisibility]);

    const updateLegendFromCandle = (candle: Pick<ChartBar, 'open' | 'high' | 'low' | 'close'>) => {
        const change = ((candle.close - candle.open) / candle.open) * 100;
        setLegendData({
            symbol: useMarketStore.getState().symbol,
            timeframe: useMarketStore.getState().timeframe,
            open: candle.open.toLocaleString(undefined, { minimumFractionDigits: 2 }),
            high: candle.high.toLocaleString(undefined, { minimumFractionDigits: 2 }),
            low: candle.low.toLocaleString(undefined, { minimumFractionDigits: 2 }),
            close: candle.close.toLocaleString(undefined, { minimumFractionDigits: 2 }),
            change: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
            isUp: candle.close >= candle.open,
        });
    };

    const updateSessionShading = useCallback(() => {
        if (!showSessionShading || !engineRef.current || !containerRef.current || fullDataRef.current.length === 0) {
            setSessionShadeBlocks([]);
            return;
        }

        const visibleRange = engineRef.current.getVisibleRange();
        const firstVisible = visibleRange?.from ? Number(visibleRange.from) : Number(fullDataRef.current[0]?.time);
        const lastVisible = visibleRange?.to
            ? Number(visibleRange.to)
            : Number(fullDataRef.current[fullDataRef.current.length - 1]?.time);

        if (!Number.isFinite(firstVisible) || !Number.isFinite(lastVisible)) {
            setSessionShadeBlocks([]);
            return;
        }

        const chartWidth = containerRef.current.clientWidth;
        // Convert display-tz chart seconds back to real UTC for session calculations
        const firstUtc = shiftToUtc(firstVisible);
        const lastUtc = shiftToUtc(lastVisible);
        const startDate = new Date(firstUtc * 1000);
        const endDate = new Date(lastUtc * 1000);
        const firstDay = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
        const lastDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
        const nextBlocks: SessionShadeBlock[] = [];

        for (let day = firstDay - 24 * 60 * 60 * 1000; day <= lastDay + 24 * 60 * 60 * 1000; day += 24 * 60 * 60 * 1000) {
            for (const session of SESSION_CONFIG) {
                // Session hours are in UTC — shift to display timezone for chart coordinates
                const startSeconds = Math.floor((day + session.startHour * 60 * 60 * 1000) / 1000);
                const endSeconds = Math.floor((day + session.endHour * 60 * 60 * 1000) / 1000);

                if (endSeconds <= firstUtc || startSeconds >= lastUtc) {
                    continue;
                }

                const leftCoordinate = engineRef.current.timeToCoordinate(shiftToDisplayTz(startSeconds));
                const rightCoordinate = engineRef.current.timeToCoordinate(shiftToDisplayTz(endSeconds));

                const left = leftCoordinate ?? 0;
                const right = rightCoordinate ?? chartWidth;
                const width = Math.max(1, right - left);

                if (width < 2) {
                    continue;
                }

                nextBlocks.push({
                    key: `${session.label}-${startSeconds}`,
                    label: session.label,
                    left: Math.max(0, left),
                    width: Math.min(chartWidth, width),
                    color: session.color,
                    edge: session.edge,
                });
            }
        }

        setSessionShadeBlocks(nextBlocks);
    }, [showSessionShading]);

    // Initialize chart ONCE
    useEffect(() => {
        if (!containerRef.current || chartInitialized.current) return;
        chartInitialized.current = true;

        const e = engineRef.current!;

        const cleanup = e.initChart({
            container: containerRef.current,
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
        });

        const mainSeries = e.addCandlestickSeries('main');
        if (!mainSeries) return cleanup?.();
        seriesRef.current = mainSeries;
        markersRef.current = createSeriesMarkers(mainSeries);

        const rsiSeries = e.addLineSeries('rsi', {
            pane: 1,
            color: '#B23AEE', // Purple
            priceScaleId: 'rsi',
            priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
            title: 'RSI (14)',
        });

        if (rsiSeries) {
            // Add RSI Levels
            rsiSeries.createPriceLine({
                price: 70,
                color: 'rgba(255, 255, 255, 0.2)',
                lineWidth: 1,
                lineStyle: 1, // Dotted
                axisLabelVisible: true,
                title: '70',
            });
            rsiSeries.createPriceLine({
                price: 50,
                color: 'rgba(255, 255, 255, 0.1)',
                lineWidth: 1,
                lineStyle: 1, // Dotted
                axisLabelVisible: true,
                title: '50',
            });
            rsiSeries.createPriceLine({
                price: 30,
                color: 'rgba(255, 255, 255, 0.2)',
                lineWidth: 1,
                lineStyle: 1, // Dotted
                axisLabelVisible: true,
                title: '30',
            });
        }

        e.addLineSeries('rsi_ema9', {
            pane: 1,
            color: '#F0B90B', // Yellow
            priceScaleId: 'rsi',
            lineWidth: 1,
            title: 'RSI EMA (9)',
            lastValueVisible: false, // Avoid overlap
        });

        e.addLineSeries('rsi_wma45', {
            pane: 1,
            color: '#26C870', // Green
            priceScaleId: 'rsi',
            lineWidth: 1,
            title: 'RSI WMA (45)',
            lastValueVisible: false, // Avoid overlap
        });

        // SMA overlays on the main price pane (pane 0)
        e.addLineSeries('sma20', {
            color: '#2196F3', // Blue
            lineWidth: 1,
            title: 'SMA (20)',
            visible: false, // Start hidden; controlled by useIndicatorOverlays
        });
        e.addLineSeries('sma50', {
            color: '#FF9800', // Amber
            lineWidth: 1,
            title: 'SMA (50)',
            visible: false,
        });
        e.addLineSeries('sma200', {
            color: '#F44336', // Red
            lineWidth: 1,
            title: 'SMA (200)',
            visible: false,
        });

        // Apply initial visibility from store (RSI overlays start visible; SMAs start hidden)
        const initialVisibility = useIndicatorOverlays.getState().visibility;
        Object.entries(initialVisibility).forEach(([id, visible]) => {
            e.setSeriesVisibility(id, visible);
        });

        e.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
            if (!param.point || !seriesRef.current) return;
            const data = param.seriesData.get(seriesRef.current);
            if (data) {
                const { open, high, low, close } = data as CandlestickData;
                const change = ((close - open) / open) * 100;
                setLegendData({
                    symbol: useMarketStore.getState().symbol,
                    timeframe: useMarketStore.getState().timeframe,
                    open: open.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                    high: high.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                    low: low.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                    close: close.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                    change: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
                    isUp: close >= open,
                });
            }
        });

        // Handle Marker Clicks
        e.subscribeClick((param: MouseEventParams<Time>) => {
            if (!param.point || !onMarkerClick) return;

            if (param.hoveredObjectId) {
                const markerId = param.hoveredObjectId as string;
                onMarkerClick(markerId);
            }
        });

        const resizeObserver = new ResizeObserver((entries) => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                engineRef.current?.resize(width, height);
                updateSessionShading();
            }
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            cleanup?.();
            resizeObserver.disconnect();
            try {
                markersRef.current?.detach();
            } catch { /* ignore disposed */ }
            markersRef.current = null;
            chartInitialized.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [updateSessionShading]);

    useEffect(() => {
        if (!chartInitialized.current || !markersRef.current) return;
        markersRef.current.setMarkers(buildMarkers());

        // --- Handle Price Lines (Entry/TP/SL) ---
        if (!seriesRef.current || !chartInitialized.current) return;

        // Cleanup old lines
        priceLinesRef.current.forEach(line => {
            if (seriesRef.current) {
                try { seriesRef.current.removePriceLine(line); } catch { /* ignore disconnected */ }
            }
        });
        priceLinesRef.current = [];

        // Find the most recent ENTRY/SIGNAL event that has levels
        const latestEntry = [...indicatorEvents]
            .reverse()
            .find(e => (e.eventType === 'ENTRY' || e.eventType === 'SIGNAL') && e.metaJson?.tp1);

        if (latestEntry && latestEntry.metaJson) {
            const { tp1, sl, entryPrice } = latestEntry.metaJson;
            const price = ((entryPrice as number) || latestEntry.price) as number;

            // Entry Line
            const entryLine = seriesRef.current.createPriceLine({
                price,
                color: '#F0B90B',
                lineWidth: 2,
                lineStyle: 0, // Solid
                axisLabelVisible: true,
                title: 'ENTRY',
            });
            priceLinesRef.current.push(entryLine);

            // TP1 Line
            if (tp1) {
                const tp1Line = seriesRef.current.createPriceLine({
                    price: tp1 as number,
                    color: '#26C870',
                    lineWidth: 1,
                    lineStyle: 1, // Dotted
                    axisLabelVisible: true,
                    title: 'TP1',
                });
                priceLinesRef.current.push(tp1Line);
            }

            // SL Line
            if (sl) {
                const slLine = seriesRef.current.createPriceLine({
                    price: sl as number,
                    color: '#F6465D',
                    lineWidth: 1,
                    lineStyle: 1, // Dotted
                    axisLabelVisible: true,
                    title: 'SL',
                });
                priceLinesRef.current.push(slLine);
            }
        }
    }, [annotations, buildMarkers, focusedSignalId, indicatorEvents]);

    useEffect(() => {
        if (!chartInitialized.current || !focusedSignalId || !engineRef.current || fullDataRef.current.length === 0) {
            focusedViewportKeyRef.current = null;
            return;
        }

        const focusedAnnotation = annotations.find((annotation) => annotation.signalId === focusedSignalId);
        if (!focusedAnnotation) {
            return;
        }

        const entrySeconds = toChartTimestamp(focusedAnnotation.entryTime) as number;
        const exitSeconds = focusedAnnotation.exitTime
            ? toChartTimestamp(focusedAnnotation.exitTime) as number
            : entrySeconds;

        if (!Number.isFinite(entrySeconds) || !Number.isFinite(exitSeconds)) {
            return;
        }

        const timeframeSeconds = getTimeframeSeconds(focusedAnnotation.timeframe || timeframe);
        const paddingBars = focusedAnnotation.exitTime ? 12 : 24;
        const minimumSpanBars = 48;
        const spanSeconds = Math.max(
            timeframeSeconds * minimumSpanBars,
            Math.abs(exitSeconds - entrySeconds) + timeframeSeconds * paddingBars * 2,
        );

        const midpointSeconds = Math.floor((entrySeconds + exitSeconds) / 2);
        const fromSeconds = Math.max(0, midpointSeconds - Math.floor(spanSeconds / 2));
        const toSeconds = midpointSeconds + Math.floor(spanSeconds / 2);
        const viewportKey = `${focusedSignalId}:${fromSeconds}:${toSeconds}`;

        if (focusedViewportKeyRef.current === viewportKey) {
            return;
        }

        engineRef.current.setVisibleRange({
            from: fromSeconds as UTCTimestamp,
            to: toSeconds as UTCTimestamp,
        });
        focusedViewportKeyRef.current = viewportKey;
    }, [annotations, dataRevision, focusedSignalId, timeframe]);

    useEffect(() => {
        if (!showSessionShading || !chartInitialized.current) {
            setSessionShadeBlocks([]);
            return;
        }

        const unsubscribe = engineRef.current?.subscribeVisibleTimeRangeChange(() => {
            updateSessionShading();
        });

        updateSessionShading();

        return () => {
            unsubscribe?.();
        };
    }, [showSessionShading, symbol, timeframe, updateSessionShading]);

    // Store current full data locally so we can prepend to it
    const fullDataRef = useRef<ChartBar[]>([]);
    const oldestTimestampRef = useRef<number | null>(null);
    const hasMoreHistoryRef = useRef<boolean>(true);
    const [mounted, setMounted] = useState(false);
    const [currentTime, setCurrentTime] = useState<Date | null>(null);

    useEffect(() => {
        setMounted(true);
        setCurrentTime(new Date());
        const interval = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    // Fetch data when symbol/timeframe changes + poll for real-time updates
    useEffect(() => {
        if (!chartInitialized.current) return;
        if (!symbol) return;

        const hasExplicitRange = Boolean(rangeStart || rangeEnd);
        const abortController = new AbortController();

        const loadFullData = async () => {
            setIsLoading(true);
            hasMoreHistoryRef.current = !hasExplicitRange;
            oldestTimestampRef.current = null;

            // Clear existing data immediately to show loading state
            const e = engineRef.current!;
            e.setSeriesData('main', []);
            e.setSeriesData('rsi', []);
            e.setSeriesData('rsi_ema9', []);
            e.setSeriesData('rsi_wma45', []);
            e.setSeriesData('sma20', []);
            e.setSeriesData('sma50', []);
            e.setSeriesData('sma200', []);

            setLegendData(prev => ({ ...prev, symbol, timeframe, open: '-', high: '-', low: '-', close: '-', change: '-' }));

            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
                const params = new URLSearchParams({
                    timeframe,
                    limit: hasExplicitRange ? '5000' : '1000',
                });

                if (rangeStart) {
                    params.set('startTime', String(new Date(rangeStart).getTime()));
                }
                if (rangeEnd) {
                    params.set('endTime', String(new Date(rangeEnd).getTime()));
                }

                const response = await fetch(`${apiUrl}/api/ohlcv/${symbol}?${params}`, { signal: abortController.signal });
                const data = await response.json();

                if (Array.isArray(data) && data.length > 0) {
                    oldestTimestampRef.current = new Date(data[0].time).getTime(); // Store as number

                    if (hasExplicitRange || data.length < 1000) {
                        hasMoreHistoryRef.current = false; // we loaded everything there is
                    }

                    const formattedData = data.map((d: { time: string; open: string; high: string; low: string; close: string; volume: string }) => ({
                        ...d,
                        time: toChartTimestamp(d.time),
                        open: parseFloat(d.open),
                        high: parseFloat(d.high),
                        low: parseFloat(d.low),
                        close: parseFloat(d.close),
                        volume: parseFloat(d.volume),
                    })).sort((a, b) => a.time - b.time);

                    // Deduplicate
                    const uniqueData = Array.from(
                        new Map(formattedData.map(item => [item.time, item])).values()
                    );

                    fullDataRef.current = uniqueData;
                    e.setSeriesData('main', uniqueData);

                    const rsiData = calculateRSI(uniqueData, 14);
                    e.setSeriesData('rsi', rsiData);
                    e.setSeriesData('rsi_ema9', calculateEMA(rsiData, 9));
                    e.setSeriesData('rsi_wma45', calculateWMA(rsiData, 45));

                    e.setSeriesData('sma20', calculateSMA(uniqueData, 20));
                    e.setSeriesData('sma50', calculateSMA(uniqueData, 50));
                    e.setSeriesData('sma200', calculateSMA(uniqueData, 200));

                    updateLegendFromCandle(data[data.length - 1]);
                    updateSessionShading();
                    setDataRevision((current) => current + 1);
                } else {
                    console.warn(`No data returned for ${symbol} ${timeframe}`);
                    fullDataRef.current = [];
                    updateSessionShading();
                    setDataRevision((current) => current + 1);
                }
            } catch (error: unknown) {
                if (!(error instanceof Error) || error.name !== 'AbortError') {
                    console.error('Failed to fetch data:', error);
                }
            } finally {
                setIsLoading(false);
            }
        };

        const loadMoreData = async () => {
            if (hasExplicitRange || isLoading || !hasMoreHistoryRef.current || !oldestTimestampRef.current) return;
            setIsLoading(true);

            try {
                // Fetch older data
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
                const response = await fetch(`${apiUrl}/api/ohlcv/${symbol}?timeframe=${timeframe}&limit=1000&endTime=${oldestTimestampRef.current}`, { signal: abortController.signal });
                const olderData = await response.json();

                if (Array.isArray(olderData) && olderData.length > 0) {
                    // Update oldest timestamp
                    oldestTimestampRef.current = new Date(olderData[0].time).getTime();

                    if (olderData.length < 1000) {
                        hasMoreHistoryRef.current = false;
                    }

                    const formattedOlderData = olderData.map((d: { time: string; open: string; high: string; low: string; close: string; volume: string }) => ({
                        ...d,
                        time: toChartTimestamp(d.time),
                        open: parseFloat(d.open),
                        high: parseFloat(d.high),
                        low: parseFloat(d.low),
                        close: parseFloat(d.close),
                        volume: parseFloat(d.volume),
                    }));

                    // Prepend new older data and ensure strictly ascending order & uniqueness
                    const merged = [...formattedOlderData, ...fullDataRef.current].sort((a, b) => a.time - b.time);
                    // Deduplicate by time to prevent "Assertion failed: data must be asc ordered by time"
                    const uniqueData = Array.from(
                        new Map(merged.map(item => [item.time, item])).values()
                    );
                    fullDataRef.current = uniqueData;

                    const e = engineRef.current!;
                    e.setSeriesData('main', uniqueData);

                    const rsiData = calculateRSI(uniqueData, 14);
                    e.setSeriesData('rsi', rsiData);
                    e.setSeriesData('rsi_ema9', calculateEMA(rsiData, 9));
                    e.setSeriesData('rsi_wma45', calculateWMA(rsiData, 45));

                    e.setSeriesData('sma20', calculateSMA(uniqueData, 20));
                    e.setSeriesData('sma50', calculateSMA(uniqueData, 50));
                    e.setSeriesData('sma200', calculateSMA(uniqueData, 200));
                    updateSessionShading();
                    setDataRevision((current) => current + 1);
                } else {
                    hasMoreHistoryRef.current = false;
                }
            } catch (error) {
                console.error('Failed to fetch older data:', error);
            } finally {
                setIsLoading(false);
            }
        };

        // Pagination listener
        const unsubscribeVisibleLogicalRangeChange = engineRef.current?.subscribeVisibleLogicalRangeChange((logicalRange) => {
            if (logicalRange && logicalRange.from < 100) { // If user scrolls to the first 100 bars from the left edge
                loadMoreData();
            }
        });

        // Poll latest candles every 3 seconds for real-time updates
        const pollLatest = async () => {
            if (hasExplicitRange) return;
            if (!chartInitialized.current) return;
            try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
                const response = await fetch(`${apiUrl}/api/ohlcv/${symbol}?timeframe=${timeframe}&limit=5`);
                const data = await response.json();

                if (Array.isArray(data) && data.length > 0) {
                    const e = engineRef.current!;

                    // Update each of the latest candles (handles both open + recently closed)
                    for (const candle of data) {
                        const formattedCandle = {
                            ...candle,
                            time: toChartTimestamp(candle.time),
                            open: parseFloat(candle.open),
                            high: parseFloat(candle.high),
                            low: parseFloat(candle.low),
                            close: parseFloat(candle.close),
                            volume: parseFloat(candle.volume),
                        };
                        e.updateSeriesData('main', formattedCandle);

                        // Also update fullDataRef for indicators calculation
                        const existingIdx = fullDataRef.current.findIndex(c => c.time === formattedCandle.time);
                        if (existingIdx !== -1) {
                            fullDataRef.current[existingIdx] = formattedCandle;
                        } else {
                            fullDataRef.current.push(formattedCandle);
                        }
                    }

                    // Recalculate indicators for the tail end and update
                    const tailData = fullDataRef.current.slice(-500); // Increased for WMA 45 + RSI 14
                    const rsiData = calculateRSI(tailData, 14);
                    const rsiEma9 = calculateEMA(rsiData, 9);
                    const rsiWma45 = calculateWMA(rsiData, 45);

                    if (rsiData.length > 0) e.updateSeriesData('rsi', rsiData[rsiData.length - 1]);
                    if (rsiEma9.length > 0) e.updateSeriesData('rsi_ema9', rsiEma9[rsiEma9.length - 1]);
                    if (rsiWma45.length > 0) e.updateSeriesData('rsi_wma45', rsiWma45[rsiWma45.length - 1]);

                    const sma20Data = calculateSMA(tailData, 20);
                    const sma50Data = calculateSMA(tailData, 50);
                    const sma200Data = calculateSMA(tailData, 200);

                    if (sma20Data.length > 0) e.updateSeriesData('sma20', sma20Data[sma20Data.length - 1]);
                    if (sma50Data.length > 0) e.updateSeriesData('sma50', sma50Data[sma50Data.length - 1]);
                    if (sma200Data.length > 0) e.updateSeriesData('sma200', sma200Data[sma200Data.length - 1]);

                    updateLegendFromCandle(data[data.length - 1]);
                    updateSessionShading();
                }
            } catch {
                // Silently fail on poll errors
            }
        };

        loadFullData();
        const pollInterval = hasExplicitRange ? null : setInterval(pollLatest, 3000);

        return () => {
            abortController.abort();
            if (pollInterval) {
                clearInterval(pollInterval);
            }
            if (unsubscribeVisibleLogicalRangeChange) {
                unsubscribeVisibleLogicalRangeChange();
            }
        };
    }, [rangeEnd, rangeStart, symbol, timeframe, updateSessionShading]);

    const handleMouseDown = (index: number) => {
        isDragging.current = index;
        document.body.style.cursor = 'row-resize';
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging.current === null || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const relativeY = (e.clientY - rect.top) / rect.height;
            const newHeights = [...paneHeights];
            if (isDragging.current === 0) {
                const delta = relativeY - newHeights[0];
                if (newHeights[0] + delta > 0.2 && newHeights[1] - delta > 0.1) {
                    newHeights[0] += delta;
                    newHeights[1] -= delta;
                }
            }
            setPaneHeightsState(newHeights);
            engineRef.current?.setPaneHeights(newHeights);
        };

        const handleMouseUp = () => {
            isDragging.current = null;
            document.body.style.cursor = 'default';
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [paneHeights]);

    return (
        <div className="w-full h-full flex flex-col relative group bg-bg-primary overflow-hidden">
            {isLoading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg-primary/50 backdrop-blur-sm">
                    <RefreshCw className="w-8 h-8 text-accent animate-spin" />
                </div>
            )}

            <div className="absolute top-4 left-4 z-10 pointer-events-none">
                <ChartLegend data={legendData} />
            </div>

            <div
                className="absolute z-30 left-0 right-0 h-1 cursor-row-resize hover:bg-accent/30 transition-colors"
                style={{ top: `${paneHeights[0] * 100}%` }}
                onMouseDown={() => handleMouseDown(0)}
            >
                <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-border-muted rounded px-2 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripHorizontal size={12} className="text-text-muted" />
                </div>
            </div>

            <div className="relative flex-1 min-h-0">
                <div
                    className="pointer-events-none absolute inset-x-0 top-0 z-[1]"
                    style={{ height: `${paneHeights[0] * 100}%` }}
                >
                    {sessionShadeBlocks.map((block) => (
                        <div
                            key={block.key}
                            className="absolute top-0 h-full overflow-hidden border-x"
                            style={{
                                left: `${block.left}px`,
                                width: `${block.width}px`,
                                backgroundColor: block.color,
                                borderColor: block.edge,
                            }}
                        >
                            {block.width > 72 ? (
                                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
                                    {block.label}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
                <div ref={containerRef} className="h-full w-full" />
            </div>

            <ChartStatusBar
                candleCount={fullDataRef.current.length}
                startTime={fullDataRef.current.length > 0 ? DateTime.fromSeconds(shiftToUtc(Number(fullDataRef.current[0].time)), { zone: DISPLAY_TIMEZONE }).toFormat('HH:mm dd/MM/yyyy') : '-'}
                endTime={mounted && currentTime ? DateTime.fromJSDate(currentTime, { zone: DISPLAY_TIMEZONE }).toFormat('HH:mm dd/MM/yyyy') : '-'}
                isSynced={true}
                lastUpdated={mounted ? DateTime.now().toFormat('HH:mm:ss') : '-'}
            />
        </div>
    );
}
