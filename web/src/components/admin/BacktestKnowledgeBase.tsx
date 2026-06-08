"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
    AlertTriangle,
    Ban,
    BarChart3,
    BookOpen,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clock,
    Database,
    ExternalLink,
    FlaskConical,
    Layers,
    Lightbulb,
    Loader2,
    Rocket,
    Search,
    Shield,
    Sparkles,
    Target,
    ThumbsDown,
    ThumbsUp,
    TrendingDown,
    TrendingUp,
    XCircle,
    Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type Verdict = "APPROVED" | "REJECTED" | "PARTIAL" | "BLOCKED" | "INFO";

interface RelatedRun {
    runId: string;
    label: string;
    netR: string;
    trades: number;
    highlight?: boolean;
}

interface Experiment {
    id: string;
    code: string;
    title: string;
    date: string;
    verdict: Verdict;
    hypothesis: string;
    result: string;
    keyMetrics: { label: string; value: string; delta?: string; good?: boolean }[];
    details: string[];
    recommendation: string;
    tags: string[];
    relatedRuns?: RelatedRun[];
}

interface ConfigRule {
    id: string;
    type: "DO" | "DONT" | "CAUTION";
    title: string;
    description: string;
    evidence: string;
    impact: string;
}

/* ------------------------------------------------------------------ */
/*  Static data — optimization history                                 */
/* ------------------------------------------------------------------ */
const experiments: Experiment[] = [
    {
        id: "opt-0",
        code: "OPT-0",
        title: "Baseline Snapshot",
        date: "2026-03-19",
        verdict: "INFO",
        hypothesis: "Đánh giá toàn bộ 39 backtest runs hiện có trong DB.",
        result: "Xác định top variants, session breakdown, và các điểm yếu cấu trúc.",
        keyMetrics: [
            { label: "Total Runs", value: "39" },
            { label: "Best Net R", value: "1,352R", delta: "M15_EXTENDED" },
            { label: "Best PF", value: "2.05", delta: "B4_TP25_HARD" },
            { label: "Best WR", value: "54.4%", delta: "B1_ATR135_HARD" },
        ],
        details: [
            "Tất cả 39 runs là XAUUSD LONG only, period 2019-2026",
            "NY session mạnh nhất: 62-66% WR, 0.73-0.95 avg R",
            "London session yếu nhất: 31-40% WR, gần 0 avg R",
            "Asian session ổn: 48-59% WR",
            "M15_EXTENDED lỗ -201R năm 2022 (bear market)",
            "M5 variants chỉ có data từ Oct 2024 — chưa stress-test bear market",
            "100% exits là binary: TP hoặc SL, không có trailing/BE",
            "Max consecutive losses: 27-77 (rất cao)",
        ],
        recommendation: "Top-3 candidates: B1_ATR135_HARD (best risk profile), B4_TP25_HARD (best Net R), B4_LOOKBACK96_HARD (balanced).",
        tags: ["baseline", "XAU", "LONG", "M5", "M15"],
        relatedRuns: [
            { runId: "cmmsyc8je8tegtktykf39xxj7", label: "ATR12_GUARD_BASELINE M5", netR: "680R", trades: 1724 },
            { runId: "cmmsy6wey70oltktyj8tuni5i", label: "B1_ATR135_HARD M5", netR: "623R", trades: 1400, highlight: true },
            { runId: "cmmsxpgfp0000tkty8flkkyoq", label: "B4_TP25_HARD M5", netR: "1,308R", trades: 2455, highlight: true },
            { runId: "cmmsxqv500iy1tktyvxouf6l6", label: "B4_LOOKBACK96_HARD M5", netR: "1,100R", trades: 2455, highlight: true },
            { runId: "cmmsy2cuf569ftktyq233uw42", label: "M15_EXTENDED", netR: "1,353R", trades: 3565 },
        ],
    },
    {
        id: "opt-1",
        code: "OPT-1",
        title: "London Session Filter",
        date: "2026-03-19",
        verdict: "REJECTED",
        hypothesis: "Loại bỏ entry trong London session (07-13 UTC) sẽ tăng WR% vì London có edge thấp.",
        result: "Cắt London PHÁ HỦY strategy. Net R giảm 53-59%, WR giảm 5-7pp.",
        keyMetrics: [
            { label: "B1 Net R", value: "255R", delta: "-59% vs 623R", good: false },
            { label: "B4 Net R", value: "620R", delta: "-53% vs 1,308R", good: false },
            { label: "WR Change", value: "-5 to -7pp", good: false },
            { label: "Expectancy", value: "-34 to -49%", good: false },
        ],
        details: [
            "Strategy IS a London-session strategy — Asian High breakout xảy ra khi London mở cửa",
            "Hours 10-12 UTC là peak profitable (+633R = 90% tổng edge)",
            "Hours 7-9 UTC là vùng edge âm (-22R combined)",
            "WR thấp ở London do hours 7-9 kéo xuống, KHÔNG phải toàn bộ London",
            "6 variants tested (NO_LONDON + LATE_LONDON × 3 bases) — tất cả FAIL",
        ],
        recommendation: "KHÔNG cắt London session. Nếu muốn filter, chỉ loại hours 7-9 UTC (early London) — đó mới là vùng edge âm thực sự.",
        tags: ["session-filter", "REJECTED", "London"],
        relatedRuns: [
            { runId: "cmmswrtlt0000tklo19fune7y", label: "Baseline (original)", netR: "793R", trades: 2385 },
        ],
    },
    {
        id: "opt-2",
        code: "OPT-2",
        title: "Trade Guards (Loss Management)",
        date: "2026-03-19",
        verdict: "APPROVED",
        hypothesis: "Kích hoạt trade guards sẽ giảm max consecutive losses và bảo vệ vốn.",
        result: "R preservation 94-104%, PF +4-6%. Nhưng max consec losses KHÔNG giảm đáng kể.",
        keyMetrics: [
            { label: "R Preserved", value: "99-104%", good: true },
            { label: "PF Change", value: "+4-6%", good: true },
            { label: "Block Rate", value: "2.5-3.8%", good: true },
            { label: "Max Consec Loss", value: "75-105", delta: "vs 76-105 baseline", good: false },
        ],
        details: [
            "3 profiles tested: Conservative (7-12% block), Moderate (2.5-3.8%), Aggressive (1.9-2.7%)",
            "Moderate profile recommended — best R preservation + PF improvement",
            "Guards delay entries nhưng adverse market regime vẫn tiếp tục sau cooldown",
            "Session/day caps có minimal effect — loss streaks span multiple days",
            "R preservation đôi khi > 100% vì blocked trades là losing trades",
        ],
        recommendation: "Dùng Moderate profile: sessionCap 3L/-3R, dayCap 4L/-4R, cooldown 5L→720min, throttle 3→1.5% + 5→1.0%.",
        tags: ["trade-guards", "APPROVED", "risk-management"],
        relatedRuns: [
            { runId: "cmmx0v9rt304htklzs2oclc5w", label: "B4_LOOKBACK96 Moderate", netR: "1,090R", trades: 2376, highlight: true },
            { runId: "cmmx0vyue3j5dtklzh2tbt9q1", label: "B4_LOOKBACK96 Aggressive", netR: "1,106R", trades: 2388 },
        ],
    },
    {
        id: "opt-3",
        code: "OPT-3",
        title: "Exit Profile Upgrade",
        date: "2026-03-19",
        verdict: "PARTIAL",
        hypothesis: "Thay HARD_SIGNAL_TP bằng exit profiles tiên tiến sẽ tăng WR và giảm drawdown.",
        result: "PARTIAL_1R_BE_R3 tốt nhất: WR +14pp, median R dương. Nhưng Net R giảm 29-49%.",
        keyMetrics: [
            { label: "WR Improvement", value: "+9-14pp", good: true },
            { label: "Median R", value: "+0.32 to +0.34", delta: "vs -1.0 baseline", good: true },
            { label: "Net R Retained", value: "51-71%", good: false },
            { label: "Rescued Trades", value: "19-27%", delta: "SL→BE", good: true },
        ],
        details: [
            "4 exit profiles tested × 3 variants = 12 runs",
            "PARTIAL_1R_BE_R3: chốt 50% tại 1R, move BE, target 3R — best balance",
            "BE_1R_TP_2R: WR giảm -12pp (unexpected), PF giảm",
            "SWING_TRAIL: median R cao nhất (+0.70) nhưng chỉ giữ 27-37% Net R",
            "HARD_SIGNAL_TP vẫn best cho raw profitability",
            "Exit upgrade chủ yếu cải thiện tâm lý trading, không tăng profit",
        ],
        recommendation: "Dùng HARD_SIGNAL_TP cho max profit. Chuyển sang PARTIAL_1R_BE_R3 nếu cần WR cao (63%) và tâm lý ổn định hơn.",
        tags: ["exit-profile", "PARTIAL", "psychology"],
        relatedRuns: [
            { runId: "cmmx0w2s47069tk3qxppzlw33", label: "B4_LOOKBACK96 SWING_TRAIL", netR: "410R", trades: 2455 },
            { runId: "cmmx0vbgi6db4tk3qnp2ivgfw", label: "B4_LOOKBACK96 BE_1R_TRAIL", netR: "756R", trades: 2455 },
        ],
    },
    {
        id: "opt-4",
        code: "OPT-4",
        title: "Stress Test M5 (Bear Market 2022)",
        date: "2026-03-19",
        verdict: "BLOCKED",
        hypothesis: "M5 variants có survive qua bear market 2022 (-43% gold) không?",
        result: "BLOCKED — không có M5 data trước Oct 2024. Chưa thể validate.",
        keyMetrics: [
            { label: "M5 Data From", value: "Oct 2024" },
            { label: "Required", value: "2019-2023" },
            { label: "Gap", value: "5 years missing", good: false },
            { label: "M15 2022 Loss", value: "-201R", delta: "bear market", good: false },
        ],
        details: [
            "M5 candle data chỉ có từ 2024-10-10 (99,094 candles)",
            "Zero M5 candles cho 2019-2023",
            "30m data có từ 2017, 15m từ 2021-12 — có thể dùng proxy test",
            "M15_EXTENDED lỗ -201R năm 2022 → Asian Break vulnerable trong bear market",
            "Tất cả M5 variants chưa validated cho bear conditions",
        ],
        recommendation: "BLOCKER: Ingest M5 data 2019-2023 từ MT5 broker trước khi scale risk lên 2%. Dùng proxy test trên 30m/15m nếu M5 không available.",
        tags: ["stress-test", "BLOCKED", "data-gap", "bear-market"],
    },
    {
        id: "opt-5",
        code: "OPT-5",
        title: "SHORT Side (Asian Low Break)",
        date: "2026-03-19",
        verdict: "REJECTED",
        hypothesis: "Mirror LONG logic thành SHORT để diversify và hedge bear market.",
        result: "Tất cả SHORT variants thua nặng: PF 0.45-0.50, WR 19-24%.",
        keyMetrics: [
            { label: "Best PF", value: "0.50", good: false },
            { label: "Best WR", value: "24.0%", good: false },
            { label: "Best Net R", value: "-517R", good: false },
            { label: "2024 PF", value: "1.48", delta: "consolidation market", good: true },
        ],
        details: [
            "4 SHORT variants tested: BASE, B1_ATR135, B4_TP25, B4_LOOKBACK96",
            "2024 profitable (PF 1.2-1.48) — SHORT works trong consolidation/correction",
            "2025 catastrophic (PF 0.24-0.29) — XAU bull run phá SHORT hoàn toàn",
            "95% trades tập trung LONDON session — logic fire sai session",
            "XAU có long bias lịch sử ($1280→$3000+ trong 7 năm)",
        ],
        recommendation: "KHÔNG deploy SHORT standalone. Có thể dùng conditional với regime filter (chỉ trade SHORT khi bearish regime) — nhưng cần validate trên 2022 data trước.",
        tags: ["SHORT", "REJECTED", "diversification"],
        relatedRuns: [],
    },
    {
        id: "opt-6",
        code: "OPT-6",
        title: "Regime Filter (Trend Confirmation)",
        date: "2026-03-19",
        verdict: "APPROVED",
        hypothesis: "Thêm trend/volatility filter sẽ loại bỏ entries trong choppy/counter-trend market.",
        result: "Filter B (CONFIRMATION_TREND) cải thiện nhẹ: PF +0.07-0.13, DD giảm, R preserved 86-90%.",
        keyMetrics: [
            { label: "Filter Rate", value: "18.1-18.7%", good: true },
            { label: "R Preserved", value: "86-90%", good: true },
            { label: "PF Change", value: "+0.07 to +0.13", good: true },
            { label: "WR Change", value: "+0.8 to +1.5pp", good: true },
        ],
        details: [
            "3 filters tested: A (MARKET_REGIME), B (CONFIRMATION_TREND), C (Combined = B)",
            "Filter A (ATR normal) redundant — base signal đã có ATR expansion gate",
            "Filter C = Filter B vì CONFIRMATION_TREND là superset của MARKET_REGIME",
            "Blocked trades có WR 45-47% (marginally weaker entries — correct filtering)",
            "NY session benefits most từ trend filter",
            "Max DD B4_TP25 giảm: -3.82% → -2.83%",
        ],
        recommendation: "Dùng Filter B (CONFIRMATION_TREND: EMA50>EMA200, price>EMA200, ADX>=20). Incremental improvement, không transformative.",
        tags: ["regime-filter", "APPROVED", "trend"],
        relatedRuns: [
            { runId: "cmmx119iy0agutkhxj2ggp25t", label: "B1_ATR135 Filter B", netR: "561R", trades: 1147, highlight: true },
            { runId: "cmmx14j7l1cultkhxe02goe2c", label: "B4_TP25 Filter B", netR: "1,124R", trades: 1996, highlight: true },
            { runId: "cmmx10bdo0000tkhxxcqu1x6y", label: "B1_ATR135 Filter A", netR: "556R", trades: 1233 },
            { runId: "cmmx13ii60utttkhxhp3yy3lu", label: "B4_TP25 Filter A", netR: "1,139R", trades: 2123 },
        ],
    },
    {
        id: "opt-7",
        code: "OPT-7",
        title: "Go-Live Champion Selection",
        date: "2026-03-19",
        verdict: "APPROVED",
        hypothesis: "Stack tất cả OPT winners (Guards + Filter + Exit) và chọn champion go-live.",
        result: "Champion B (B4_TP25 + Moderate Guards + Trend Filter B): PF 2.21, Net R 1,144, WR 50.8%.",
        keyMetrics: [
            { label: "Champion", value: "B (B4_TP25)", good: true },
            { label: "PF", value: "2.21", good: true },
            { label: "Net R", value: "1,144R", delta: "~803R/year", good: true },
            { label: "Max Consec Loss", value: "74", good: false },
        ],
        details: [
            "4 champions tested: A (B1+Hard), B (B4+Hard), C (B1+Partial), D (B4+Partial)",
            "Champion B: highest Net R + PF + avg R/trade + statistical significance (1,966 trades)",
            "Champion D: best psychology (64.6% WR, median R dương) nhưng Net R thấp hơn 50%",
            "5/6 go-live criteria met — chỉ max consec losses vượt deal-breaker",
            "Forward test plan: Paper 2-4w → Micro 0.5% 4-8w → Scale 1%→2% 8-16w",
            "8 kill switches defined (5 automatic + 3 manual)",
            "Monthly profitable 14/18 months (78%)",
        ],
        recommendation: "CONDITIONAL GO-LIVE với Champion B. Start 0.5% risk, scale sau 5 tháng validation. Kill switches bắt buộc.",
        tags: ["go-live", "APPROVED", "champion", "production"],
        relatedRuns: [
            { runId: "cmmxcnw4m09wvtklwtladtv1d", label: "Champion B (RECOMMENDED)", netR: "1,144R", trades: 1966, highlight: true },
            { runId: "cmmxcmxt90000tklw2ww1ouju", label: "Champion A (B1+Hard)", netR: "569R", trades: 1130 },
            { runId: "cmmxcoz6g0qywtklwcx7qctyw", label: "Champion C (B1+Partial)", netR: "393R", trades: 1135 },
            { runId: "cmmxcpyvs1302tklwbiu3fqt6", label: "Champion D (B4+Partial)", netR: "581R", trades: 1972 },
        ],
    },
    {
        id: "opt-8",
        code: "OPT-8",
        title: "New Guards (Equity Curve, DD Halt, Spacing)",
        date: "2026-03-19",
        verdict: "PARTIAL",
        hypothesis: "3 guard mới (equityCurveFilter, maxDrawdownHalt, minTradeSpacing) sẽ giảm max consec losses từ 74 xuống <15.",
        result: "SPACING_30 tốt nhất: giữ 90% R, giảm consec losses 74→33. BLOCK guards phá hủy 93-95% R.",
        keyMetrics: [
            { label: "SPACING_30 R", value: "1,031R", delta: "90% preserved", good: true },
            { label: "SPACING_30 CL", value: "33", delta: "vs 74 baseline", good: true },
            { label: "COMBO CL", value: "5-11", delta: "vs 74 baseline", good: true },
            { label: "COMBO R", value: "50-74R", delta: "5-7% preserved", good: false },
        ],
        details: [
            "12 configs tested: ECF BLOCK/HALF × EMA 10/20, DD_HALT 5/10/15%, SPACING 30/60, 3 combos",
            "BLOCK guards tạo death spiral — block entries = block recovery = trade count 66-108",
            "HALF_RISK giữ 100% trades + R nhưng consec losses vẫn 40",
            "SPACING_30: best balance — giữ 90% R, giảm 55% consec losses",
            "74 consec losses là vấn đề market regime, KHÔNG phải execution",
            "Cần higher-timeframe regime detection thay vì execution-level guards",
        ],
        recommendation: "Dùng SPACING_30 (minTradeSpacing 30min) + ECF HALF_RISK (EMA 20). Không dùng BLOCK/HALT guards — chúng phá hủy strategy.",
        tags: ["new-guards", "PARTIAL", "spacing", "equity-curve"],
        relatedRuns: [
            { runId: "cmmxdguq936o1tkcwt4bqk5su", label: "SPACING_30 (best balance)", netR: "1,032R", trades: 1677, highlight: true },
            { runId: "cmmxdi9yc3nfrtkcwzv60wykv", label: "SPACING_60", netR: "981R", trades: 1564 },
            { runId: "cmmxdb4jy1dmdtkcwltzna3hh", label: "ECF_HALF_20", netR: "1,144R", trades: 1966 },
            { runId: "cmmxd83ue0000tkcwlzct3v1m", label: "ECF_BLOCK_10", netR: "88R", trades: 86 },
            { runId: "cmmxdl15q4jn3tkcw4l16vbag", label: "COMBO_MODERATE (lowest CL)", netR: "74R", trades: 73 },
            { runId: "cmmxdcj3i1w7ytkcwoutghj0m", label: "DD_HALT_5", netR: "86R", trades: 88 },
        ],
    },
    {
        id: "opt-9",
        code: "OPT-9",
        title: "Burst Cooldown Sweep (4 Strategies × 4 Levels)",
        date: "2026-03-20",
        verdict: "REJECTED",
        hypothesis: "Tìm sweet spot cho burst cooldown giữa Strict (quá mạnh, giết 68-82% trades) và No Guard (full R nhưng DD không kiểm soát).",
        result: "Burst cooldown ở MỌI level đều net-negative cho risk-adjusted returns. Level C (no burst) có R/DD efficiency tốt nhất (5.28).",
        keyMetrics: [
            { label: "Level C R", value: "98%", delta: "best retained", good: true },
            { label: "Level C DD", value: "-6%", delta: "base guards đủ", good: true },
            { label: "R/DD Ratio", value: "5.28", delta: "Level C best", good: true },
            { label: "Burst = Volume", value: "PF unchanged", delta: "không tăng quality", good: false },
        ],
        details: [
            "16 runs: 4 strategies (S3_MOD, S3_NYASN, CHAMP_B, S5_ST) × 4 levels (Strict/A/B/C)",
            "Level C (no burst): 98% R retained, 6% DD reduction — best efficiency",
            "Level B (Light: 8/180min, cd=480): 45% R cho 48% DD reduction — 1:1 neutral",
            "Level A (Moderate: 5/120min, cd=720): 30% R cho 65% DD reduction — over-suppression",
            "Strict (3/60min, cd=720): 20% R cho 75% DD reduction — extreme destruction",
            "PF và WR% gần như KHÔNG ĐỔI qua mọi level → burst là volume filter, không phải quality filter",
            "Base guards (lossStreak, dayCap, sessionCap, throttle, ECF, spacing) đã đủ protection",
        ],
        recommendation: "KHÔNG dùng burst cooldown. Dùng base guards (lossStreakCooldown + dayCap + sessionCap + throttle + ECF + spacing) — chúng giữ 98% R với 6% DD reduction.",
        tags: ["burst-cooldown", "REJECTED", "guard-optimization", "4-strategies"],
        relatedRuns: [
            { runId: "cmmysw02j0004tk70qaqp4u8y", label: "BURST_C CHAMP_B (no burst)", netR: "1,032R", trades: 1677, highlight: true },
            { runId: "cmmyt5s5k0gultkimxcljlimv", label: "BURST_C S3_MOD", netR: "1,486R", trades: 2819, highlight: true },
            { runId: "cmmyt6xw91dcktkim3924vbc2", label: "BURST_C S3_NYASN", netR: "1,232R", trades: 2145 },
            { runId: "cmmysw02o000atk701qa8oivf", label: "BURST_C S5_ST", netR: "927R", trades: 2123 },
            { runId: "cmmyt4rrc0000tkimp5c2upxu", label: "BURST_B CHAMP_B (Light)", netR: "517R", trades: 956 },
            { runId: "cmmysw02i0001tk70931errhw", label: "BURST_A CHAMP_B (Moderate)", netR: "354R", trades: 702 },
        ],
    },
    {
        id: "opt-10",
        code: "OPT-10",
        title: "5-Signal Portfolio & TF Optimization",
        date: "2026-03-20",
        verdict: "APPROVED",
        hypothesis: "Xây portfolio 5 signals đa dạng đạt PF>2.0, >700 trades, max streak <8, DD <10%.",
        result: "Portfolio PF 2.15 đạt target. 622 trades (gần target 700). 2 signals mới EMA Cross đạt PF 3.85 & 2.14.",
        keyMetrics: [
            { label: "Portfolio PF", value: "2.15", delta: "target >2.0", good: true },
            { label: "Total Trades", value: "622", delta: "17 months", good: true },
            { label: "EMA LONG PF", value: "3.85", delta: "49 trades, NEW", good: true },
            { label: "Portfolio DD", value: "~10%", delta: "borderline", good: true },
        ],
        details: [
            "4,000+ backtests run trong 1 session (~4 giờ) sweeping 800 L1 entry variants mỗi signal",
            "5 signals: XAB LONG (PF 1.86, 440 trades), NY BOS LONG (PF 2.13, 64 trades), Smart Trail LONG (PF 2.31, 36 trades), EMA Cross LONG (PF 3.85, 49 trades), EMA Cross SHORT (PF 2.14, 33 trades)",
            "EMA Cross signals 'self-cleaning' — guards never activate (0 activations), không cần burst/throttle",
            "XAB LONG swept 800 variants: PF 1.86→2.36 (+27%), trades 440→1,969 (+4.5x) nhưng chọn LOOSE guard config",
            "RSI(7) optimal cho M5. Session Filter +20% PF nhưng -70% trades",
            "Correlation analysis: EMA Cross LONG↔SHORT rất thấp (2-6% overlap) — excellent diversification",
            "XAB↔NY BOS cao overlap (70-99%) — cùng entry logic, cần quản lý overlap",
            "Elliott Wave signal DEFERRED — block error 'Cannot read undefined.time', cần debug",
        ],
        recommendation: "Deploy 5-signal portfolio. XAB LONG là core (70% volume). EMA Cross signals là alpha-generators với minimal risk. Manage XAB↔NY BOS overlap.",
        tags: ["portfolio", "APPROVED", "5-signals", "EMA-Cross", "diversification"],
        relatedRuns: [],
    },
    {
        id: "opt-11",
        code: "OPT-11",
        title: "Capital Protection Round (CP0-CP4)",
        date: "2026-03-24",
        verdict: "PARTIAL",
        hypothesis: "Progressive guard layers (CP1-CP4) sẽ giảm equity curve DD từ 32.8% xuống ≤20% mà giữ Net PnL >$60K.",
        result: "CP0 (no guards) best PnL $79.5K, PF 1.72. Guards giảm equity DD nhưng CUT 48-73% PnL. CP4 (area cap 2) giảm consec losses 31→17 nhưng chỉ giữ 49% Net R.",
        keyMetrics: [
            { label: "CP0 PnL", value: "$79,523", delta: "baseline best", good: true },
            { label: "CP0 PF", value: "1.72", delta: "highest", good: true },
            { label: "CP4 ConsecL", value: "17", delta: "vs 31 baseline", good: true },
            { label: "CP1-4 PnL", value: "-48 to -73%", delta: "guards cut profit", good: false },
        ],
        details: [
            "5 variants: CP0 (baseline), CP1 (daily cap), CP2 (1.5% risk), CP3 (tighter throttle), CP4 (area cap 2)",
            "CP0: 1,005 trades, $79,523 PnL, 352.5R, WR 50.95%, PF 1.72, equity DD 32.84%",
            "CP1: 995 trades, $41,446 PnL, 354.2R, PF 1.60 — guards block 527 activations, equity DD 35.65% (WORSE)",
            "CP2: 995 trades, $33,925 PnL, 354.2R, PF 1.60 — lower risk 1.5% giảm PnL nhưng R unchanged",
            "CP3: 1,000 trades, $36,476 PnL, 349.2R, PF 1.57 — tighter throttle giảm R thêm",
            "CP4: 525 trades, $21,515 PnL, 172.8R, PF 1.53 — area cap 2 cut 48% trades, giảm consec losses 31→17",
            "Equity curve DD 29-37% ở mọi variant — guards KHÔNG giải quyết DD equity, chỉ giảm PnL",
        ],
        recommendation: "Dùng CP0 (unguarded) nếu chấp nhận 32.8% equity DD. Dùng CP4 (area cap 2) nếu cần max consec losses <20 — đánh đổi 49% Net R.",
        tags: ["capital-protection", "PARTIAL", "equity-DD", "area-cap"],
        relatedRuns: [],
    },
    {
        id: "opt-12",
        code: "OPT-12",
        title: "Out-of-Sample (OOS) Validation",
        date: "2026-03-24",
        verdict: "PARTIAL",
        hypothesis: "2 candidates (CAP5_TP25 alpha lane, CAP5_LB96 safety lane) sẽ PASS OOS validation trên window 2023-2026.",
        result: "MARGINAL PASS — cả 2 candidates positive PnL nhưng equity DD vượt fit window. CAP5_TP25 higher PnL ($105K vs $79.5K) nhưng DD 44.3% vs 32.8%.",
        keyMetrics: [
            { label: "TP25 PnL", value: "$105,351", delta: "alpha lane", good: true },
            { label: "TP25 PF", value: "1.88", delta: "higher", good: true },
            { label: "LB96 WR", value: "50.95%", delta: "safer", good: true },
            { label: "OOS Verdict", value: "MARGINAL", delta: "positive nhưng DD concern", good: false },
        ],
        details: [
            "Fit window: 2019-2023 (4 năm), Test window: 2023-2026 (3.25 năm)",
            "CAP5_TP25 (alpha): 1,005 trades, $105,351 PnL, 460R, WR 47.66%, PF 1.88, equity DD 44.32%",
            "CAP5_LB96 (safety): 1,005 trades, $79,523 PnL, 352.5R, WR 50.95%, PF 1.72, equity DD 32.84%",
            "Cả 2 fit window = 0 trades (M5 data gap 2019-2022) → không so sánh fit vs test được chính xác",
            "MARGINAL: positive PnL xác nhận edge thực, nhưng equity DD cao (32-44%) cần monitoring",
            "CAP5_LB96 an toàn hơn: WR cao hơn (50.95 vs 47.66%), DD thấp hơn (32.8 vs 44.3%), consec losses thấp hơn (31 vs 36)",
        ],
        recommendation: "Dùng CAP5_LB96 (safety lane) cho live — WR 51%, PF 1.72, equity DD 32.8%. CAP5_TP25 làm backup alpha nếu muốn max PnL ($105K).",
        tags: ["OOS", "PARTIAL", "validation", "fit-test", "MARGINAL"],
        relatedRuns: [],
    },
    {
        id: "opt-13",
        code: "OPT-13",
        title: "Multi-TF Strategy Expansion (4TF Batch)",
        date: "2026-03-25",
        verdict: "INFO",
        hypothesis: "Mở rộng signal universe ra 15m, 1h, 2h, 4h với 8+ signal types mới để tìm edge trên nhiều timeframes.",
        result: "28 runs completed. Top performers: BOS_FVG 2H (PF 2.89), PD_LEVEL_BREAK 4H (PF 3.85), SESSION_BURST 1H (PF 1.78). Volman signals failed (0 trades).",
        keyMetrics: [
            { label: "Total Runs", value: "28+", delta: "4 timeframes", good: true },
            { label: "Best PF", value: "3.85", delta: "PD_LEVEL 4H", good: true },
            { label: "Best NetR", value: "617R", delta: "SESSION_BURST 1H", good: true },
            { label: "Volman", value: "0 trades", delta: "ALL FAILED", good: false },
        ],
        details: [
            "15M: ABC LONG best (PF 1.24, 497R, 3,565 trades). London Burst LONG PF 1.08 (78R). Các signal mới (OB_RECLAIM, OB_FIB, CHOCH_BOS) đều PF <1 trên 15m.",
            "1H: CHOCH_BOS PF 1.99 (chỉ 22 trades — low significance). SESSION_BURST PF 1.78 (617R, 1,601 trades — STRONG). PD_LEVEL_BREAK PF 1.76 (354R, 1,108 trades).",
            "2H: BOS_FVG PF 2.89 (396R, 638 trades — BEST DISCOVERY). ABC LONG PF 2.17 (204R, 382 trades). TREND_PULLBACK PF 1.56 (150R).",
            "4H: PD_LEVEL_BREAK PF 3.85 (213R, 304 trades — HIGHEST PF). SESSION_BURST PF 1.75 (228R, 597 trades). OB_FIB PF 1.70 (65R, 230 trades).",
            "Volman (Pressure/Breakout/False Break): 0 trades trên tất cả TF — signal logic cần review",
            "2H và 4H timeframes cho PF cao hơn M5/15M nhưng ít trades hơn",
            "Phase 1 XAU: 12 runs (3 signal families × 2 sides × 2 TF), chỉ ABC LONG 1H profitable (PF 1.28, 59R)",
        ],
        recommendation: "Ưu tiên: BOS_FVG 2H (PF 2.89), PD_LEVEL_BREAK 4H (PF 3.85), SESSION_BURST 1H (PF 1.78) cho portfolio expansion. Debug Volman signals. 2H/4H = higher quality trades.",
        tags: ["multi-TF", "INFO", "4TF", "expansion", "BOS_FVG", "PD_LEVEL"],
        relatedRuns: [
            { runId: "cmn4vuf8e00qwtk4g1lvbwraj", label: "ABC LONG 1H", netR: "59R", trades: 374, highlight: true },
            { runId: "cmn4vuug70000tk88vcbrasti", label: "ABC LONG 15M (phase1)", netR: "-233R", trades: 997 },
            { runId: "cmn4vux1c07p1tk88j19m6ca2", label: "ABC SHORT 15M", netR: "-41R", trades: 1048 },
        ],
    },
];

const configRules: ConfigRule[] = [
    {
        id: "do-1",
        type: "DO",
        title: "Dùng Moderate Trade Guards",
        description: "sessionCap 3L/-3R, dayCap 4L/-4R, cooldown 5L→720min, throttle 3→1.5% + 5→1.0%",
        evidence: "OPT-2: R preserved 99-104%, PF +4-6%",
        impact: "Bảo vệ vốn mà không giảm lợi nhuận",
    },
    {
        id: "do-2",
        type: "DO",
        title: "Bật Min Trade Spacing 30 min",
        description: "Khoảng cách tối thiểu 30 phút giữa exit lệnh trước và entry lệnh sau",
        evidence: "OPT-8: Giữ 90% Net R, giảm 55% consecutive losses (74→33)",
        impact: "Ngăn clustering lệnh liên tiếp, cải thiện PF lên 2.28",
    },
    {
        id: "do-3",
        type: "DO",
        title: "Bật Trend Filter (CONFIRMATION_TREND)",
        description: "EMA(50) > EMA(200), price > EMA(200), ADX >= 20",
        evidence: "OPT-6: R preserved 86-90%, PF +0.07-0.13, max DD giảm",
        impact: "Filter 18% entries yếu, tăng quality per trade",
    },
    {
        id: "do-4",
        type: "DO",
        title: "Giữ HARD_SIGNAL_TP cho max profit",
        description: "Exit tại signal TP price, SL tại -1R. Đơn giản nhất và profitable nhất.",
        evidence: "OPT-3: HARD_SIGNAL_TP cho Net R cao nhất vs tất cả exit profiles",
        impact: "Tối đa hóa lợi nhuận dài hạn",
    },
    {
        id: "do-5",
        type: "DO",
        title: "Dùng Equity Curve Filter HALF_RISK",
        description: "Khi equity < EMA(20 trades), giảm position size 50% thay vì block",
        evidence: "OPT-8: Giữ 100% trades + R, giảm dollar exposure khi drawdown",
        impact: "Bảo vệ vốn thực tế mà không mất edge",
    },
    {
        id: "dont-1",
        type: "DONT",
        title: "KHÔNG cắt London session",
        description: "Strategy IS a London strategy. Hours 10-12 UTC = 90% tổng edge.",
        evidence: "OPT-1: Cắt London → Net R giảm 53-59%, WR giảm 5-7pp",
        impact: "Phá hủy strategy hoàn toàn nếu loại London",
    },
    {
        id: "dont-2",
        type: "DONT",
        title: "KHÔNG dùng BLOCK guards (ECF BLOCK, DD Halt)",
        description: "Block entries tạo death spiral — block luôn recovery trades, trade count giảm 93-95%.",
        evidence: "OPT-8: ECF_BLOCK_10 chỉ giữ 86 trades (vs 1,966), Net R 88R (vs 1,144R)",
        impact: "Hệ thống gần như ngừng hoạt động sau drawdown đầu tiên",
    },
    {
        id: "dont-3",
        type: "DONT",
        title: "KHÔNG deploy SHORT side standalone",
        description: "SHORT XAU có PF 0.45-0.50. XAU có long bias lịch sử rất mạnh.",
        evidence: "OPT-5: Tất cả 4 SHORT variants thua. 2025 PF = 0.24-0.29",
        impact: "Lỗ nặng, đặc biệt trong bull market",
    },
    {
        id: "dont-4",
        type: "DONT",
        title: "KHÔNG dùng Burst Cooldown",
        description: "Burst cooldown ở MỌI level đều net-negative cho risk-adjusted returns. Nó chỉ giảm volume, không tăng quality (PF, WR unchanged).",
        evidence: "OPT-9: 16 runs × 4 strategies. Level C (no burst) R/DD=5.28 > Level B=4.11 > A=4.22 > Strict=3.84",
        impact: "Burst cooldown phá hủy 55-80% Net R mà không cải thiện PF hay WR",
    },
    {
        id: "caution-1",
        type: "CAUTION",
        title: "Max consecutive losses 31-74 là rủi ro cấu trúc",
        description: "Không giảm được bằng guards/filters — đây là market regime problem. CP4 (area cap 2) giảm xuống 17 nhưng cắt 49% Net R.",
        evidence: "OPT-2 + OPT-8 + OPT-9 + OPT-11: Guards không giảm consec losses hiệu quả. Chỉ area cap tightening (CP4) giảm 31→17.",
        impact: "Cần kill switches + manual monitoring để phát hiện sớm",
    },
    {
        id: "caution-2",
        type: "CAUTION",
        title: "Equity curve DD 32-44% cần quản lý",
        description: "CAP5_LB96 equity DD 32.84%, CAP5_TP25 equity DD 44.32%. Guards KHÔNG giải quyết equity DD — CP1-CP4 đều 29-37%.",
        evidence: "OPT-11 + OPT-12: CP0-CP4 equity DD 29-37%. OOS validation cả 2 candidates MARGINAL do DD concern.",
        impact: "Phải chấp nhận equity drawdown 30%+ hoặc giảm risk per trade",
    },
    {
        id: "caution-3",
        type: "CAUTION",
        title: "Hours 7-9 UTC có edge âm",
        description: "Early London (7-9 UTC) có combined -22R. Chưa filter riêng vùng này.",
        evidence: "OPT-1: Hourly breakdown cho thấy hours 7-9 kéo London WR xuống",
        impact: "Opportunity: filter early London có thể cải thiện 2-3% Net R mà không phá strategy",
    },
    {
        id: "caution-4",
        type: "CAUTION",
        title: "M5 data gap 2019-2022 làm OOS validation MARGINAL",
        description: "M5 candle data chỉ từ Oct 2024. Fit window (2019-2023) = 0 trades → không so sánh fit vs test chính xác.",
        evidence: "OPT-12: Cả 2 OOS candidates MARGINAL. OPT-4 BLOCKED vẫn chưa resolve hoàn toàn.",
        impact: "OOS validation chưa đủ tin cậy — cần monitor live performance sát sao",
    },
];

/* ------------------------------------------------------------------ */
/*  Verdict badge                                                      */
/* ------------------------------------------------------------------ */
function VerdictBadge({ verdict }: { verdict: Verdict }) {
    const config = {
        APPROVED: { icon: CheckCircle2, cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25", label: "APPROVED" },
        REJECTED: { icon: XCircle, cls: "bg-red-500/15 text-red-400 border-red-500/25", label: "REJECTED" },
        PARTIAL: { icon: AlertTriangle, cls: "bg-amber-500/15 text-amber-400 border-amber-500/25", label: "PARTIAL" },
        BLOCKED: { icon: Ban, cls: "bg-purple-500/15 text-purple-400 border-purple-500/25", label: "BLOCKED" },
        INFO: { icon: BookOpen, cls: "bg-sky-500/15 text-sky-400 border-sky-500/25", label: "BASELINE" },
    }[verdict];
    const Icon = config.icon;
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${config.cls}`}>
            <Icon className="h-3 w-3" />
            {config.label}
        </span>
    );
}

/* ------------------------------------------------------------------ */
/*  Experiment card (collapsible)                                      */
/* ------------------------------------------------------------------ */
function ExperimentCard({ exp, isOpen, onToggle }: { exp: Experiment; isOpen: boolean; onToggle: () => void }) {
    return (
        <div className={`rounded-2xl border transition-colors ${
            exp.verdict === "APPROVED" ? "border-emerald-500/20" :
            exp.verdict === "REJECTED" ? "border-red-500/20" :
            exp.verdict === "BLOCKED" ? "border-purple-500/20" :
            exp.verdict === "PARTIAL" ? "border-amber-500/20" :
            "border-border-muted"
        } bg-bg-secondary/50`}>
            <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                {isOpen ? <ChevronDown className="h-4 w-4 text-text-muted shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold text-text-muted">{exp.code}</span>
                        <VerdictBadge verdict={exp.verdict} />
                        <span className="text-xs font-bold text-text-primary truncate">{exp.title}</span>
                    </div>
                    <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-1">{exp.result}</p>
                </div>
                <span className="text-[10px] text-text-muted shrink-0">{exp.date}</span>
            </button>

            {isOpen && (
                <div className="border-t border-border-muted/50 px-4 py-4 space-y-4">
                    {/* Hypothesis */}
                    <div className="flex gap-2">
                        <FlaskConical className="h-3.5 w-3.5 text-accent mt-0.5 shrink-0" />
                        <div>
                            <span className="text-[10px] font-bold text-text-muted uppercase">Hypothesis</span>
                            <p className="text-xs text-text-secondary">{exp.hypothesis}</p>
                        </div>
                    </div>

                    {/* Key Metrics */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {exp.keyMetrics.map((m, i) => (
                            <div key={i} className="rounded-xl border border-border-muted/50 bg-bg-primary/40 px-3 py-2">
                                <div className="text-[10px] text-text-muted">{m.label}</div>
                                <div className={`text-sm font-bold ${m.good === true ? "text-emerald-400" : m.good === false ? "text-red-400" : "text-text-primary"}`}>
                                    {m.value}
                                </div>
                                {m.delta && <div className="text-[10px] text-text-muted">{m.delta}</div>}
                            </div>
                        ))}
                    </div>

                    {/* Details */}
                    <div>
                        <span className="text-[10px] font-bold text-text-muted uppercase">Chi tiết</span>
                        <ul className="mt-1 space-y-0.5">
                            {exp.details.map((d, i) => (
                                <li key={i} className="flex gap-2 text-xs text-text-secondary">
                                    <span className="text-text-muted mt-1 shrink-0">•</span>
                                    <span>{d}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Recommendation */}
                    <div className="flex gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
                        <Lightbulb className="h-3.5 w-3.5 text-accent mt-0.5 shrink-0" />
                        <div>
                            <span className="text-[10px] font-bold text-accent uppercase">Recommendation</span>
                            <p className="text-xs text-text-secondary">{exp.recommendation}</p>
                        </div>
                    </div>

                    {/* Related Backtest Runs */}
                    {exp.relatedRuns && exp.relatedRuns.length > 0 && (
                        <div>
                            <span className="text-[10px] font-bold text-text-muted uppercase">Backtest Runs</span>
                            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                                {exp.relatedRuns.map((run) => (
                                    <div key={run.runId} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${run.highlight ? "border-accent/25 bg-accent/5" : "border-border-muted/50 bg-bg-primary/30"}`}>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-bold text-text-primary truncate">{run.label}</div>
                                            <div className="text-[10px] text-text-muted">{run.trades} trades | {run.netR}</div>
                                        </div>
                                        <div className="flex gap-1 shrink-0">
                                            <Link
                                                href={`/engine?run=${run.runId}`}
                                                className="flex items-center gap-1 rounded-lg border border-border-muted bg-bg-primary/60 px-2 py-1 text-[10px] font-bold text-accent hover:bg-accent/10 hover:border-accent/30 transition"
                                            >
                                                <BarChart3 className="h-3 w-3" />
                                                Engine
                                            </Link>
                                            <Link
                                                href={`/signals/backtests/${run.runId}`}
                                                className="flex items-center gap-1 rounded-lg border border-border-muted bg-bg-primary/60 px-2 py-1 text-[10px] font-bold text-text-secondary hover:bg-bg-primary hover:text-text-primary transition"
                                            >
                                                <ExternalLink className="h-3 w-3" />
                                                Detail
                                            </Link>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1">
                        {exp.tags.map((t) => (
                            <span key={t} className="rounded-full border border-border-muted bg-bg-primary/40 px-2 py-0.5 text-[10px] text-text-muted">{t}</span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Config rule card                                                   */
/* ------------------------------------------------------------------ */
function ConfigRuleCard({ rule }: { rule: ConfigRule }) {
    const config = {
        DO: { icon: ThumbsUp, cls: "border-emerald-500/20 bg-emerald-500/5", iconCls: "text-emerald-400", label: "NÊN LÀM" },
        DONT: { icon: ThumbsDown, cls: "border-red-500/20 bg-red-500/5", iconCls: "text-red-400", label: "KHÔNG LÀM" },
        CAUTION: { icon: AlertTriangle, cls: "border-amber-500/20 bg-amber-500/5", iconCls: "text-amber-400", label: "LƯU Ý" },
    }[rule.type];
    const Icon = config.icon;

    return (
        <div className={`rounded-xl border ${config.cls} px-4 py-3 space-y-2`}>
            <div className="flex items-start gap-2">
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.iconCls}`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold ${config.iconCls}`}>{config.label}</span>
                    </div>
                    <h4 className="text-xs font-bold text-text-primary mt-0.5">{rule.title}</h4>
                    <p className="text-[11px] text-text-secondary mt-1">{rule.description}</p>
                </div>
            </div>
            <div className="pl-6 space-y-1">
                <div className="text-[10px] text-text-muted"><strong>Evidence:</strong> {rule.evidence}</div>
                <div className="text-[10px] text-text-muted"><strong>Impact:</strong> {rule.impact}</div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */
type TabKey = "all-runs" | "timeline" | "rules" | "champion";

interface RunListItem {
    id: string;
    name: string;
    status: string;
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    startedAt: string;
    finishedAt: string | null;
    initialEquity: number;
    riskPercent: number;
    createdAt: string;
}

export default function BacktestKnowledgeBase() {
    const [tab, setTab] = useState<TabKey>("all-runs");
    const [openExps, setOpenExps] = useState<Set<string>>(new Set(["opt-7"]));
    const [search, setSearch] = useState("");
    const [verdictFilter, setVerdictFilter] = useState<Verdict | "ALL">("ALL");

    // All Runs tab state
    const [allRuns, setAllRuns] = useState<RunListItem[]>([]);
    const [allRunsLoading, setAllRunsLoading] = useState(false);
    const [allRunsSearch, setAllRunsSearch] = useState("");
    const [allRunsStatusFilter, setAllRunsStatusFilter] = useState<"ALL" | "COMPLETED" | "RUNNING" | "FAILED">("ALL");

    const apiUrl = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001") : "";

    const fetchAllRuns = useCallback(async () => {
        setAllRunsLoading(true);
        try {
            const res = await fetch(`${apiUrl}/api/signals/backtests`, { credentials: "include" });
            if (res.ok) {
                const json = await res.json();
                setAllRuns(json.data ?? []);
            }
        } catch { /* ignore */ }
        setAllRunsLoading(false);
    }, [apiUrl]);

    useEffect(() => {
        if (tab === "all-runs" && allRuns.length === 0 && !allRunsLoading) {
            fetchAllRuns();
        }
    }, [tab, allRuns.length, allRunsLoading, fetchAllRuns]);

    const filteredAllRuns = allRuns
        .filter((r) => {
            if (allRunsStatusFilter !== "ALL" && r.status !== allRunsStatusFilter) return false;
            if (!allRunsSearch) return true;
            const q = allRunsSearch.toLowerCase();
            return (r.name?.toLowerCase().includes(q) || r.signalCode?.toLowerCase().includes(q) || r.symbol?.toLowerCase().includes(q));
        });

    const toggleExp = (id: string) => {
        setOpenExps((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const filteredExps = experiments.filter((e) => {
        if (verdictFilter !== "ALL" && e.verdict !== verdictFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            return (
                e.title.toLowerCase().includes(q) ||
                e.result.toLowerCase().includes(q) ||
                e.recommendation.toLowerCase().includes(q) ||
                e.tags.some((t) => t.toLowerCase().includes(q))
            );
        }
        return true;
    });

    const tabs: { key: TabKey; icon: typeof BookOpen; label: string }[] = [
        { key: "all-runs", icon: Layers, label: "All Runs" },
        { key: "timeline", icon: Clock, label: "Optimization Timeline" },
        { key: "rules", icon: Shield, label: "Config Rules" },
        { key: "champion", icon: Target, label: "Production Config" },
    ];

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <header className="shrink-0 border-b border-border-muted bg-bg-secondary/40 px-6 py-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10">
                        <Database className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                        <h1 className="text-base font-black text-text-primary">Backtest Knowledge Base</h1>
                        <p className="text-[11px] text-text-muted">Lịch sử optimization, config rules, và production decisions — Updated 2026-03-25</p>
                    </div>
                </div>
                {/* Tabs */}
                <div className="mt-4 flex gap-1">
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition ${
                                tab === t.key
                                    ? "bg-accent/10 text-accent border border-accent/20"
                                    : "text-text-secondary hover:bg-bg-primary/50 border border-transparent"
                            }`}
                        >
                            <t.icon className="h-3.5 w-3.5" />
                            {t.label}
                        </button>
                    ))}
                </div>
            </header>

            {/* Content */}
            <main className="flex-1 overflow-y-auto p-6">
                <div className="mx-auto max-w-5xl space-y-4">
                    {/* TAB: All Runs */}
                    {tab === "all-runs" && (
                        <>
                            {/* Controls */}
                            <div className="flex gap-2 flex-wrap items-center">
                                <div className="relative flex-1 min-w-[200px]">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
                                    <input
                                        type="text"
                                        value={allRunsSearch}
                                        onChange={(e) => setAllRunsSearch(e.target.value)}
                                        placeholder="Search by name, signal code, symbol..."
                                        className="w-full rounded-xl border border-border-muted bg-bg-primary/60 py-2 pl-9 pr-3 text-xs text-text-primary placeholder:text-text-muted"
                                    />
                                </div>
                                {(["ALL", "COMPLETED", "RUNNING", "FAILED"] as const).map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => setAllRunsStatusFilter(s)}
                                        className={`rounded-xl px-3 py-2 text-[10px] font-bold transition ${
                                            allRunsStatusFilter === s
                                                ? "bg-accent/10 text-accent border border-accent/20"
                                                : "text-text-muted border border-border-muted hover:bg-bg-primary/50"
                                        }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                                <button
                                    onClick={fetchAllRuns}
                                    className="rounded-xl border border-border-muted bg-bg-primary/60 px-3 py-2 text-xs font-bold text-text-secondary hover:bg-bg-primary hover:text-text-primary transition"
                                >
                                    Refresh
                                </button>
                            </div>

                            {/* Summary */}
                            <div className="grid grid-cols-4 gap-2">
                                <div className="rounded-xl border border-border-muted bg-bg-secondary/50 px-3 py-2 text-center">
                                    <div className="text-lg font-black text-text-primary">{allRuns.length}</div>
                                    <div className="text-[10px] text-text-muted">Total Runs</div>
                                </div>
                                <div className="rounded-xl border border-border-muted bg-bg-secondary/50 px-3 py-2 text-center">
                                    <div className="text-lg font-black text-emerald-400">{allRuns.filter((r) => r.status === "COMPLETED").length}</div>
                                    <div className="text-[10px] text-text-muted">Completed</div>
                                </div>
                                <div className="rounded-xl border border-border-muted bg-bg-secondary/50 px-3 py-2 text-center">
                                    <div className="text-lg font-black text-amber-400">{allRuns.filter((r) => r.status === "RUNNING" || r.status === "PENDING").length}</div>
                                    <div className="text-[10px] text-text-muted">Running</div>
                                </div>
                                <div className="rounded-xl border border-border-muted bg-bg-secondary/50 px-3 py-2 text-center">
                                    <div className="text-lg font-black text-red-400">{allRuns.filter((r) => r.status === "FAILED" || r.status === "CANCELED").length}</div>
                                    <div className="text-[10px] text-text-muted">Failed</div>
                                </div>
                            </div>

                            {/* Loading */}
                            {allRunsLoading && (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                                    <span className="ml-2 text-xs text-text-muted">Loading backtest runs...</span>
                                </div>
                            )}

                            {/* Runs table */}
                            {!allRunsLoading && (
                                <div className="overflow-x-auto rounded-2xl border border-border-muted">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-border-muted bg-bg-secondary/50">
                                                <th className="px-3 py-2.5 text-left font-bold text-text-muted">Name</th>
                                                <th className="px-2 py-2.5 text-left font-bold text-text-muted">Signal</th>
                                                <th className="px-2 py-2.5 text-center font-bold text-text-muted">Status</th>
                                                <th className="px-2 py-2.5 text-right font-bold text-text-muted">Risk</th>
                                                <th className="px-2 py-2.5 text-right font-bold text-text-muted">Period</th>
                                                <th className="px-2 py-2.5 text-right font-bold text-text-muted">Created</th>
                                                <th className="px-2 py-2.5 text-center font-bold text-text-muted">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredAllRuns.map((run) => {
                                                const statusCls = run.status === "COMPLETED"
                                                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                                                    : run.status === "RUNNING" || run.status === "PENDING"
                                                        ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
                                                        : "bg-red-500/15 text-red-400 border-red-500/25";
                                                const periodFrom = run.startedAt ? new Date(run.startedAt).toLocaleDateString() : "";
                                                const periodTo = run.finishedAt ? new Date(run.finishedAt).toLocaleDateString() : "";
                                                return (
                                                    <tr key={run.id} className="border-b border-border-muted/30 hover:bg-bg-primary/30 transition">
                                                        <td className="px-3 py-2 max-w-[300px]">
                                                            <div className="truncate font-semibold text-text-primary" title={run.name}>{run.name}</div>
                                                            <div className="text-[10px] text-text-muted">{run.symbol} {run.timeframe}</div>
                                                        </td>
                                                        <td className="px-2 py-2 text-text-secondary">
                                                            <span className="rounded bg-bg-primary/60 px-1.5 py-0.5 text-[10px] font-mono">{run.signalCode}</span>
                                                        </td>
                                                        <td className="px-2 py-2 text-center">
                                                            <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusCls}`}>{run.status}</span>
                                                        </td>
                                                        <td className="px-2 py-2 text-right text-text-secondary font-mono text-[10px]">
                                                            ${run.initialEquity.toLocaleString()} / {run.riskPercent}%
                                                        </td>
                                                        <td className="px-2 py-2 text-right text-text-muted text-[10px]">
                                                            {periodFrom} → {periodTo}
                                                        </td>
                                                        <td className="px-2 py-2 text-right text-text-muted text-[10px]">
                                                            {new Date(run.createdAt).toLocaleDateString()}
                                                        </td>
                                                        <td className="px-2 py-2">
                                                            <div className="flex gap-1 justify-center">
                                                                <Link
                                                                    href={`/engine?run=${run.id}`}
                                                                    className="flex items-center gap-1 rounded-lg border border-border-muted bg-bg-primary/60 px-2 py-1 text-[10px] font-bold text-accent hover:bg-accent/10 hover:border-accent/30 transition"
                                                                >
                                                                    <BarChart3 className="h-3 w-3" />
                                                                    Engine
                                                                </Link>
                                                                <Link
                                                                    href={`/signals/backtests/${run.id}`}
                                                                    className="flex items-center gap-1 rounded-lg border border-border-muted bg-bg-primary/60 px-2 py-1 text-[10px] font-bold text-text-secondary hover:bg-bg-primary hover:text-text-primary transition"
                                                                >
                                                                    <ExternalLink className="h-3 w-3" />
                                                                    Detail
                                                                </Link>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {filteredAllRuns.length === 0 && !allRunsLoading && (
                                                <tr>
                                                    <td colSpan={7} className="px-6 py-12 text-center text-xs text-text-muted">
                                                        {allRuns.length === 0 ? "No backtest runs found. Run some backtests first." : "No runs match your search."}
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div className="text-[10px] text-text-muted text-center">
                                Showing {filteredAllRuns.length} of {allRuns.length} runs. New backtests appear here automatically.
                            </div>
                        </>
                    )}

                    {/* TAB: Timeline */}
                    {tab === "timeline" && (
                        <>
                            {/* Filters */}
                            <div className="flex gap-2 flex-wrap">
                                <div className="relative flex-1 min-w-[200px]">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Search experiments..."
                                        className="w-full rounded-xl border border-border-muted bg-bg-primary/60 py-2 pl-9 pr-3 text-xs text-text-primary placeholder:text-text-muted"
                                    />
                                </div>
                                {(["ALL", "APPROVED", "REJECTED", "PARTIAL", "BLOCKED", "INFO"] as const).map((v) => (
                                    <button
                                        key={v}
                                        onClick={() => setVerdictFilter(v)}
                                        className={`rounded-xl px-3 py-2 text-[10px] font-bold transition ${
                                            verdictFilter === v
                                                ? "bg-accent/10 text-accent border border-accent/20"
                                                : "text-text-muted border border-border-muted hover:bg-bg-primary/50"
                                        }`}
                                    >
                                        {v}
                                    </button>
                                ))}
                            </div>
                            {/* Summary stats */}
                            <div className="grid grid-cols-5 gap-2">
                                {[
                                    { label: "Total", value: experiments.length, icon: FlaskConical, cls: "text-text-primary" },
                                    { label: "Approved", value: experiments.filter((e) => e.verdict === "APPROVED").length, icon: CheckCircle2, cls: "text-emerald-400" },
                                    { label: "Rejected", value: experiments.filter((e) => e.verdict === "REJECTED").length, icon: XCircle, cls: "text-red-400" },
                                    { label: "Partial", value: experiments.filter((e) => e.verdict === "PARTIAL").length, icon: AlertTriangle, cls: "text-amber-400" },
                                    { label: "Blocked", value: experiments.filter((e) => e.verdict === "BLOCKED").length, icon: Ban, cls: "text-purple-400" },
                                ].map((s) => (
                                    <div key={s.label} className="rounded-xl border border-border-muted bg-bg-secondary/50 px-3 py-2 text-center">
                                        <s.icon className={`h-4 w-4 mx-auto ${s.cls}`} />
                                        <div className={`text-lg font-black ${s.cls}`}>{s.value}</div>
                                        <div className="text-[10px] text-text-muted">{s.label}</div>
                                    </div>
                                ))}
                            </div>
                            {/* Experiment list */}
                            <div className="space-y-2">
                                {filteredExps.map((exp) => (
                                    <ExperimentCard key={exp.id} exp={exp} isOpen={openExps.has(exp.id)} onToggle={() => toggleExp(exp.id)} />
                                ))}
                                {filteredExps.length === 0 && (
                                    <div className="rounded-xl border border-border-muted bg-bg-secondary/30 px-6 py-12 text-center text-xs text-text-muted">
                                        No experiments match your filter.
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* TAB: Rules */}
                    {tab === "rules" && (
                        <div className="space-y-6">
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <ThumbsUp className="h-4 w-4 text-emerald-400" />
                                    <h3 className="text-sm font-bold text-text-primary">NÊN LÀM — Configs tốt đã validate</h3>
                                </div>
                                <div className="space-y-2">
                                    {configRules.filter((r) => r.type === "DO").map((r) => <ConfigRuleCard key={r.id} rule={r} />)}
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <ThumbsDown className="h-4 w-4 text-red-400" />
                                    <h3 className="text-sm font-bold text-text-primary">KHÔNG LÀM — Configs gây hại đã chứng minh</h3>
                                </div>
                                <div className="space-y-2">
                                    {configRules.filter((r) => r.type === "DONT").map((r) => <ConfigRuleCard key={r.id} rule={r} />)}
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                                    <h3 className="text-sm font-bold text-text-primary">LƯU Ý — Rủi ro cần theo dõi</h3>
                                </div>
                                <div className="space-y-2">
                                    {configRules.filter((r) => r.type === "CAUTION").map((r) => <ConfigRuleCard key={r.id} rule={r} />)}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB: Production Config */}
                    {tab === "champion" && (
                        <div className="space-y-6">
                            {/* Champion card */}
                            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-6 py-5">
                                <div className="flex items-center gap-3 mb-4">
                                    <Rocket className="h-5 w-5 text-emerald-400" />
                                    <div>
                                        <h3 className="text-sm font-black text-text-primary">CAP5_LB96 — Production Config (Updated 2026-03-25)</h3>
                                        <p className="text-[11px] text-text-muted">LB96 + Base Guards (no burst) + HARD_SIGNAL_TP | Validated OOS: $79.5K PnL, WR 51%</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 mb-4">
                                    {[
                                        { label: "PF", value: "1.72" },
                                        { label: "WR", value: "50.95%" },
                                        { label: "Net R", value: "352.5" },
                                        { label: "Trades", value: "1,005" },
                                        { label: "Net PnL", value: "$79,523" },
                                        { label: "Eq DD", value: "32.84%" },
                                    ].map((m) => (
                                        <div key={m.label} className="rounded-xl border border-emerald-500/15 bg-bg-primary/40 px-3 py-2 text-center">
                                            <div className="text-[10px] text-text-muted">{m.label}</div>
                                            <div className="text-sm font-bold text-emerald-400">{m.value}</div>
                                        </div>
                                    ))}
                                </div>

                                <h4 className="text-xs font-bold text-text-primary mb-2">Signal Definition</h4>
                                <div className="rounded-xl border border-border-muted bg-bg-primary/60 px-4 py-3 text-xs text-text-secondary space-y-1 mb-4">
                                    <div><strong>Code:</strong> SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG v1</div>
                                    <div><strong>Symbol:</strong> XAUUSD | <strong>TF:</strong> M5 | <strong>Side:</strong> LONG</div>
                                    <div><strong>Geometry:</strong> Area cap 5, reset 8, 0.75R price distance, ATR multiplier 1.15, stop lookback 96</div>
                                    <div><strong>Blocks:</strong> SESSION_FILTER (07-13 UTC) + ASIAN_HIGH_BREAKOUT + ATR_EXPANSION (1.2x) + RSI(&gt;55) + CONFIRMATION_TREND</div>
                                    <div><strong>TP:</strong> 2.5R | <strong>SL:</strong> 96-bar structure low + 0.2x ATR | <strong>Exit:</strong> HARD_SIGNAL_TP</div>
                                    <div><strong>Period:</strong> 2019-01-01 → 2026-03-14 | <strong>Risk:</strong> 2% | <strong>Equity:</strong> $10,000</div>
                                </div>

                                <h4 className="text-xs font-bold text-text-primary mb-2">OOS Validation (2026-03-24)</h4>
                                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-text-secondary space-y-1 mb-4">
                                    <div><strong>Verdict:</strong> <span className="text-amber-400 font-bold">MARGINAL PASS</span> — Positive PnL xác nhận edge thực</div>
                                    <div><strong>Full Window:</strong> 1,005 trades | $79,523 PnL | 352.5R | WR 50.95% | PF 1.72</div>
                                    <div><strong>Max Consec Losses:</strong> 31 | <strong>Equity DD:</strong> 32.84%</div>
                                    <div><strong>Note:</strong> M5 data gap 2019-2022 → fit window = 0 trades, chỉ test window có data</div>
                                </div>

                                <h4 className="text-xs font-bold text-text-primary mb-2">Execution Config JSON (Updated — No Burst Guard)</h4>
                                <pre className="rounded-xl border border-border-muted bg-bg-primary/60 px-4 py-3 text-[11px] text-text-secondary overflow-x-auto leading-relaxed">
{`{
  "entryFeeBps": 4,
  "exitFeeBps": 4,
  "entrySlippageBps": 2,
  "exitSlippageBps": 2,
  "orderTiming": "NEXT_BAR_OPEN",
  "stopLoss": { "mode": "SIGNAL_PRICE" },
  "takeProfit": { "mode": "SIGNAL_PRICE" },
  "positionSizing": { "mode": "RISK_BASED" },
  "tradeGuards": {
    "sessionLossCap": { "maxLosses": 3, "maxNetR": 3.0 },
    "dayLossCap": { "maxLosses": 3, "maxNetR": 5.0 },
    "lossStreakCooldown": { "afterLosses": 3, "cooldownMinutes": 720 },
    "lossStreakThrottle": {
      "steps": [
        { "afterLosses": 2, "riskPercent": 1.5 },
        { "afterLosses": 3, "riskPercent": 1.0 },
        { "afterLosses": 5, "riskPercent": 0.5 }
      ]
    },
    "equityCurveFilter": { "emaTrades": 20, "action": "HALF_RISK" },
    "minTradeSpacing": { "minSpacingMinutes": 30 }
  }
}`}
                                </pre>

                                <h4 className="text-xs font-bold text-text-primary mt-4 mb-2">Alternative: CAP5_TP25 (Alpha Lane)</h4>
                                <div className="rounded-xl border border-border-muted bg-bg-primary/60 px-4 py-3 text-xs text-text-secondary space-y-1">
                                    <div><strong>Geometry:</strong> TP 2.5R, area cap 5, ATR 1.15 (higher risk, higher reward)</div>
                                    <div><strong>Full Window:</strong> 1,005 trades | <strong className="text-emerald-400">$105,351 PnL</strong> | 460R | WR 47.66% | PF 1.88</div>
                                    <div><strong>Max Consec Losses:</strong> 36 | <strong>Equity DD:</strong> 44.32%</div>
                                    <div><strong>Trade-off:</strong> +33% PnL vs LB96 nhưng DD +35% (44.3% vs 32.8%). Dùng nếu chấp nhận higher variance.</div>
                                </div>
                            </div>

                            {/* 5-Signal Portfolio */}
                            <div className="rounded-2xl border border-accent/20 bg-accent/5 px-6 py-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Sparkles className="h-4 w-4 text-accent" />
                                    <div>
                                        <h3 className="text-sm font-bold text-text-primary">5-Signal Portfolio (2026-03-20)</h3>
                                        <p className="text-[10px] text-text-muted">Portfolio PF 2.15 | 622 trades / 17 months | ~10% DD</p>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-accent/20">
                                                <th className="py-2 text-left text-text-muted font-bold">#</th>
                                                <th className="py-2 text-left text-text-muted font-bold">Signal</th>
                                                <th className="py-2 text-right text-text-muted font-bold">PF</th>
                                                <th className="py-2 text-right text-text-muted font-bold">Trades</th>
                                                <th className="py-2 text-right text-text-muted font-bold">WR%</th>
                                                <th className="py-2 text-right text-text-muted font-bold">Streak</th>
                                                <th className="py-2 text-right text-text-muted font-bold">DD</th>
                                                <th className="py-2 text-left text-text-muted font-bold">Notes</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-text-secondary">
                                            <tr className="border-b border-accent/10"><td className="py-1.5 font-bold text-accent">1</td><td>XAB LONG</td><td className="text-right font-mono">1.86</td><td className="text-right">440</td><td className="text-right">48%</td><td className="text-right">10</td><td className="text-right">15.1%</td><td className="text-text-muted">Core signal (~70% volume)</td></tr>
                                            <tr className="border-b border-accent/10"><td className="py-1.5 font-bold text-accent">2</td><td>NY BOS LONG</td><td className="text-right font-mono">2.13</td><td className="text-right">64</td><td className="text-right">52%</td><td className="text-right">6</td><td className="text-right">7.8%</td><td className="text-text-muted">L1(SF) best variant</td></tr>
                                            <tr className="border-b border-accent/10"><td className="py-1.5 font-bold text-accent">3</td><td>Smart Trail LONG</td><td className="text-right font-mono">2.31</td><td className="text-right">36</td><td className="text-right">42%</td><td className="text-right">3</td><td className="text-right">2.7%</td><td className="text-text-muted">Unchanged, low volume</td></tr>
                                            <tr className="border-b border-accent/10"><td className="py-1.5 font-bold text-emerald-400">4</td><td className="font-bold">EMA Cross LONG</td><td className="text-right font-mono text-emerald-400">3.85</td><td className="text-right">49</td><td className="text-right">51%</td><td className="text-right">3</td><td className="text-right">3.0%</td><td className="text-emerald-400">NEW — guards never activate</td></tr>
                                            <tr><td className="py-1.5 font-bold text-emerald-400">5</td><td className="font-bold">EMA Cross SHORT</td><td className="text-right font-mono text-emerald-400">2.14</td><td className="text-right">33</td><td className="text-right">45%</td><td className="text-right">3</td><td className="text-right">4.9%</td><td className="text-emerald-400">NEW — self-cleaning signal</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-3 text-[10px] text-text-muted space-y-1">
                                    <div>Correlation: EMA LONG↔SHORT overlap 2-6% (excellent diversification). XAB↔NY BOS overlap 70-99% (cần quản lý).</div>
                                </div>
                            </div>

                            {/* Multi-TF Expansion Highlights */}
                            <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 px-6 py-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <Layers className="h-4 w-4 text-sky-400" />
                                    <div>
                                        <h3 className="text-sm font-bold text-text-primary">Multi-TF Expansion Candidates (2026-03-25)</h3>
                                        <p className="text-[10px] text-text-muted">28+ runs across 15m, 1h, 2h, 4h — top performers for portfolio expansion</p>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-sky-500/20">
                                                <th className="py-2 text-left text-text-muted font-bold">Signal</th>
                                                <th className="py-2 text-right text-text-muted font-bold">TF</th>
                                                <th className="py-2 text-right text-text-muted font-bold">PF</th>
                                                <th className="py-2 text-right text-text-muted font-bold">Net R</th>
                                                <th className="py-2 text-right text-text-muted font-bold">Trades</th>
                                                <th className="py-2 text-right text-text-muted font-bold">DD</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-text-secondary">
                                            <tr className="border-b border-sky-500/10"><td className="py-1.5 font-bold text-sky-400">BOS_FVG LONG</td><td className="text-right">2H</td><td className="text-right font-mono text-emerald-400">2.89</td><td className="text-right">396R</td><td className="text-right">638</td><td className="text-right">-11.19%</td></tr>
                                            <tr className="border-b border-sky-500/10"><td className="py-1.5 font-bold text-sky-400">PD_LEVEL_BREAK LONG</td><td className="text-right">4H</td><td className="text-right font-mono text-emerald-400">3.85</td><td className="text-right">213R</td><td className="text-right">304</td><td className="text-right">-11.49%</td></tr>
                                            <tr className="border-b border-sky-500/10"><td className="py-1.5">SESSION_BURST LONG</td><td className="text-right">1H</td><td className="text-right font-mono">1.78</td><td className="text-right">617R</td><td className="text-right">1,601</td><td className="text-right">-6.48%</td></tr>
                                            <tr className="border-b border-sky-500/10"><td className="py-1.5">PD_LEVEL_BREAK LONG</td><td className="text-right">1H</td><td className="text-right font-mono">1.76</td><td className="text-right">354R</td><td className="text-right">1,108</td><td className="text-right">-8.13%</td></tr>
                                            <tr className="border-b border-sky-500/10"><td className="py-1.5">ABC LONG</td><td className="text-right">2H</td><td className="text-right font-mono">2.17</td><td className="text-right">204R</td><td className="text-right">382</td><td className="text-right">-10.55%</td></tr>
                                            <tr><td className="py-1.5">SESSION_BURST LONG</td><td className="text-right">4H</td><td className="text-right font-mono">1.75</td><td className="text-right">228R</td><td className="text-right">597</td><td className="text-right">-10.39%</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-3 text-[10px] text-text-muted">
                                    2H/4H cho PF cao hơn M5/15M nhưng ít trades. Volman signals failed (0 trades — cần debug).
                                </div>
                            </div>

                            {/* Forward test plan */}
                            <div className="rounded-2xl border border-border-muted bg-bg-secondary/50 px-6 py-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <TrendingUp className="h-4 w-4 text-accent" />
                                    <h3 className="text-sm font-bold text-text-primary">Forward Test Plan</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-border-muted">
                                                <th className="py-2 text-left text-text-muted font-bold">Phase</th>
                                                <th className="py-2 text-left text-text-muted font-bold">Duration</th>
                                                <th className="py-2 text-left text-text-muted font-bold">Risk</th>
                                                <th className="py-2 text-left text-text-muted font-bold">Mục tiêu</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr className="border-b border-border-muted/50">
                                                <td className="py-2 text-text-primary font-bold">1. Paper</td>
                                                <td className="py-2 text-text-secondary">2-4 tuần</td>
                                                <td className="py-2 text-text-secondary">0%</td>
                                                <td className="py-2 text-text-secondary">Verify signal match backtest</td>
                                            </tr>
                                            <tr className="border-b border-border-muted/50">
                                                <td className="py-2 text-text-primary font-bold">2. Micro</td>
                                                <td className="py-2 text-text-secondary">4-8 tuần</td>
                                                <td className="py-2 text-text-secondary">0.5%</td>
                                                <td className="py-2 text-text-secondary">Validate PF &gt;= 1.4, WR &gt;= 40%</td>
                                            </tr>
                                            <tr className="border-b border-border-muted/50">
                                                <td className="py-2 text-text-primary font-bold">3a. Scale</td>
                                                <td className="py-2 text-text-secondary">4 tuần</td>
                                                <td className="py-2 text-text-secondary">1.0%</td>
                                                <td className="py-2 text-text-secondary">Scale nếu Phase 2 OK</td>
                                            </tr>
                                            <tr>
                                                <td className="py-2 text-text-primary font-bold">3c. Target</td>
                                                <td className="py-2 text-text-secondary">Ongoing</td>
                                                <td className="py-2 text-text-secondary">2.0%</td>
                                                <td className="py-2 text-text-secondary">Full deployment</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Kill switches */}
                            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <TrendingDown className="h-4 w-4 text-red-400" />
                                    <h3 className="text-sm font-bold text-text-primary">Kill Switches</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-red-500/20">
                                                <th className="py-2 text-left text-text-muted font-bold">#</th>
                                                <th className="py-2 text-left text-text-muted font-bold">Trigger</th>
                                                <th className="py-2 text-left text-text-muted font-bold">Threshold</th>
                                                <th className="py-2 text-left text-text-muted font-bold">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-text-secondary">
                                            <tr className="border-b border-red-500/10"><td className="py-1.5 font-bold text-red-400">KS-1</td><td>Rolling 50-trade WR</td><td>&lt; 30%</td><td>PAUSE + reduce risk</td></tr>
                                            <tr className="border-b border-red-500/10"><td className="py-1.5 font-bold text-red-400">KS-2</td><td>Peak-to-trough DD</td><td>&gt; -8%</td><td>HALT all trading</td></tr>
                                            <tr className="border-b border-red-500/10"><td className="py-1.5 font-bold text-red-400">KS-3</td><td>Execution error rate</td><td>&gt; 10%</td><td>HALT + investigate</td></tr>
                                            <tr className="border-b border-red-500/10"><td className="py-1.5 font-bold text-red-400">KS-4</td><td>Single trade loss</td><td>&gt; 3% equity</td><td>HALT immediately</td></tr>
                                            <tr className="border-b border-red-500/10"><td className="py-1.5 font-bold text-red-400">KS-5</td><td>Signals/week</td><td>&lt; 5 or &gt; 80</td><td>PAUSE + investigate</td></tr>
                                            <tr className="border-b border-red-500/10"><td className="py-1.5 font-bold text-amber-400">KS-6</td><td>Monthly Net R</td><td>&lt; -60R</td><td>Reduce to 0.5%</td></tr>
                                            <tr className="border-b border-red-500/10"><td className="py-1.5 font-bold text-amber-400">KS-7</td><td>Consec losing months</td><td>3 in a row</td><td>HALT + full review</td></tr>
                                            <tr><td className="py-1.5 font-bold text-amber-400">KS-8</td><td>Market regime shift</td><td>Subjective</td><td>PAUSE + analyze</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Open blockers */}
                            <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 px-6 py-5">
                                <div className="flex items-center gap-2 mb-3">
                                    <Ban className="h-4 w-4 text-purple-400" />
                                    <h3 className="text-sm font-bold text-text-primary">Open Blockers</h3>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex gap-2 text-xs text-text-secondary">
                                        <AlertTriangle className="h-3.5 w-3.5 text-purple-400 mt-0.5 shrink-0" />
                                        <div>
                                            <strong>OPT-4 Stress Test:</strong> M5 data thiếu 2019-2023. Chưa validate qua bear market 2022. M15 lỗ -201R năm 2022. <strong>Cần ingest M5 data từ MT5 broker trước khi scale risk lên 2%.</strong>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 text-xs text-text-secondary">
                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                                        <div>
                                            <strong>Max Consec Losses 74:</strong> Không giải quyết được bằng guards/filters. Là rủi ro cấu trúc — mitigated bằng kill switches + scaling plan.
                                        </div>
                                    </div>
                                    <div className="flex gap-2 text-xs text-text-secondary">
                                        <Sparkles className="h-3.5 w-3.5 text-sky-400 mt-0.5 shrink-0" />
                                        <div>
                                            <strong>Chưa test:</strong> Filter early London (hours 7-9 only), higher-TF regime detection, multi-symbol diversification.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
