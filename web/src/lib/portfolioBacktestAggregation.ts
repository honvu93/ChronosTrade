import { BacktestTradeRow } from "@/types/backtests";
import { toChartTimestamp } from "@/lib/chartTimezone";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PortfolioYearStat {
    year: number;
    netR: number;
}

export interface PortfolioSessionStat {
    session: string;
    netR: number;
    winRate: number;
    color: string;
}

export interface PortfolioSymbolCard {
    symbol: string;
    category: string;
    color: string;
    netR: number;
    wins: number;
    losses: number;
    totalTrades: number;
    signalCount: number;
    winRate: number;
    profitFactor: number;
    avgR: number;
}

export interface PortfolioEquityPoint {
    time: number; // unix seconds
    value: number;
}

export interface PortfolioAggregation {
    totalR: number;
    totalTrades: number;
    initialEquity: number;
    finalBalance: number;
    /** Portfolio-level win rate (%) */
    winRate: number;
    /** Portfolio-level profit factor */
    profitFactor: number;
    /** Expectancy per trade (R) */
    expectancy: number;
    /** Return on investment (%) */
    roiPct: number;
    /** Max drawdown in R */
    maxDrawdownR: number;
    /** Max drawdown as % of peak balance */
    maxDrawdownPct: number;
    /** Average winning trade R */
    avgWinR: number;
    /** Average losing trade R */
    avgLossR: number;
    /** Longest consecutive win streak */
    maxWinStreak: number;
    /** Longest consecutive loss streak */
    maxLossStreak: number;
    years: PortfolioYearStat[];
    sessions: PortfolioSessionStat[];
    symbols: PortfolioSymbolCard[];
    /** Balance curve (USD compounding) */
    equityCurve: PortfolioEquityPoint[];
    /** Cumulative R curve */
    equityCurveR: PortfolioEquityPoint[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SESSION_COLORS: Record<string, string> = {
    ASIAN: "#6366f1",
    LONDON: "#f59e0b",
    NY: "#ef4444",
};

const SYMBOL_COLORS: string[] = [
    "#6366f1", "#f59e0b", "#3b82f6", "#ef4444", "#10b981",
    "#ec4899", "#8b5cf6", "#f97316", "#14b8a6", "#eab308",
];

function resolveCategory(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper.includes("XAU") || upper.includes("XAG") || upper.includes("XCU") || upper.includes("XPT")) return "METALS";
    if (upper.includes("BTC") || upper.includes("ETH") || upper.includes("SOL") || upper.includes("DOGE")) return "CRYPTO";
    if (upper.includes("OIL") || upper.includes("WTI") || upper.includes("BRENT") || upper.includes("NATGAS")) return "ENERGY";
    return "FOREX";
}

function computeProfitFactor(trades: BacktestTradeRow[]): number {
    let grossWin = 0;
    let grossLoss = 0;
    for (const t of trades) {
        if (t.result === "ACTIVE") continue;
        if (t.rMultiple > 0) grossWin += t.rMultiple;
        else if (t.rMultiple < 0) grossLoss += Math.abs(t.rMultiple);
    }
    return grossLoss === 0 ? (grossWin > 0 ? 999 : 0) : Number((grossWin / grossLoss).toFixed(2));
}

// ─── Main Aggregation ────────────────────────────────────────────────────────

export function aggregatePortfolioBacktest(
    allTrades: BacktestTradeRow[],
    initialEquity: number,
    riskPercent: number,
): PortfolioAggregation {
    const closed = allTrades.filter((t) => t.result !== "ACTIVE");

    // Total
    const totalR = closed.reduce((sum, t) => sum + t.rMultiple, 0);
    const totalTrades = closed.length;

    // Portfolio-level metrics
    const wins = closed.filter((t) => t.result === "WIN");
    const losses = closed.filter((t) => t.result === "LOSS");
    const winRate = totalTrades > 0 ? Math.round((wins.length / totalTrades) * 100) : 0;
    const grossWin = wins.reduce((s, t) => s + t.rMultiple, 0);
    const grossLoss = losses.reduce((s, t) => s + Math.abs(t.rMultiple), 0);
    const profitFactor = grossLoss === 0 ? (grossWin > 0 ? 999 : 0) : Number((grossWin / grossLoss).toFixed(2));
    const expectancy = totalTrades > 0 ? Number((totalR / totalTrades).toFixed(3)) : 0;
    const avgWinR = wins.length > 0 ? Number((grossWin / wins.length).toFixed(2)) : 0;
    const avgLossR = losses.length > 0 ? Number((grossLoss / losses.length).toFixed(2)) : 0;

    // Win/loss streaks — must be computed AFTER sorting by exit time (see sortedClosed below)

    // Year breakdown
    const yearMap = new Map<number, number>();
    for (const t of closed) {
        const time = t.exitTime ?? t.entryTime;
        const year = new Date(time).getUTCFullYear();
        yearMap.set(year, (yearMap.get(year) ?? 0) + t.rMultiple);
    }
    const years = Array.from(yearMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([year, netR]) => ({ year, netR: Number(netR.toFixed(1)) }));

    // Session breakdown
    const sessionMap = new Map<string, BacktestTradeRow[]>();
    for (const t of closed) {
        const list = sessionMap.get(t.session) ?? [];
        list.push(t);
        sessionMap.set(t.session, list);
    }
    const sessionOrder = ["ASIAN", "LONDON", "NY"];
    const sessions: PortfolioSessionStat[] = sessionOrder
        .filter((s) => sessionMap.has(s))
        .map((session) => {
            const trades = sessionMap.get(session)!;
            const wins = trades.filter((t) => t.result === "WIN").length;
            const total = trades.length;
            return {
                session,
                netR: Number(trades.reduce((s, t) => s + t.rMultiple, 0).toFixed(1)),
                winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
                color: SESSION_COLORS[session] ?? "#6b7280",
            };
        });

    // Symbol breakdown
    const symbolMap = new Map<string, BacktestTradeRow[]>();
    for (const t of closed) {
        const list = symbolMap.get(t.symbol) ?? [];
        list.push(t);
        symbolMap.set(t.symbol, list);
    }

    // Count unique signals per symbol
    const symbolSignalMap = new Map<string, Set<string>>();
    for (const t of allTrades) {
        const set = symbolSignalMap.get(t.symbol) ?? new Set();
        set.add(t.backtestRunId);
        symbolSignalMap.set(t.symbol, set);
    }

    const symbols: PortfolioSymbolCard[] = Array.from(symbolMap.entries())
        .map(([symbol, trades], idx) => {
            const wins = trades.filter((t) => t.result === "WIN").length;
            const losses = trades.filter((t) => t.result === "LOSS").length;
            const total = trades.length;
            const netR = trades.reduce((s, t) => s + t.rMultiple, 0);
            const signalCount = symbolSignalMap.get(symbol)?.size ?? 0;
            const totalSignals = symbolSignalMap.get(symbol)?.size ?? 0;
            return {
                symbol: symbol.replace(/USD$/i, "").replace(/^USD/i, "USD").replace(/c$/i, ""),
                category: resolveCategory(symbol),
                color: SYMBOL_COLORS[idx % SYMBOL_COLORS.length],
                netR: Number(netR.toFixed(1)),
                wins,
                losses,
                totalTrades: total,
                signalCount: totalSignals,
                winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
                profitFactor: computeProfitFactor(trades),
                avgR: total > 0 ? Number((netR / total).toFixed(3)) : 0,
            };
        })
        .sort((a, b) => b.netR - a.netR);

    // Build both equity curves from sorted closed trades
    const sortedClosed = [...closed]
        .filter((t) => t.exitTime)
        .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime());

    const equityCurve: PortfolioEquityPoint[] = [];
    const equityCurveR: PortfolioEquityPoint[] = [];
    let balance = initialEquity;
    let cumR = 0;
    const fixedRiskAmount = initialEquity * (riskPercent / 100);

    // Starting points
    if (sortedClosed.length > 0) {
        const firstTimeSec = toChartTimestamp(sortedClosed[0].entryTime) as number;
        equityCurve.push({ time: firstTimeSec, value: Number(balance.toFixed(2)) });
        equityCurveR.push({ time: firstTimeSec, value: 0 });
    }

    // Single pass: equity curves + drawdown + streaks (all on time-sorted data)
    let peakBalance = initialEquity;
    let maxDdPct = 0;
    let peakR = 0;
    let maxDdR = 0;
    let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;

    for (const t of sortedClosed) {
        balance += t.rMultiple * fixedRiskAmount;
        cumR += t.rMultiple;
        const timeSec = toChartTimestamp(t.exitTime!) as number;
        equityCurve.push({ time: timeSec, value: Number(balance.toFixed(2)) });
        equityCurveR.push({ time: timeSec, value: Number(cumR.toFixed(2)) });

        // Drawdown tracking
        peakBalance = Math.max(peakBalance, balance);
        peakR = Math.max(peakR, cumR);
        const ddPct = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
        const ddR = peakR - cumR;
        maxDdPct = Math.max(maxDdPct, ddPct);
        maxDdR = Math.max(maxDdR, ddR);

        // Streak tracking (time-sorted)
        if (t.result === "WIN") { curWin++; curLoss = 0; maxWinStreak = Math.max(maxWinStreak, curWin); }
        else if (t.result === "LOSS") { curLoss++; curWin = 0; maxLossStreak = Math.max(maxLossStreak, curLoss); }
        else { curWin = 0; curLoss = 0; }
    }

    // Deduplicate same-second points (keep last)
    const dedupe = (arr: PortfolioEquityPoint[]): PortfolioEquityPoint[] => {
        const result: PortfolioEquityPoint[] = [];
        for (let i = 0; i < arr.length; i++) {
            if (i < arr.length - 1 && arr[i].time === arr[i + 1].time) continue;
            result.push(arr[i]);
        }
        return result;
    };

    const finalBalance = balance;
    const roiPct = initialEquity > 0 ? Number(((finalBalance - initialEquity) / initialEquity * 100).toFixed(1)) : 0;

    return {
        totalR: Number(totalR.toFixed(1)),
        totalTrades,
        initialEquity,
        finalBalance: Number(finalBalance.toFixed(2)),
        winRate,
        profitFactor,
        expectancy,
        roiPct,
        maxDrawdownR: Number(maxDdR.toFixed(1)),
        maxDrawdownPct: Number(maxDdPct.toFixed(1)),
        avgWinR,
        avgLossR,
        maxWinStreak,
        maxLossStreak,
        years,
        sessions,
        symbols,
        equityCurve: dedupe(equityCurve),
        equityCurveR: dedupe(equityCurveR),
    };
}
