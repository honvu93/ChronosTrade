"use client";

import { useState } from "react";
import {
    Activity,
    BarChart3,
    BookOpen,
    CandlestickChart,
    ChevronRight,
    Cpu,
    FileSpreadsheet,
    Layers,
    Play,
    Rocket,
    Server,
    Settings,
    Shield,
    Sigma,
    Terminal,
    Users,
    Zap,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface DocSection {
    id: string;
    icon: typeof BookOpen;
    title: string;
    content: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Reusable primitives                                                */
/* ------------------------------------------------------------------ */
function Badge({ children, color = "accent" }: { children: React.ReactNode; color?: "accent" | "green" | "yellow" | "red" }) {
    const cls = color === "green"
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
        : color === "yellow"
            ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
            : color === "red"
                ? "bg-red-500/15 text-red-400 border-red-500/25"
                : "bg-accent/15 text-accent border-accent/25";
    return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${cls}`}>{children}</span>;
}

function CodeBlock({ children }: { children: string }) {
    return (
        <pre className="rounded-xl border border-border-muted bg-bg-primary/60 px-4 py-3 text-xs leading-relaxed text-text-secondary overflow-x-auto">
            <code>{children}</code>
        </pre>
    );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
    return (
        <div className="overflow-x-auto rounded-xl border border-border-muted">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-border-muted bg-bg-secondary/50">
                        {headers.map((h, i) => (
                            <th key={i} className="px-3 py-2 text-left font-bold text-text-secondary">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, ri) => (
                        <tr key={ri} className="border-b border-border-muted/50 last:border-0 hover:bg-bg-primary/30">
                            {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-2 text-text-primary">{cell}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Tip({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex gap-2 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 text-xs text-text-secondary">
            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <div>{children}</div>
        </div>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return <h3 className="text-sm font-bold text-text-primary mt-5 mb-2">{children}</h3>;
}

/* ------------------------------------------------------------------ */
/*  Section content                                                    */
/* ------------------------------------------------------------------ */
const sections: DocSection[] = [
    {
        id: "quickstart",
        icon: Rocket,
        title: "Quick Start",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Start the entire system with a single command:</p>

                <SectionHeading>One Command Start</SectionHeading>
                <CodeBlock>{`./start-local.sh`}</CodeBlock>
                <p className="text-xs text-text-secondary mt-1">Auto script: kill stale ports → Docker → Backend → Frontend → 4 Workers → Cloudflare Tunnel. <code>Ctrl+C</code> stops everything.</p>

                <SectionHeading>Or run each service individually</SectionHeading>
                <CodeBlock>{`docker compose up -d                        # 1. TimescaleDB + Redis
npm run dev                                  # 2. Backend API (:3001)
npm --prefix web run dev                     # 3. Frontend (:5001)
npm run dev:backtest:worker                  # 4. Backtest worker
npm run dev:trading:auto-worker              # 5. Trade execution worker
npm run dev:trading:reconciliation-worker    # 6. Reconciliation worker
npm run dev:external-action:worker           # 7. Telegram/webhook delivery`}</CodeBlock>

                <Tip>After first start, the system shows a <strong>Getting-Started Checklist</strong> on /trading guiding each step: connect MT5 → run backtest → verify eligibility → enable paper trading.</Tip>

                <Table
                    headers={["Service", "Port", "Description"]}
                    rows={[
                        ["TimescaleDB", "5433", "Main database"],
                        ["Redis", "6379", "Queues, Socket.IO, pub/sub"],
                        ["Backend API", "3001", "Express REST + Socket.IO"],
                        ["Frontend", "5001", "Next.js dev server"],
                        ["MT5 Read Bridge", "8765", "Data from MT5"],
                        ["MT5 Exec Bridge", "8766", "Execute orders on MT5"],
                    ]}
                />
            </div>
        ),
    },
    {
        id: "chart",
        icon: CandlestickChart,
        title: "Chart",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Primary workspace for real-time technical analysis.</p>

                <SectionHeading>Features</SectionHeading>
                <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1">
                    <li><strong>Symbol switching</strong> — Select XAUUSD, BTCUSD, XAGUSD from dropdown</li>
                    <li><strong>Timeframe</strong> — M1, M5, M15, M30, H1, H4, D1, W1</li>
                    <li><strong>Indicator overlays</strong> — Display indicators directly on the chart</li>
                    <li><strong>Session shading</strong> — ASIAN / LONDON / NY sessions highlighted</li>
                    <li><strong>Watchlist</strong> — Right panel to manage symbols of interest</li>
                    <li><strong>Real-time</strong> — Candles update live via Socket.IO</li>
                </ul>
            </div>
        ),
    },
    {
        id: "signals",
        icon: Sigma,
        title: "Signals & Backtest",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Main backtest module. Contains 4 tabs:</p>

                <SectionHeading>Tab Generate — Run Backtest</SectionHeading>
                <ol className="list-decimal pl-4 text-xs text-text-secondary space-y-1">
                    <li>Select <strong>Signal Definition</strong> from dropdown</li>
                    <li>Configure: Symbol, Timeframe, Date range</li>
                    <li>Set: Initial Equity, Risk per trade</li>
                    <li>Execution Config: fees, slippage, SL/TP mode, position sizing</li>
                    <li>Enable <strong>Trade Guards</strong> (see dedicated section below)</li>
                    <li>Click <strong>Run</strong> — backtest runs asynchronously, progress shown in real-time</li>
                    <li>Click a run in history to view details</li>
                </ol>

                <SectionHeading>Tab Batch — Compare Configs</SectionHeading>
                <ol className="list-decimal pl-4 text-xs text-text-secondary space-y-1">
                    <li>Select signal + base params (symbol, TF, date range)</li>
                    <li>Add variants — each variant is a JSON override</li>
                    <li>Click <strong>Run All</strong> — all run in parallel</li>
                    <li>Comparison table auto-populates: Trades, WR%, Net R, PF, Max DD</li>
                </ol>

                <Tip>Batch mode is very useful for testing multiple trade guard configs simultaneously instead of running them one by one.</Tip>

                <SectionHeading>Tab Import — Import Signals</SectionHeading>
                <p className="text-xs text-text-secondary">Upload CSV/JSON signals from external sources, validate against strategy dictionary.</p>

                <SectionHeading>Tab Review — Review Results</SectionHeading>
                <p className="text-xs text-text-secondary">Browse signal runs, filter by strategy/session, drill-down into individual trades.</p>
            </div>
        ),
    },
    {
        id: "composer",
        icon: Layers,
        title: "Signal Composer",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Create custom signals by combining indicator blocks.</p>

                <SectionHeading>Process</SectionHeading>
                <ol className="list-decimal pl-4 text-xs text-text-secondary space-y-1">
                    <li>Open <strong>/signals/composer</strong></li>
                    <li>Browse <strong>Indicator Catalog</strong> (RSI, EMA, ATR, Session, SMC...)</li>
                    <li>Drag & drop blocks onto canvas</li>
                    <li>Configure conditions + thresholds</li>
                    <li>Set Match Mode: <Badge>ALL</Badge> <Badge>ANY</Badge> <Badge>SEQUENCE</Badge></li>
                    <li>Configure entry/exit: SL, TP, exit management profile</li>
                    <li>Save → click <strong>Run Backtest</strong></li>
                </ol>

                <SectionHeading>Available Exit Profiles</SectionHeading>
                <Table
                    headers={["Profile", "Description"]}
                    rows={[
                        ["HARD_SIGNAL_TP", "Fixed SL / TP from signal (default)"],
                        ["FIXED_2R", "Fixed SL / TP = 2R"],
                        ["BE_1R_TP_2R", "Move SL to BE at +1R / TP = 2R"],
                        ["PARTIAL_1R_BE_R3", "Close 50% at 1R / BE / TP = 3R"],
                        ["BE_1R_TRAIL_2R_3R", "BE at 1R / ratchet trail 2R, 3R"],
                        ["BE_1R_PARTIAL_2R_TRAIL", "3-Stage: BE 1R / close 50% at 2R / trail progressive"],
                        ["PARTIAL_1R_BE_SWING_TRAIL", "Close 50% / swing trail 12-bar"],
                        ["XAU_NY_CLOSE", "TP 2R / force close at NY end"],
                        ["TIME_24", "Time stop 24 bars / TP 1.5R"],
                    ]}
                />
            </div>
        ),
    },
    {
        id: "tradeguards",
        icon: Shield,
        title: "Trade Guards",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">7 capital protection guards, configured in Execution Config when running backtests.</p>

                <Table
                    headers={["Guard", "Default", "Description"]}
                    rows={[
                        ["Min Trade Spacing", "30 min, ON", "Minimum gap between exit and next entry"],
                        ["Loss Streak Throttle", "OFF", "Reduce risk % after N consecutive losses"],
                        ["Loss Streak Cooldown", "OFF", "Pause trading after N consecutive losses"],
                        ["Session Loss Cap", "OFF", "Max losses per session (ASIAN/LONDON/NY)"],
                        ["Day Loss Cap", "OFF", "Max losses per day"],
                        ["Equity Curve Filter", "OFF", "Block/reduce risk when equity < EMA(N trades)"],
                        ["Max Drawdown Halt", "OFF", "Circuit breaker when DD from peak exceeds threshold"],
                    ]}
                />

                <SectionHeading>Recommended Configs</SectionHeading>

                <div className="space-y-3">
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                            <Badge color="green">Config A — Preserve Profit</Badge>
                        </div>
                        <p className="text-xs text-text-secondary mb-1">Preserve 90% Net R, reduce exposure during drawdown:</p>
                        <CodeBlock>{`Min Trade Spacing: 30 min (ON)
Equity Curve Filter: EMA(20), HALF_RISK (ON)`}</CodeBlock>
                    </div>

                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                            <Badge color="yellow">Config B — Moderate Protection</Badge>
                        </div>
                        <p className="text-xs text-text-secondary mb-1">Preserve 99% Net R, PF +4-6%:</p>
                        <CodeBlock>{`Min Trade Spacing: 30 min (ON)
Session Loss Cap: 3 losses (ON)
Day Loss Cap: 4 losses (ON)
Loss Streak Cooldown: 5 losses → 720 min (ON)
Loss Streak Throttle: 3→1.5%, 5→1.0% (ON)`}</CodeBlock>
                    </div>

                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                            <Badge color="red">Config C — Maximum Safety</Badge>
                        </div>
                        <p className="text-xs text-text-secondary mb-1">Max consec losses ~5, but only preserves ~7% Net R:</p>
                        <CodeBlock>{`Min Trade Spacing: 30 min (ON)
Equity Curve Filter: EMA(10), BLOCK (ON)
Max Drawdown Halt: 10% (ON)`}</CodeBlock>
                    </div>
                </div>
            </div>
        ),
    },
    {
        id: "engine",
        icon: Cpu,
        title: "Engine Analytics",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Detailed analytics dashboard for backtest results.</p>

                <SectionHeading>Performance Cards</SectionHeading>
                <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1">
                    <li><strong>Win Rate</strong> — % of winning trades</li>
                    <li><strong>Profit Factor</strong> — Gross profit / Gross loss</li>
                    <li><strong>Expectancy</strong> — Avg R per trade</li>
                    <li><strong>Net R</strong> — Total R (with USD equivalent)</li>
                    <li><strong>Max Consecutive Loss</strong> — Longest losing streak</li>
                </ul>

                <SectionHeading>Breakdowns</SectionHeading>
                <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1">
                    <li><strong>By Strategy</strong> — Performance by strategy code</li>
                    <li><strong>By Session</strong> — Compare ASIAN / LONDON / NY</li>
                    <li><strong>Exit Strategy Comparison</strong> — Detailed exit rules</li>
                </ul>

                <SectionHeading>Chart</SectionHeading>
                <p className="text-xs text-text-secondary">Candlestick chart with entry/exit markers, session shading. Click a marker to focus the signal.</p>
            </div>
        ),
    },
    {
        id: "reports",
        icon: FileSpreadsheet,
        title: "Reports & Export",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Export and detailed reporting of backtest results.</p>

                <SectionHeading>Explainable Report</SectionHeading>
                <p className="text-xs text-text-secondary">For each entry, view: Market snapshot, indicator state, matched rules, trace notes.</p>

                <SectionHeading>Export Formats</SectionHeading>
                <Table
                    headers={["Export", "Format", "Contents"]}
                    rows={[
                        ["Trade Log", "CSV", "Entry/exit, P&L, exit reason"],
                        ["Signal Review", "CSV", "Signal-level outcomes"],
                        ["Run Summary", "CSV", "Single-row run metrics"],
                        ["Strategy Breakdown", "CSV", "Per-strategy performance"],
                        ["Session Breakdown", "CSV", "Per-session performance"],
                        ["Exit Comparison", "CSV", "Exit rule comparison"],
                        ["Validation Artifact", "JSON", "Full bundle: run + signals + events + traces"],
                    ]}
                />
            </div>
        ),
    },
    {
        id: "trading",
        icon: Shield,
        title: "Trading",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Paper trading and live trading via MT5 broker. The system supports the full journey from paper testing to live execution.</p>

                <SectionHeading>Paper Trading Wizard</SectionHeading>
                <ol className="list-decimal pl-4 text-xs text-text-secondary space-y-1">
                    <li>Go to <strong>Eligibility</strong> tab → find signals with <Badge color="green">LIVE ELIGIBLE</Badge> badge</li>
                    <li>Click <strong>Start Paper Trading</strong> button on the signal card</li>
                    <li>3-step wizard: <strong>Account</strong> (auto-select if only 1 account) → <strong>Risk</strong> (slider % + max positions) → <strong>Review & Approve</strong></li>
                    <li>Guardrails auto-calculated: daily loss cap = 3x risk, kill switch = 15%</li>
                    <li>After approval → binding becomes ACTIVE, signal starts trading automatically on paper account</li>
                </ol>

                <SectionHeading>Paper Dashboard</SectionHeading>
                <p className="text-xs text-text-secondary">The <code>/trading/paper-dashboard</code> page displays:</p>
                <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1">
                    <li><strong>KPI tiles</strong> — Realized P&L, Executed/Rejected/Failed counts</li>
                    <li><strong>Equity curve</strong> — Cumulative P&L chart by day, filter 7d/30d/All</li>
                    <li><strong>Signal breakdown</strong> — Per-binding performance table</li>
                    <li><strong>Recent intents</strong> — Latest order feed with status badge</li>
                </ul>

                <SectionHeading>Signal Eligibility</SectionHeading>
                <p className="text-xs text-text-secondary">Each signal card displays:</p>
                <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1">
                    <li><strong>Metrics</strong> — Trades, Net R, PF, Max DD</li>
                    <li><strong>Frequency badge</strong> — ~N trades/day (based on backtest)</li>
                    <li><strong>Confidence tier</strong> — <Badge color="green">HIGH</Badge> (50+ trades) / <Badge>VALIDATED</Badge> (10+) / LIMITED (&lt;10)</li>
                    <li><strong>R:R ratio</strong> — Avg win R : Avg loss R</li>
                </ul>

                <SectionHeading>Guided Risk Forms</SectionHeading>
                <p className="text-xs text-text-secondary">Automation tab: create bindings with sliders instead of raw JSON:</p>
                <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1">
                    <li>Risk % slider (0.1–5%)</li>
                    <li>Max open positions</li>
                    <li>Daily loss cap + Kill switch drawdown %</li>
                    <li>Advanced: raw JSON override (collapsed)</li>
                </ul>

                <SectionHeading>Guardrails (enforced at runtime)</SectionHeading>
                <Table
                    headers={["Guardrail", "Check", "Action"]}
                    rows={[
                        ["maxOpenPositions", "Query MT5 bridge (5s cache)", "Block intent if limit reached"],
                        ["maxDailyLossPct", "Realized PnL / balance", "Block intent if exceeded"],
                        ["killSwitchDrawdownPct", "Equity drawdown vs balance", "Auto-activate kill switch + block"],
                    ]}
                />
                <Tip>Guardrails fallback: if bridge is unreachable, uses local mirror. Mirror stale &gt;60s → reject intent (fail-safe).</Tip>

                <SectionHeading>Manual Order</SectionHeading>
                <p className="text-xs text-text-secondary">Place manual orders: select symbol, side (LONG/SHORT), volume, SL, TP → Execute.</p>

                <SectionHeading>External Deployments</SectionHeading>
                <p className="text-xs text-text-secondary">Forward signals via Telegram bot or Webhook URL.</p>
            </div>
        ),
    },
    {
        id: "indicators",
        icon: Activity,
        title: "Indicator Fleet",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">Monitor all live indicator instances in the fleet.</p>

                <SectionHeading>Fleet Health Dashboard</SectionHeading>
                <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1">
                    <li><strong>Total Nodes</strong> — Total indicator instances</li>
                    <li><strong>Active</strong> — Running normally</li>
                    <li><strong>Stale</strong> — Missing heartbeat (warning)</li>
                    <li><strong>Errors</strong> — Errors requiring attention</li>
                </ul>

                <SectionHeading>Actions</SectionHeading>
                <ul className="list-disc pl-4 text-xs text-text-secondary space-y-1">
                    <li><strong>Play/Pause</strong> — Resume/pause indicator</li>
                    <li><strong>Alert Config</strong> — Configure alerts</li>
                    <li><strong>Analyzer</strong> — Open detailed analysis chart</li>
                    <li><strong>Archive</strong> — Remove from fleet</li>
                </ul>
            </div>
        ),
    },
    {
        id: "admin",
        icon: Users,
        title: "Admin",
        content: (
            <div className="space-y-4">
                <p className="text-xs text-text-secondary">System administration (ADMIN role only).</p>

                <SectionHeading>Users (/admin/users)</SectionHeading>
                <p className="text-xs text-text-secondary">Manage users, assign roles (ADMIN/USER), set module permissions (CHART, SIGNAL, REPORT, TRADING, ENGINE).</p>

                <SectionHeading>Indicator Catalog (/admin/indicator-catalog)</SectionHeading>
                <p className="text-xs text-text-secondary">Registry indicator definitions: metadata, parameters, lifecycle (draft → published → deprecated).</p>

                <SectionHeading>Monitoring (/admin/monitoring)</SectionHeading>
                <p className="text-xs text-text-secondary">System health: workers, DB, Redis, MT5 bridge status, error tracking.</p>
            </div>
        ),
    },
    {
        id: "workflows",
        icon: Play,
        title: "Workflows",
        content: (
            <div className="space-y-4">
                <SectionHeading>Workflow: Backtest Signal</SectionHeading>
                <div className="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
                    <Badge>Composer</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Signals/Generate</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Run Backtest</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Engine</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Reports/Export</Badge>
                </div>

                <SectionHeading>Workflow: Batch Compare</SectionHeading>
                <div className="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
                    <Badge>Signals/Batch</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Add Variants</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Run All</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Compare Table</Badge>
                </div>

                <SectionHeading>Workflow: Paper Trading (new user)</SectionHeading>
                <div className="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
                    <Badge>Connect MT5</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Run Backtest</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Check Eligibility</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge color="green">Start Paper Trading (Wizard)</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Paper Dashboard</Badge>
                </div>

                <SectionHeading>Workflow: Go Live</SectionHeading>
                <div className="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
                    <Badge>Paper Test OK</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Promote Indicator</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Create Binding</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Start Workers</Badge> <ChevronRight className="h-3 w-3" />
                    <Badge>Monitor</Badge>
                </div>

                <SectionHeading>Go-Live Checklist</SectionHeading>
                <Table
                    headers={["Metric", "Minimum", "Target", "Deal-breaker"]}
                    rows={[
                        ["Profit Factor", "> 1.5", "> 1.8", "< 1.2"],
                        ["Win Rate", "> 48%", "> 55%", "< 40%"],
                        ["Max Consec Loss", "< 12", "< 8", "> 20"],
                        ["Net R / Year", "> 50R", "> 100R", "< 20R"],
                        ["Expectancy", "> 0.20", "> 0.40", "< 0.10"],
                    ]}
                />
            </div>
        ),
    },
    {
        id: "infra",
        icon: Server,
        title: "Infrastructure",
        content: (
            <div className="space-y-4">
                <SectionHeading>Health Check</SectionHeading>
                <CodeBlock>{`curl localhost:3001/health
# {"status":"ok","db":"ok","redis":"ok","bridge":"ok"}
# status: "ok" | "degraded" (bridge down) | "error" (DB/Redis down)
# HTTP: 200 (ok/degraded) | 503 (error)`}</CodeBlock>

                <SectionHeading>Workers</SectionHeading>
                <Table
                    headers={["Worker", "Command", "Description"]}
                    rows={[
                        ["Backtest", "npm run dev:backtest:worker", "Async backtest execution"],
                        ["Auto Execution", "npm run dev:trading:auto-worker", "Trade intent → MT5 (retry 3x)"],
                        ["Reconciliation", "npm run dev:trading:reconciliation-worker", "Broker sync (retry 5x, exp backoff 3s)"],
                        ["External Action", "npm run dev:external-action:worker", "Telegram/webhook delivery"],
                    ]}
                />
                <Tip>All workers use structured JSON logging. Output format: <code>{`{"level","worker","jobId","event","message","timestamp"}`}</code></Tip>

                <SectionHeading>Alert System</SectionHeading>
                <p className="text-xs text-text-secondary">AlertDispatchService subscribes to Redis <code>system:alerts</code> channel → forwards to Telegram admin.</p>
                <Table
                    headers={["Env var", "Description"]}
                    rows={[
                        ["ALERT_TELEGRAM_BOT_TOKEN", "Telegram bot token for admin alerts"],
                        ["ALERT_TELEGRAM_CHAT_ID", "Chat ID to receive alerts"],
                    ]}
                />

                <SectionHeading>Signal Event Idempotency</SectionHeading>
                <p className="text-xs text-text-secondary">Unique constraint on <code>(instanceId, candleTime, eventType, cycleNumber)</code> prevents duplicate events on crash/restart mid-tick. Duplicates are automatically skipped (P2002 catch).</p>

                <SectionHeading>Environment Files</SectionHeading>
                <Table
                    headers={["File", "Description"]}
                    rows={[
                        [".env", "Backend: DATABASE_URL, REDIS_URL, JWT_SECRET, ENCRYPTION_KEY, ALERT_TELEGRAM_*"],
                        ["web/.env.local", "Frontend: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SOCKET_URL"],
                        ["mt5-service/.env", "MT5 credentials"],
                    ]}
                />

                <SectionHeading>Database</SectionHeading>
                <CodeBlock>{`npx prisma generate          # Generate Prisma client
npx prisma migrate deploy    # Apply migrations
npx prisma studio            # Visual DB browser`}</CodeBlock>

                <SectionHeading>Cloudflare Tunnel</SectionHeading>
                <CodeBlock>{`# Config: cloudflared-config.yml
# trade-api.your-domain.com → localhost:3001
# trade.your-domain.com → localhost:5001
cloudflared tunnel --config cloudflared-config.yml run`}</CodeBlock>
            </div>
        ),
    },
    {
        id: "cli",
        icon: Terminal,
        title: "CLI Scripts",
        content: (
            <div className="space-y-4">
                <SectionHeading>Signal Portfolio</SectionHeading>
                <CodeBlock>{`# Rank all 51 tier-1 signals by composite score
ts-node src/scripts/runAllTier1BatchBacktest.ts

# Setup paper portfolio from CLI
ts-node src/scripts/setupPaperPortfolio.ts \\
  --signals=SYS_4TF_PD_LEVEL_BREAK_LONG \\
  --accountId=<PAPER_ACCOUNT_ID> \\
  --symbol=XAUUSD --timeframe=H1 --riskPct=0.5

# Dry run (preview without DB writes)
ts-node src/scripts/setupPaperPortfolio.ts --signals=... --dry-run`}</CodeBlock>

                <SectionHeading>Backtest Scripts</SectionHeading>
                <CodeBlock>{`npm run xau:abc:all           # Run all XAU ABC batches
npm run xau:abc:report        # Render optimization report
npm run xau:m5:roadmap        # XAU M5 roadmap preview
npm run smoke:signals-platform   # Signal platform smoke test
npm run smoke:signals-batch      # Batch preview smoke test`}</CodeBlock>

                <SectionHeading>Build & Test</SectionHeading>
                <CodeBlock>{`npm run build                 # TypeScript compile
npm run test:trading:backend  # Trading backend tests (61 tests)
npm --prefix web run build    # Frontend production build
npm --prefix web run lint     # ESLint`}</CodeBlock>
            </div>
        ),
    },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function DocsWorkspace() {
    const [activeSection, setActiveSection] = useState(sections[0].id);
    const current = sections.find((s) => s.id === activeSection) ?? sections[0];

    return (
        <div className="flex h-full">
            {/* Sidebar TOC */}
            <aside className="hidden w-56 shrink-0 border-r border-border-muted bg-bg-secondary/40 p-3 lg:block overflow-y-auto">
                <div className="mb-4 flex items-center gap-2 px-2">
                    <BookOpen className="h-4 w-4 text-accent" />
                    <span className="text-xs font-black tracking-wide text-text-primary">USER GUIDE</span>
                </div>
                <nav className="flex flex-col gap-0.5">
                    {sections.map((s) => {
                        const Icon = s.icon;
                        const isActive = s.id === activeSection;
                        return (
                            <button
                                key={s.id}
                                onClick={() => setActiveSection(s.id)}
                                className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] font-semibold transition ${
                                    isActive
                                        ? "bg-accent/10 text-accent border border-accent/20"
                                        : "text-text-secondary hover:bg-bg-primary/50 hover:text-text-primary border border-transparent"
                                }`}
                            >
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{s.title}</span>
                            </button>
                        );
                    })}
                </nav>
            </aside>

            {/* Mobile TOC */}
            <div className="lg:hidden w-full">
                <div className="sticky top-0 z-10 border-b border-border-muted bg-bg-secondary/80 backdrop-blur-xl px-4 py-2">
                    <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="h-4 w-4 text-accent" />
                        <span className="text-xs font-black tracking-wide text-text-primary">USER GUIDE</span>
                    </div>
                    <select
                        className="w-full rounded-xl border border-border-muted bg-bg-primary px-3 py-2 text-xs text-text-primary"
                        value={activeSection}
                        onChange={(e) => setActiveSection(e.target.value)}
                    >
                        {sections.map((s) => (
                            <option key={s.id} value={s.id}>{s.title}</option>
                        ))}
                    </select>
                </div>
                <div className="p-4">
                    <div className="mb-3">
                        <h2 className="text-base font-black text-text-primary">{current.title}</h2>
                        <p className="text-[11px] text-text-muted">{current.title}</p>
                    </div>
                    {current.content}
                </div>
            </div>

            {/* Content area (desktop) */}
            <main className="hidden lg:block flex-1 overflow-y-auto p-6">
                <div className="mx-auto max-w-3xl">
                    <div className="mb-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10">
                                <current.icon className="h-5 w-5 text-accent" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-text-primary">{current.title}</h2>
                                <p className="text-xs text-text-muted">{current.title}</p>
                            </div>
                        </div>
                    </div>
                    {current.content}
                </div>
            </main>
        </div>
    );
}
