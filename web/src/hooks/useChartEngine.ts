"use client";

import { useRef, useState, useCallback } from 'react';
import {
    createChart,
    IChartApi,
    IRange,
    ISeriesApi,
    SeriesType as LWCSeriesType,
    Time,
    ColorType,
    CrosshairMode,
    CandlestickSeries,
    HistogramSeries,
    LineSeries
} from 'lightweight-charts';

export interface ChartOptions {
    container: HTMLDivElement;
    width: number;
    height: number;
}

export function useChartEngine() {
    const chartRef = useRef<IChartApi | null>(null);
    const [chartInstance, setChartInstance] = useState<IChartApi | null>(null);
    const seriesRef = useRef<Map<string, ISeriesApi<LWCSeriesType>>>(new Map());
    const [isReady, setIsReady] = useState(false);

    const initChart = useCallback((options: ChartOptions) => {
        if (chartRef.current) return;

        const chart = createChart(options.container, {
            width: options.width,
            height: options.height,
            layout: {
                background: { type: ColorType.Solid, color: '#0D1117' },
                textColor: '#8B949E',
            },
            grid: {
                vertLines: { color: 'rgba(48, 54, 61, 0.05)' },
                horzLines: { color: 'rgba(48, 54, 61, 0.05)' },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    color: '#8B949E',
                    width: 1,
                    style: 3,
                    labelBackgroundColor: '#161B22',
                },
                horzLine: {
                    color: '#8B949E',
                    width: 1,
                    style: 3,
                    labelBackgroundColor: '#161B22',
                },
            },
            rightPriceScale: {
                borderColor: '#30363D',
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                },
            },
            timeScale: {
                borderColor: '#30363D',
                timeVisible: true,
                secondsVisible: false,
            },
        });

        // Handle paneLayout separately to bypass type issues in some versions
        (chart as any).applyOptions({
            paneLayout: {
                heights: [0.8, 0.2],
            },
        });

        chartRef.current = chart;
        setChartInstance(chart);
        setIsReady(true);

        return () => {
            chart.remove();
            chartRef.current = null;
            setChartInstance(null);
            seriesRef.current.clear();
            setIsReady(false);
        };
    }, []);

    const addCandlestickSeries = useCallback((id: string, options: any = {}) => {
        if (!chartRef.current) return;
        const { pane, ...seriesOptions } = options;
        const series = chartRef.current.addSeries(CandlestickSeries, {
            upColor: '#26C870',
            downColor: '#F6465D',
            borderVisible: false,
            wickUpColor: '#26C870',
            wickDownColor: '#F6465D',
            ...seriesOptions,
        }, pane);
        seriesRef.current.set(id, series);
        return series;
    }, []);

    const addHistogramSeries = useCallback((id: string, options: any = {}) => {
        if (!chartRef.current) return;
        const { pane, ...seriesOptions } = options;
        const series = chartRef.current.addSeries(HistogramSeries, {
            color: '#26a69a',
            priceFormat: {
                type: 'volume',
            },
            ...seriesOptions,
        }, pane);
        seriesRef.current.set(id, series);
        return series;
    }, []);

    const addLineSeries = useCallback((id: string, options: any = {}) => {
        if (!chartRef.current) return;
        const { pane, ...seriesOptions } = options;
        const series = chartRef.current.addSeries(LineSeries, {
            color: '#2962FF',
            lineWidth: 2,
            ...seriesOptions,
        }, pane);
        seriesRef.current.set(id, series);
        return series;
    }, []);

    const setSeriesData = useCallback((id: string, data: any[]) => {
        const series = seriesRef.current.get(id);
        if (series) {
            series.setData(data);
        }
    }, []);

    const updateSeriesData = useCallback((id: string, data: any) => {
        const series = seriesRef.current.get(id);
        if (series) {
            series.update(data);
        }
    }, []);

    const applySeriesOptions = useCallback((id: string, options: any) => {
        const series = seriesRef.current.get(id);
        if (series) {
            series.applyOptions(options);
        }
    }, []);

    const setSeriesVisibility = useCallback((id: string, isVisible: boolean) => {
        const series = seriesRef.current.get(id);
        if (series) {
            series.applyOptions({ visible: isVisible });
        }
    }, []);

    const setPaneHeights = useCallback((heights: number[]) => {
        if (chartRef.current) {
            (chartRef.current as any).applyOptions({
                paneLayout: {
                    heights,
                },
            });
        }
    }, []);

    const subscribeCrosshairMove = useCallback((param: any) => {
        if (chartRef.current) {
            chartRef.current.subscribeCrosshairMove(param);
        }
        const currentChart = chartRef.current;
        return () => currentChart?.unsubscribeCrosshairMove(param);
    }, []);

    const subscribeClick = useCallback((param: any) => {
        if (chartRef.current) {
            chartRef.current.subscribeClick(param);
        }
        const currentChart = chartRef.current;
        return () => currentChart?.unsubscribeClick(param);
    }, []);

    const subscribeVisibleLogicalRangeChange = useCallback((callback: (logicalRange: any) => void) => {
        if (!chartRef.current) return () => { };

        const timeScale = chartRef.current.timeScale();
        timeScale.subscribeVisibleLogicalRangeChange(callback);

        return () => timeScale.unsubscribeVisibleLogicalRangeChange(callback);
    }, []);

    const subscribeVisibleTimeRangeChange = useCallback((callback: (timeRange: IRange<Time> | null) => void) => {
        if (!chartRef.current) return () => { };

        const timeScale = chartRef.current.timeScale();
        timeScale.subscribeVisibleTimeRangeChange(callback);

        return () => timeScale.unsubscribeVisibleTimeRangeChange(callback);
    }, []);

    const getVisibleRange = useCallback(() => {
        if (!chartRef.current) return null;
        return chartRef.current.timeScale().getVisibleRange();
    }, []);

    const setVisibleRange = useCallback((range: IRange<Time>) => {
        if (!chartRef.current) return;
        chartRef.current.timeScale().setVisibleRange(range);
    }, []);

    const timeToCoordinate = useCallback((time: Time) => {
        if (!chartRef.current) return null;
        return chartRef.current.timeScale().timeToCoordinate(time);
    }, []);

    const resize = useCallback((width: number, height: number) => {
        if (chartRef.current) {
            chartRef.current.applyOptions({ width, height });
        }
    }, []);

    return {
        chart: chartInstance,
        seriesRef,
        isReady,
        initChart,
        addCandlestickSeries,
        addHistogramSeries,
        addLineSeries,
        setSeriesData,
        updateSeriesData,
        applySeriesOptions,
        setSeriesVisibility,
        setPaneHeights,
        subscribeCrosshairMove,
        subscribeClick,
        subscribeVisibleLogicalRangeChange,
        subscribeVisibleTimeRangeChange,
        getVisibleRange,
        setVisibleRange,
        timeToCoordinate,
        resize,
    } as const;
}

export type ChartEngine = ReturnType<typeof useChartEngine>;
