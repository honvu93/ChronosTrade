"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, TrendingUp } from "lucide-react";
import { useTradingAccounts } from "@/hooks/useTradingAccounts";
import { useAuthSession } from "@/hooks/useAuthSession";
import StateBanner from "@/components/ui/StateBanner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EquityCurvePoint { date: string; cumulativePnl: number; }
interface SignalBreakdown { bindingId: string; bindingName: string; executedCount: number; rejectedCount: number; failedCount: number; }
interface RecentIntent { id: string; createdAt: string; symbol: string; side: string | null; volume: number | null; status: string; statusReason: string | null; bindingName: string; }

interface PaperPerformanceData {
    totalExecutedIntents: number;
    totalRejectedIntents: number;
    totalFailedIntents: number;
    totalRealizedPnl: number;
    equityCurve: EquityCurvePoint[];
    signalBreakdown: SignalBreakdown[];
    recentIntents: RecentIntent[];
}

type DateFilter = "7d" | "30d" | "all";

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchPaperPerformance(accountId: string, filter: DateFilter): Promise<PaperPerformanceData> {
    const params = new URLSearchParams();
    if (filter !== "all") {
        const days = filter === "7d" ? 7 : 30;
        const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        params.set("from", from.toISOString());
    }
    const url = `/api/trading/accounts/${accountId}/paper-performance${params.size ? `?${params}` : ""}`;
    const res = await fetch(url, { credentials: "include" });
    const payload = await res.json().catch(() => null) as { success: boolean; data?: PaperPerformanceData; error?: { message: string } } | null;
    if (!res.ok || !payload?.success || !payload.data) throw new Error(payload?.error?.message ?? "Failed to load paper performance.");
    return payload.data;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricTile({ label, value, accent }: { label: string; value: string; accent?: "up" | "down" | "neutral" }) {
    const valueClass = accent === "up" ? "text-price-up" : accent === "down" ? "text-price-down" : "text-text-primary";
    return (
        <div className="rounded-xl border border-border-muted bg-bg-tertiary/60 p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">{label}</div>
            <div className={`mt-1.5 text-xl font-black ${valueClass}`}>{value}</div>
        </div>
    );
}

function EquityChart({ curve }: { curve: EquityCurvePoint[] }) {
    if (curve.length === 0) {
        return (
            <div className="flex h-32 items-center justify-center rounded-xl border border-border-muted bg-bg-tertiary/20">
                <div className="text-center">
                    <div className="text-sm font-bold text-text-muted">Paper trading is active.</div>
                    <p className="mt-1 text-[11px] text-text-muted">Your first trade will appear here when a signal fires.</p>
                    <Link href="/trading?tab=automation" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline">
                        View signal status →
                    </Link>
                </div>
            </div>
        );
    }

    const maxPnl = Math.max(...curve.map((p) => p.cumulativePnl));
    const minPnl = Math.min(...curve.map((p) => p.cumulativePnl), 0);
    const range = (maxPnl - minPnl) || 1;
    const H = 80;

    return (
        <div className="overflow-x-auto rounded-xl border border-border-muted bg-bg-tertiary/20 p-3">
            <svg viewBox={`0 0 ${Math.max(curve.length * 20, 200)} ${H + 20}`} className="w-full" style={{ minWidth: `${curve.length * 20}px` }}>
                <polyline
                    points={curve.map((p, i) => {
                        const x = (i / (curve.length - 1)) * (curve.length * 20);
                        const y = H - ((p.cumulativePnl - minPnl) / range) * H;
                        return `${x},${y}`;
                    }).join(" ")}
                    fill="none"
                    stroke={curve[curve.length - 1].cumulativePnl >= 0 ? "#2ca6a4" : "#d86060"}
                    strokeWidth="2"
                    strokeLinejoin="round"
                />
                {/* Zero line */}
                {minPnl < 0 && (
                    <line
                        x1={0} y1={H - ((0 - minPnl) / range) * H}
                        x2={curve.length * 20} y2={H - ((0 - minPnl) / range) * H}
                        stroke="#26364f" strokeWidth="1" strokeDasharray="4 4"
                    />
                )}
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-text-muted">
                <span>{curve[0].date}</span>
                <span>{curve[curve.length - 1].date}</span>
            </div>
        </div>
    );
}

const statusBadgeClass: Record<string, string> = {
    EXECUTED: "border-price-up/30 bg-price-up/10 text-price-up",
    REJECTED: "border-price-down/30 bg-price-down/10 text-price-down",
    FAILED: "border-border-muted bg-bg-tertiary text-text-muted",
    PROCESSING: "border-accent/30 bg-accent/10 text-accent",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function PaperDashboard() {
    const { user } = useAuthSession();
    const { accounts, status: accountsStatus } = useTradingAccounts({ enabled: Boolean(user) });
    const paperAccounts = accounts.filter((a) => a.accountMode === "PAPER");
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [filter, setFilter] = useState<DateFilter>("30d");
    const [data, setData] = useState<PaperPerformanceData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (paperAccounts.length > 0 && !selectedAccountId) {
            setSelectedAccountId(paperAccounts[0].id);
        }
    }, [paperAccounts, selectedAccountId]);

    const load = useCallback(async () => {
        if (!selectedAccountId) return;
        setLoading(true);
        setError(null);
        try {
            const result = await fetchPaperPerformance(selectedAccountId, filter);
            setData(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load dashboard.");
        } finally {
            setLoading(false);
        }
    }, [selectedAccountId, filter]);

    useEffect(() => { void load(); }, [load]);

    if (accountsStatus === "loading" || accountsStatus === "idle") {
        return (
            <div className="flex items-center gap-2 p-8 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
            </div>
        );
    }

    if (paperAccounts.length === 0) {
        return (
            <div className="p-6">
                <StateBanner
                    tone="neutral"
                    title="No paper accounts"
                    message="Connect a paper MT5 account to start paper trading."
                    action={<Link href="/trading?tab=accounts" className="text-[11px] font-bold text-accent hover:underline">Connect account →</Link>}
                />
            </div>
        );
    }

    return (
        <div className="space-y-5 p-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Link href="/trading" className="rounded-full border border-border-muted bg-bg-tertiary p-1.5 text-text-muted hover:text-text-primary">
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-accent" />
                            <span className="text-sm font-black text-text-primary">Paper Dashboard</span>
                        </div>
                        {paperAccounts.length > 1 && (
                            <select
                                value={selectedAccountId ?? ""}
                                onChange={(e) => setSelectedAccountId(e.target.value)}
                                className="mt-1 rounded-lg border border-border-muted bg-bg-tertiary px-2 py-0.5 text-[11px] font-bold text-text-secondary focus:border-accent focus:outline-none"
                            >
                                {paperAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                            </select>
                        )}
                        {paperAccounts.length === 1 && (
                            <div className="text-[11px] text-text-muted">{paperAccounts[0].label}</div>
                        )}
                    </div>
                </div>
                {/* Date filter tabs */}
                <div className="flex rounded-xl border border-border-muted bg-bg-tertiary/60 p-1 text-[11px] font-black">
                    {(["7d", "30d", "all"] as DateFilter[]).map((f) => (
                        <button
                            key={f}
                            type="button"
                            onClick={() => setFilter(f)}
                            className={`rounded-lg px-3 py-1 uppercase tracking-[0.12em] transition-colors ${filter === f ? "bg-accent text-white" : "text-text-muted hover:text-text-primary"}`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* Error */}
            {error ? (
                <StateBanner tone="caution" icon={<AlertTriangle className="h-4 w-4" />} message={error} action={<button type="button" onClick={() => void load()} className="text-[11px] font-bold text-accent hover:underline">Retry</button>} />
            ) : null}

            {/* Loading skeleton or data */}
            {loading && !data ? (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-border-muted bg-bg-tertiary/60" />)}
                    </div>
                    <div className="h-32 animate-pulse rounded-xl border border-border-muted bg-bg-tertiary/20" />
                </div>
            ) : data ? (
                <>
                    {/* KPI tiles */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <MetricTile
                            label="Realized P&L"
                            value={`${data.totalRealizedPnl >= 0 ? "+" : ""}$${data.totalRealizedPnl.toFixed(2)}`}
                            accent={data.totalRealizedPnl >= 0 ? "up" : "down"}
                        />
                        <MetricTile label="Executed" value={String(data.totalExecutedIntents)} />
                        <MetricTile label="Rejected" value={String(data.totalRejectedIntents)} />
                        <MetricTile label="Failed" value={String(data.totalFailedIntents)} />
                    </div>

                    {/* Equity curve */}
                    <div>
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Equity Curve</div>
                        <EquityChart curve={data.equityCurve} />
                    </div>

                    {/* Signal breakdown */}
                    {data.signalBreakdown.length > 0 ? (
                        <div>
                            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Signal Breakdown</div>
                            <div className="rounded-xl border border-border-muted overflow-hidden">
                                <table className="w-full text-[11px]">
                                    <thead>
                                        <tr className="border-b border-border-muted bg-bg-tertiary/60">
                                            <th className="px-3 py-2 text-left font-bold uppercase tracking-[0.12em] text-text-muted">Signal</th>
                                            <th className="px-3 py-2 text-right font-bold uppercase tracking-[0.12em] text-text-muted">Executed</th>
                                            <th className="px-3 py-2 text-right font-bold uppercase tracking-[0.12em] text-text-muted">Rejected</th>
                                            <th className="px-3 py-2 text-right font-bold uppercase tracking-[0.12em] text-text-muted">Failed</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.signalBreakdown.map((row) => (
                                            <tr key={row.bindingId} className="border-b border-border-muted/50 last:border-0">
                                                <td className="px-3 py-2 font-bold text-text-primary">{row.bindingName}</td>
                                                <td className="px-3 py-2 text-right font-black text-price-up">{row.executedCount}</td>
                                                <td className="px-3 py-2 text-right text-text-secondary">{row.rejectedCount}</td>
                                                <td className="px-3 py-2 text-right text-price-down">{row.failedCount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}

                    {/* Recent intents */}
                    {data.recentIntents.length > 0 ? (
                        <div>
                            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted">Recent Intents</div>
                            <div className="space-y-1.5">
                                {data.recentIntents.map((intent) => (
                                    <div key={intent.id} className="flex items-center justify-between gap-3 rounded-xl border border-border-muted/50 bg-bg-tertiary/30 px-3 py-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-black text-text-primary">{intent.symbol}</span>
                                                {intent.side ? (
                                                    <span className={`text-[10px] font-bold ${intent.side === "LONG" ? "text-price-up" : "text-price-down"}`}>
                                                        {intent.side}
                                                    </span>
                                                ) : null}
                                                {intent.volume != null ? (
                                                    <span className="text-[10px] text-text-muted">{intent.volume} lot</span>
                                                ) : null}
                                            </div>
                                            <div className="mt-0.5 truncate text-[10px] text-text-muted">
                                                {intent.bindingName} · {new Date(intent.createdAt).toLocaleTimeString()}
                                            </div>
                                        </div>
                                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${statusBadgeClass[intent.status] ?? "border-border-muted bg-bg-tertiary text-text-muted"}`}>
                                            {intent.status}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
