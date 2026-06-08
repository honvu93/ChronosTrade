"use client";

import { useMemo } from "react";
import { EquityCurveData } from "@/types/engine";

const formatUsd = (v: number) => v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(2)}M`
    : v >= 1_000
        ? `$${(v / 1_000).toFixed(1)}k`
        : `$${v.toFixed(0)}`;

const formatSigned = (v: number, suffix = "") => `${v >= 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;

export default function BacktestEquityCurve({
    data,
    show1to1,
}: {
    data: EquityCurveData | null;
    show1to1: boolean;
}) {
    if (!data || data.points.length === 0) {
        return (
            <div className="flex h-48 items-center justify-center rounded-2xl border border-border-muted bg-bg-tertiary/30 text-text-muted text-sm">
                No equity data available
            </div>
        );
    }

    const points = data.points;
    const equities = show1to1 ? data.points1to1.map(p => p.equity) : points.map(p => p.equity);
    let maxEq = data.initialEquity;
    let minEq = data.initialEquity;
    for (const eq of equities) {
        if (eq > maxEq) maxEq = eq;
        if (eq < minEq) minEq = eq;
    }
    const range = maxEq - minEq || 1;

    // SVG dimensions
    const W = 800;
    const H = 200;
    const PAD = { t: 8, r: 12, b: 24, l: 60 };
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b;

    const pathData = useMemo(() => {
        const pts = equities.map((eq, i) => {
            const x = PAD.l + (i / Math.max(equities.length - 1, 1)) * plotW;
            const y = PAD.t + plotH - ((eq - minEq) / range) * plotH;
            return { x, y, eq };
        });
        if (pts.length === 0) return { line: "", area: "", pts: [] };
        const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
        const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${PAD.t + plotH} L${PAD.l},${PAD.t + plotH} Z`;
        return { line, area, pts };
    }, [equities, minEq, range, plotW, plotH]);

    // DD shading
    const ddPoints = useMemo(() => {
        if (show1to1) return [];
        return points.map((p, i) => ({
            x: PAD.l + (i / Math.max(points.length - 1, 1)) * plotW,
            dd: p.drawdown,
        }));
    }, [points, show1to1, plotW]);

    let maxDD = 1;
    for (const p of ddPoints) { if (p.dd > maxDD) maxDD = p.dd; }

    // Y axis labels
    const yLabels = [minEq, minEq + range * 0.5, maxEq].map(v => ({
        value: v,
        y: PAD.t + plotH - ((v - minEq) / range) * plotH,
        label: formatUsd(v),
    }));

    // Initial equity line
    const initY = PAD.t + plotH - ((data.initialEquity - minEq) / range) * plotH;

    // Color based on final result
    const finalEq = equities[equities.length - 1] ?? data.initialEquity;
    const isPositive = finalEq > data.initialEquity;
    const lineColor = isPositive ? "#22c55e" : "#ef4444";
    const areaColor = isPositive ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";

    return (
        <div className="rounded-2xl border border-border-muted bg-bg-primary/90 p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-text-muted">
                    {show1to1 ? "Equity Curve (1:1 R)" : "Equity Curve"}
                </div>
                <div className="flex items-center gap-4 text-xs">
                    <span className="text-text-muted">
                        {formatUsd(data.initialEquity)} <span className="text-text-muted/50">→</span>{" "}
                        <span className={isPositive ? "text-price-up font-bold" : "text-price-down font-bold"}>
                            {formatUsd(finalEq)}
                        </span>
                    </span>
                    <span className={`font-bold ${isPositive ? "text-price-up" : "text-price-down"}`}>
                        {formatSigned(data.totalReturn, "%")}
                    </span>
                </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                {/* Grid lines */}
                {yLabels.map((yl, i) => (
                    <g key={i}>
                        <line x1={PAD.l} y1={yl.y} x2={W - PAD.r} y2={yl.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                        <text x={PAD.l - 6} y={yl.y + 3} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">
                            {yl.label}
                        </text>
                    </g>
                ))}

                {/* Initial equity reference */}
                <line x1={PAD.l} y1={initY} x2={W - PAD.r} y2={initY} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 4" />

                {/* DD shading (behind curve) */}
                {!show1to1 && ddPoints.length > 0 && (
                    <path
                        d={ddPoints.map((p, i) => {
                            const ddH = (p.dd / maxDD) * (plotH * 0.3);
                            const baseY = PAD.t;
                            return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${(baseY + ddH).toFixed(1)}`;
                        }).join(" ") + ` L${ddPoints[ddPoints.length - 1].x.toFixed(1)},${PAD.t} L${PAD.l},${PAD.t} Z`}
                        fill="rgba(239,68,68,0.06)"
                    />
                )}

                {/* Area fill */}
                {pathData.area && <path d={pathData.area} fill={areaColor} />}

                {/* Equity line */}
                {pathData.line && (
                    <path d={pathData.line} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
                )}
            </svg>

            {/* Yearly breakdown */}
            {data.yearlyBreakdown.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[11px]">
                        <thead>
                            <tr className="text-text-muted font-bold uppercase tracking-wider">
                                <th className="text-left py-1 px-2">Year</th>
                                <th className="text-right py-1 px-2">Trades</th>
                                <th className="text-right py-1 px-2">WR</th>
                                <th className="text-right py-1 px-2">PnL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.yearlyBreakdown.map((y) => (
                                <tr key={y.year} className="border-t border-border-muted/30">
                                    <td className="py-1 px-2 text-text-secondary font-mono">{y.year}</td>
                                    <td className="py-1 px-2 text-right text-text-secondary">{y.trades}</td>
                                    <td className="py-1 px-2 text-right text-text-secondary">{y.winRate.toFixed(1)}%</td>
                                    <td className={`py-1 px-2 text-right font-bold ${y.pnlUsd >= 0 ? "text-price-up" : "text-price-down"}`}>
                                        {formatUsd(y.pnlUsd)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
