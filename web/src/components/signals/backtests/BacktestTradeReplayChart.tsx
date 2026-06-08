"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    createSeriesMarkers,
    ISeriesMarkersPluginApi,
    SeriesMarker,
    Time,
    UTCTimestamp,
} from "lightweight-charts";
import { useChartEngine } from "@/hooks/useChartEngine";
import { sanitizeChartSeries } from "@/lib/chartSeriesSanitizer";
import { toChartTimestamp } from "@/lib/chartTimezone";
import {
    BacktestTradeReplayLevel,
    BacktestTradeReplayLinePoint,
    BacktestTradeReplayMarker,
    BacktestTradeReplayResponse,
    BacktestTradeReplaySessionRange,
} from "@/types/backtests";

interface SessionShadeBlock {
    key: string;
    label: "ASIAN" | "LONDON" | "NY";
    left: number;
    width: number;
    color: string;
    edge: string;
}

interface LevelTag {
    id: string;
    label: string;
    price: number;
    tone: BacktestTradeReplayLevel["tone"];
    top: number;
}

const MAIN_PANE_RATIO = 0.72;
const SESSION_STYLE: Record<SessionShadeBlock["label"], { color: string; edge: string }> = {
    ASIAN: { color: "rgba(24, 58, 109, 0.16)", edge: "rgba(76, 152, 255, 0.2)" },
    LONDON: { color: "rgba(18, 92, 86, 0.14)", edge: "rgba(38, 200, 112, 0.2)" },
    NY: { color: "rgba(110, 32, 86, 0.14)", edge: "rgba(240, 185, 11, 0.18)" },
};

const markerColorMap: Record<BacktestTradeReplayMarker["tone"], string> = {
    neutral: "#C7CDD6",
    entry: "#4A90FF",
    success: "#26C870",
    danger: "#F6465D",
    accent: "#49C2F2",
    warning: "#F0B90B",
};

const priceLineColorMap = {
    entry: "#4A90FF",
    danger: "#F6465D",
    success: "#26C870",
    neutral: "#C7CDD6",
    warning: "#F0B90B",
} as const;

const lineStyleMap = {
    solid: 0,
    dashed: 2,
    dotted: 1,
} as const;

const toTimestamp = (value: string) => toChartTimestamp(value);

const toCandleSeries = (
    candles: BacktestTradeReplayResponse["pricePane"]["candles"] | BacktestTradeReplayResponse["structurePane"]["candles"],
) => sanitizeChartSeries(candles.map((candle) => ({
    time: toTimestamp(candle.time),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
})));

const toLineSeries = (points: BacktestTradeReplayLinePoint[]) => sanitizeChartSeries(points.map((point) => ({
    time: toTimestamp(point.time),
    value: point.value,
})));

const toSeriesMarkers = (markers: BacktestTradeReplayMarker[]): SeriesMarker<Time>[] => markers.map((marker) => {
    const next: SeriesMarker<Time> = {
        time: toTimestamp(marker.time),
        position: marker.position,
        shape: marker.shape,
        color: markerColorMap[marker.tone],
        text: marker.label,
        id: marker.id,
    };

    if (marker.price !== null) {
        next.price = marker.price;
    }

    return next;
});

const buildSessionShadeBlocks = ({
    chartWidth,
    sessionRanges,
    timeToCoordinate,
}: {
    chartWidth: number;
    sessionRanges: BacktestTradeReplaySessionRange[];
    timeToCoordinate: (time: UTCTimestamp) => number | null;
}) => (
    sessionRanges.reduce<SessionShadeBlock[]>((blocks, range) => {
        const left = timeToCoordinate(toTimestamp(range.start));
        const right = timeToCoordinate(toTimestamp(range.end));
        if (left === null || right === null) {
            return blocks;
        }

        const width = Math.max(1, right - left);
        if (width < 2) {
            return blocks;
        }

        blocks.push({
            key: `${range.label}-${range.start}`,
            label: range.label,
            left: Math.max(0, left),
            width: Math.min(chartWidth, width),
            color: SESSION_STYLE[range.label].color,
            edge: SESSION_STYLE[range.label].edge,
        });
        return blocks;
    }, [])
);

const buildSwingPath = (markers: BacktestTradeReplayMarker[]) => sanitizeChartSeries(
    markers
        .filter((marker) => marker.source === "swing" && marker.price !== null)
        .sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime())
        .map((marker) => ({
            time: toTimestamp(marker.time),
            value: marker.price as number,
        })),
);

const buildLevelTags = ({
    levels,
    mainSeries,
    chartHeight,
}: {
    levels: BacktestTradeReplayLevel[];
    mainSeries: { priceToCoordinate?: (price: number) => number | null } | null;
    chartHeight: number;
}) => {
    if (!mainSeries?.priceToCoordinate) {
        return [];
    }

    const minTop = 12;
    const maxTop = Math.max(minTop, Math.floor(chartHeight * (MAIN_PANE_RATIO - 0.04)));
    const sorted = levels
        .map((level) => {
            const coordinate = mainSeries.priceToCoordinate?.(level.price);
            if (coordinate === null || coordinate === undefined) {
                return null;
            }

            return {
                id: level.id,
                label: level.label,
                price: level.price,
                tone: level.tone,
                top: Math.min(maxTop, Math.max(minTop, coordinate - 14)),
            };
        })
        .filter((level): level is LevelTag => Boolean(level))
        .sort((left, right) => left.top - right.top);

    for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].top - sorted[index - 1].top < 26) {
            sorted[index].top = Math.min(maxTop, sorted[index - 1].top + 26);
        }
    }

    return sorted.sort((left, right) => right.price - left.price);
};

function LegendDot({
    color,
    label,
}: {
    color: string;
    label: string;
}) {
    return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {label}
        </span>
    );
}

function LegendGroup({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-full border border-border-muted bg-bg-secondary/55 px-3 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted">{label}</span>
            <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
    );
}

function UnavailablePane({
    title,
    reason,
    minHeight,
}: {
    title: string;
    reason: string | null;
    minHeight: number;
}) {
    return (
        <div
            className="rounded-[28px] border border-dashed border-border-muted bg-bg-secondary/50 px-5 py-6"
            style={{ minHeight }}
        >
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">{title}</div>
            <div className="mt-3 max-w-2xl text-sm text-text-secondary">
                {reason || "Replay data is unavailable for this pane."}
            </div>
        </div>
    );
}

export default function BacktestTradeReplayChart({
    replay,
    isExpanded,
}: {
    replay: BacktestTradeReplayResponse;
    isExpanded: boolean;
}) {
    const priceContainerRef = useRef<HTMLDivElement>(null);
    const structureContainerRef = useRef<HTMLDivElement>(null);
    const priceMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const structureMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const priceLinesRef = useRef<Array<{ remove: () => void }>>([]);
    const [sessionBlocks, setSessionBlocks] = useState<SessionShadeBlock[]>([]);
    const [levelTags, setLevelTags] = useState<LevelTag[]>([]);
    const priceEngine = useChartEngine();
    const structureEngine = useChartEngine();
    const {
        addCandlestickSeries: addPriceCandlestickSeries,
        addLineSeries: addPriceLineSeries,
        chart: priceChart,
        initChart: initPriceChart,
        isReady: isPriceReady,
        resize: resizePriceChart,
        seriesRef: priceSeriesRef,
        setPaneHeights: setPricePaneHeights,
        setSeriesData: setPriceSeriesData,
        setVisibleRange: setPriceVisibleRange,
        subscribeVisibleTimeRangeChange: subscribePriceVisibleTimeRangeChange,
        timeToCoordinate: priceTimeToCoordinate,
    } = priceEngine;
    const {
        addCandlestickSeries: addStructureCandlestickSeries,
        addLineSeries: addStructureLineSeries,
        chart: structureChart,
        initChart: initStructureChart,
        isReady: isStructureReady,
        resize: resizeStructureChart,
        setSeriesData: setStructureSeriesData,
        setVisibleRange: setStructureVisibleRange,
    } = structureEngine;

    const priceChartHeight = isExpanded ? 640 : 430;
    const structureChartHeight = isExpanded ? 260 : 210;
    const indicatorTitle = replay.indicatorPane.title || "CTF RSI / EMA / WMA";
    const structureTitle = replay.structurePane.title || "HTF Price + Swings";
    const indicatorPaneTop = Math.round(priceChartHeight * (MAIN_PANE_RATIO + 0.03));
    const indicatorUnavailableTop = Math.round(priceChartHeight * (MAIN_PANE_RATIO + 0.095));
    const indicatorUnavailableBottom = 18;
    const priceCandles = useMemo(() => toCandleSeries(replay.pricePane.candles), [replay.pricePane.candles]);
    const trailLine = useMemo(() => toLineSeries(replay.pricePane.trailLine), [replay.pricePane.trailLine]);
    const rsiLine = useMemo(() => toLineSeries(replay.indicatorPane.rsi), [replay.indicatorPane.rsi]);
    const emaLine = useMemo(() => toLineSeries(replay.indicatorPane.ema9), [replay.indicatorPane.ema9]);
    const wmaLine = useMemo(() => toLineSeries(replay.indicatorPane.wma45), [replay.indicatorPane.wma45]);
    const structureCandles = useMemo(() => toCandleSeries(replay.structurePane.candles), [replay.structurePane.candles]);
    const baseSwingPath = useMemo(() => buildSwingPath(replay.pricePane.markers), [replay.pricePane.markers]);
    const structureSwingPath = useMemo(() => buildSwingPath(replay.structurePane.markers), [replay.structurePane.markers]);
    const activeSessions = useMemo(() => {
        const labels = replay.pricePane.sessionRanges.map((range) => range.label);
        return Array.from(new Set(labels));
    }, [replay.pricePane.sessionRanges]);
    const legendSessions = useMemo<Array<keyof typeof SESSION_STYLE>>(
        () => (activeSessions.length > 0 ? activeSessions : ["ASIAN", "LONDON", "NY"]),
        [activeSessions],
    );

    const refreshChartDecorations = useCallback(() => {
        if (!priceContainerRef.current) {
            return;
        }

        setSessionBlocks(buildSessionShadeBlocks({
            chartWidth: priceContainerRef.current.clientWidth,
            sessionRanges: replay.pricePane.sessionRanges,
            timeToCoordinate: (time) => priceTimeToCoordinate(time),
        }));

        const mainSeries = priceSeriesRef.current.get("trade-price") as { priceToCoordinate?: (price: number) => number | null } | undefined;
        setLevelTags(buildLevelTags({
            levels: replay.pricePane.levels,
            mainSeries: mainSeries ?? null,
            chartHeight: priceChartHeight,
        }));
    }, [priceChartHeight, priceSeriesRef, priceTimeToCoordinate, replay.pricePane.levels, replay.pricePane.sessionRanges]);

    useEffect(() => {
        if (!priceContainerRef.current) return;

        const cleanup = initPriceChart({
            container: priceContainerRef.current,
            width: priceContainerRef.current.clientWidth,
            height: priceChartHeight,
        });
        setPricePaneHeights([MAIN_PANE_RATIO, 1 - MAIN_PANE_RATIO]);

        const mainSeries = addPriceCandlestickSeries("trade-price", {
            lastValueVisible: true,
        });
        if (!mainSeries) {
            cleanup?.();
            return;
        }

        addPriceLineSeries("trade-swing-path", {
            color: "rgba(198, 205, 214, 0.34)",
            lineWidth: 1,
            lastValueVisible: false,
        });
        addPriceLineSeries("trade-trail", {
            color: "#F38B2A",
            lineWidth: 2,
            lastValueVisible: false,
        });
        const rsiSeries = addPriceLineSeries("trade-rsi", {
            pane: 1,
            color: "#F5F7FA",
            lineWidth: 2,
            priceScaleId: "rsi",
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            title: "RSI (14)",
        });
        addPriceLineSeries("trade-rsi-ema9", {
            pane: 1,
            color: "#F6465D",
            lineWidth: 1,
            priceScaleId: "rsi",
            lastValueVisible: false,
            title: "EMA (9)",
        });
        addPriceLineSeries("trade-rsi-wma45", {
            pane: 1,
            color: "#E0C15B",
            lineWidth: 1,
            priceScaleId: "rsi",
            lastValueVisible: false,
            title: "WMA (45)",
        });

        if (rsiSeries) {
            [70, 50, 30].forEach((price) => {
                rsiSeries.createPriceLine({
                    price,
                    color: "rgba(255,255,255,0.12)",
                    lineWidth: 1,
                    lineStyle: 1,
                    axisLabelVisible: true,
                    title: String(price),
                });
            });
        }

        priceMarkersRef.current = createSeriesMarkers(mainSeries);
        const resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            resizePriceChart(entry.contentRect.width, priceChartHeight);
            refreshChartDecorations();
        });
        resizeObserver.observe(priceContainerRef.current);

        const unsubscribeVisibleRange = subscribePriceVisibleTimeRangeChange(() => {
            refreshChartDecorations();
        });

        return () => {
            unsubscribeVisibleRange?.();
            resizeObserver.disconnect();
            priceLinesRef.current = [];
            setSessionBlocks([]);
            setLevelTags([]);
            try {
                priceMarkersRef.current?.detach();
            } catch {
                // Ignore cleanup errors from disposed charts.
            }
            priceMarkersRef.current = null;
            cleanup?.();
        };
    }, [
        addPriceCandlestickSeries,
        addPriceLineSeries,
        initPriceChart,
        priceChartHeight,
        refreshChartDecorations,
        resizePriceChart,
        setPricePaneHeights,
        subscribePriceVisibleTimeRangeChange,
    ]);

    useEffect(() => {
        if (!isPriceReady || !priceChart) return;

        setPriceSeriesData("trade-price", priceCandles);
        setPriceSeriesData("trade-swing-path", baseSwingPath);
        setPriceSeriesData("trade-trail", trailLine);
        setPriceSeriesData("trade-rsi", rsiLine);
        setPriceSeriesData("trade-rsi-ema9", emaLine);
        setPriceSeriesData("trade-rsi-wma45", wmaLine);

        const mainSeries = priceSeriesRef.current.get("trade-price");
        if (mainSeries) {
            replay.pricePane.levels.forEach((level) => {
                const priceLine = mainSeries.createPriceLine({
                    price: level.price,
                    color: priceLineColorMap[level.tone],
                    lineWidth: level.lineStyle === "solid" ? 2 : 1,
                    lineStyle: lineStyleMap[level.lineStyle],
                    axisLabelVisible: true,
                    title: level.label,
                });
                priceLinesRef.current.push({
                    remove: () => mainSeries.removePriceLine(priceLine),
                });
            });
        }

        priceMarkersRef.current?.setMarkers(toSeriesMarkers(replay.pricePane.markers));
        setPriceVisibleRange({
            from: toTimestamp(replay.window.rangeStart),
            to: toTimestamp(replay.window.rangeEnd),
        });
        const frame = window.requestAnimationFrame(refreshChartDecorations);

        return () => {
            window.cancelAnimationFrame(frame);
            priceLinesRef.current.forEach((line) => line.remove());
            priceLinesRef.current = [];
        };
    }, [
        baseSwingPath,
        emaLine,
        isPriceReady,
        priceCandles,
        priceChart,
        priceSeriesRef,
        refreshChartDecorations,
        replay.pricePane.levels,
        replay.pricePane.markers,
        replay.window.rangeEnd,
        replay.window.rangeStart,
        rsiLine,
        setPriceSeriesData,
        setPriceVisibleRange,
        trailLine,
        wmaLine,
    ]);

    useEffect(() => {
        if (!structurePaneNeeded(replay) || !structureContainerRef.current) return;

        const cleanup = initStructureChart({
            container: structureContainerRef.current,
            width: structureContainerRef.current.clientWidth,
            height: structureChartHeight,
        });

        const mainSeries = addStructureCandlestickSeries("structure-price", {
            lastValueVisible: true,
        });
        if (!mainSeries) {
            cleanup?.();
            return;
        }

        addStructureLineSeries("structure-swing-path", {
            color: "rgba(198, 205, 214, 0.38)",
            lineWidth: 1,
            lastValueVisible: false,
        });
        structureMarkersRef.current = createSeriesMarkers(mainSeries);
        const resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            resizeStructureChart(entry.contentRect.width, structureChartHeight);
        });
        resizeObserver.observe(structureContainerRef.current);

        return () => {
            resizeObserver.disconnect();
            try {
                structureMarkersRef.current?.detach();
            } catch {
                // Ignore cleanup errors from disposed charts.
            }
            structureMarkersRef.current = null;
            cleanup?.();
        };
    }, [
        addStructureCandlestickSeries,
        addStructureLineSeries,
        initStructureChart,
        replay,
        resizeStructureChart,
        structureChartHeight,
    ]);

    useEffect(() => {
        if (!structurePaneNeeded(replay) || !isStructureReady || !structureChart) return;

        setStructureSeriesData("structure-price", structureCandles);
        setStructureSeriesData("structure-swing-path", structureSwingPath);
        structureMarkersRef.current?.setMarkers(toSeriesMarkers(replay.structurePane.markers));
        const firstStructureTime = structureCandles[0]?.time;
        const lastStructureTime = structureCandles[structureCandles.length - 1]?.time;
        setStructureVisibleRange({
            from: firstStructureTime ?? toTimestamp(replay.window.rangeStart),
            to: lastStructureTime ?? toTimestamp(replay.window.rangeEnd),
        });
    }, [
        isStructureReady,
        replay,
        setStructureSeriesData,
        setStructureVisibleRange,
        structureCandles,
        structureChart,
        structureSwingPath,
    ]);

    return (
        <div className="space-y-4">
            <section className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="text-xl font-black text-text-primary">Trade Chart</div>
                        <div className="mt-1 text-sm text-text-secondary">
                            Replay evidence around the selected trade, with actual candles, swing pivots, risk ladder, and management events.
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-border-muted bg-bg-secondary/65 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
                            {replay.summary.symbol} {replay.summary.timeframe}
                        </span>
                        <span className="rounded-full border border-border-muted bg-bg-secondary/65 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
                            Padding {replay.window.paddingBars} bars
                        </span>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2.5">
                    <LegendGroup label="Sessions">
                        {legendSessions.map((session) => (
                            <LegendDot
                                key={session}
                                color={SESSION_STYLE[session].edge}
                                label={session}
                            />
                        ))}
                    </LegendGroup>
                    <LegendGroup label="Pivots">
                        <LegendDot color={markerColorMap.accent} label="SH" />
                        <LegendDot color={markerColorMap.warning} label="SL" />
                    </LegendGroup>
                    <LegendGroup label="Levels">
                        <LegendDot color={priceLineColorMap.entry} label="Entry" />
                        <LegendDot color={priceLineColorMap.danger} label="SL" />
                        <LegendDot color={priceLineColorMap.success} label="+1R / +2R / +3R" />
                    </LegendGroup>
                    {replay.pricePane.trailLine.length > 0 ? (
                        <LegendGroup label="Trail">
                            <LegendDot color="#F38B2A" label="Active stop path" />
                        </LegendGroup>
                    ) : null}
                </div>

                <div
                    className="relative mt-4 overflow-hidden rounded-[26px] border border-border-muted bg-[#0c1016]"
                    style={{
                        backgroundImage: "radial-gradient(circle at top left, rgba(86,38,74,0.18), transparent 36%), linear-gradient(180deg, rgba(17,20,28,0.98), rgba(10,12,18,1))",
                    }}
                >
                    <div
                        className="pointer-events-none absolute inset-x-0 top-0 z-[1]"
                        style={{ height: `${MAIN_PANE_RATIO * 100}%` }}
                    >
                        {sessionBlocks.map((block) => (
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
                                {block.width > 84 ? (
                                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/28">
                                        {block.label}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>

                    <div className="pointer-events-none absolute left-4 top-4 z-[2] flex flex-wrap gap-2">
                        <span className="rounded-full bg-black/35 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                            {replay.summary.side} replay
                        </span>
                        <span className="rounded-full bg-black/35 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                            {replay.indicatorPane.available ? indicatorTitle : "Indicator pane unavailable"}
                        </span>
                    </div>

                    <div
                        className="pointer-events-none absolute left-4 z-[2] rounded-full bg-black/35 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/62"
                        style={{ top: `${indicatorPaneTop}px` }}
                    >
                        {replay.indicatorPane.available ? "RSI pane" : "Indicator pane"}
                    </div>

                    {replay.indicatorPane.available ? (
                        <div
                            className="pointer-events-none absolute right-4 z-[2] rounded-full bg-black/45 px-3 py-1 text-[11px] font-bold text-white/90"
                            style={{ top: `${Math.round(priceChartHeight * (MAIN_PANE_RATIO + 0.14))}px` }}
                        >
                            CTF RSI
                        </div>
                    ) : null}

                    <div className="pointer-events-none absolute inset-y-0 right-3 z-[2] hidden w-[136px] md:block">
                        {levelTags.map((tag) => (
                            <div
                                key={tag.id}
                                className="absolute right-0 flex min-w-[116px] items-center overflow-hidden rounded-lg shadow-[0_8px_18px_rgba(0,0,0,0.22)]"
                                style={{ top: `${tag.top}px` }}
                            >
                                <span
                                    className="px-2 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-white"
                                    style={{ backgroundColor: priceLineColorMap[tag.tone] }}
                                >
                                    {tag.label}
                                </span>
                                <span className="bg-[#111722] px-2.5 py-1 text-[11px] font-bold text-white/90">
                                    {tag.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </span>
                            </div>
                        ))}
                    </div>

                    {!replay.indicatorPane.available ? (
                        <div
                            className="pointer-events-none absolute left-4 right-4 z-[2] rounded-2xl border border-dashed border-border-muted bg-black/28 px-4 py-3 text-sm text-text-secondary"
                            style={{
                                top: `${indicatorUnavailableTop}px`,
                                bottom: `${indicatorUnavailableBottom}px`,
                            }}
                        >
                            {replay.indicatorPane.reason || "Indicator context is unavailable for this trade replay."}
                        </div>
                    ) : null}

                    <div ref={priceContainerRef} style={{ height: priceChartHeight }} />
                </div>
            </section>

            <section className="rounded-[30px] border border-border-muted bg-bg-primary/75 p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="text-lg font-black text-text-primary">{structureTitle}</div>
                        <div className="mt-1 text-sm text-text-secondary">
                            Higher-timeframe structure around the same replay window for exit context and swing alignment.
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-border-muted bg-bg-secondary/65 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted">
                            {replay.structurePane.timeframe ? replay.structurePane.timeframe.toUpperCase() : "HTF n/a"}
                        </span>
                        <LegendGroup label="Swings">
                            <LegendDot color={markerColorMap.accent} label="SH" />
                            <LegendDot color={markerColorMap.warning} label="SL" />
                        </LegendGroup>
                    </div>
                </div>

                {structurePaneNeeded(replay) ? (
                    <div
                        className="overflow-hidden rounded-[26px] border border-border-muted bg-[#0c1016]"
                        style={{
                            backgroundImage: "radial-gradient(circle at top left, rgba(48,61,84,0.18), transparent 36%), linear-gradient(180deg, rgba(17,20,28,0.98), rgba(10,12,18,1))",
                        }}
                    >
                        <div ref={structureContainerRef} style={{ height: structureChartHeight }} />
                    </div>
                ) : (
                    <UnavailablePane
                        title={structureTitle}
                        reason={replay.structurePane.reason}
                        minHeight={structureChartHeight}
                    />
                )}
            </section>
        </div>
    );
}

function structurePaneNeeded(replay: BacktestTradeReplayResponse) {
    return replay.structurePane.available && replay.structurePane.candles.length > 0;
}
