"use client";

import type {
    DecisionLogItem,
    DecisionLogFullEntry,
    DecisionAction,
    DecisionConditionResult,
} from "@/types/backtests";
import { isFullDecisionLogEntry } from "@/types/backtests";

const CONDITION_DEFS = [
    { name: "SL", priority: 1, label: "Stop Loss", type: "exit" as const },
    { name: "PARTIAL", priority: 2, label: "Partial TP", type: "state-change" as const },
    { name: "BE", priority: 3, label: "Break-Even", type: "state-change" as const },
    { name: "TRAIL", priority: 4, label: "Trail Stages", type: "state-change" as const },
    { name: "SWING_TRAIL", priority: 5, label: "Swing Trail", type: "state-change" as const },
    { name: "TP", priority: 6, label: "Take Profit", type: "exit" as const },
    { name: "NY_CLOSE", priority: 7, label: "NY Close", type: "exit" as const },
    { name: "TIME_STOP", priority: 8, label: "Time Stop", type: "exit" as const },
] as const;

const CONDITION_NAMES = CONDITION_DEFS.map((c) => c.name);
const EXIT_CONDITIONS: Set<string> = new Set(CONDITION_DEFS.filter((c) => c.type === "exit").map((c) => c.name));

const conditionResultColor = (result: DecisionConditionResult, conditionName: string): string => {
    if (result === "PASS") return "text-emerald-500";
    if (result === "SKIPPED") return "text-zinc-400";
    // TRIGGERED: red for exits, blue/amber for state-changes
    return EXIT_CONDITIONS.has(conditionName) ? "text-red-500 font-semibold" : "text-blue-500 font-semibold";
};

const conditionResultLabel: Record<DecisionConditionResult, string> = {
    PASS: "\u2713",
    TRIGGERED: "\u2717",
    SKIPPED: "\u2014",
};

const actionColor: Record<DecisionAction, string> = {
    HOLD: "text-zinc-400",
    MOVE_SL: "text-blue-500",
    PARTIAL_CLOSE: "text-amber-500",
    CLOSE: "text-red-500 font-bold",
};

const actionBg: Record<DecisionAction, string> = {
    HOLD: "",
    MOVE_SL: "bg-blue-500/5",
    PARTIAL_CLOSE: "bg-amber-500/5",
    CLOSE: "bg-red-500/10 border-l-2 border-red-500",
};

function formatTime(timestamp: string): string {
    const d = new Date(timestamp);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function formatPrice(value: number): string {
    return value.toFixed(2);
}

interface DecisionTraceTimelineProps {
    decisionLog: DecisionLogItem[] | null;
}

export function DecisionTraceTimeline({ decisionLog }: DecisionTraceTimelineProps) {
    if (!decisionLog) {
        return (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center text-zinc-500 text-sm">
                Decision trace not available for this backtest run.
                <br />
                <span className="text-xs text-zinc-600">Re-run the backtest to generate per-bar decision data.</span>
            </div>
        );
    }

    if (decisionLog.length === 0) {
        return (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-zinc-500 text-sm">
                No decision log entries for this trade.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <details className="px-3 pt-3 pb-1">
                <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
                    Evaluation Priority Order (1 → 8) — conditions checked left to right each bar
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] pb-2">
                    {CONDITION_DEFS.map((c) => (
                        <div key={c.name} className="flex items-center gap-1.5">
                            <span className="text-zinc-500 w-3 text-right">{c.priority}.</span>
                            <span className={EXIT_CONDITIONS.has(c.name) ? "text-red-400" : "text-blue-400"}>{c.label}</span>
                            <span className="text-zinc-600">({c.type === "exit" ? "exits position" : "changes state"})</span>
                        </div>
                    ))}
                </div>
            </details>
            <div className="flex items-center gap-4 px-3 pb-2 text-xs text-zinc-500">
                <span>Legend:</span>
                <span className="text-emerald-500">{"\u2713"} Pass</span>
                <span className="text-red-500">{"\u2717"} Exit trigger</span>
                <span className="text-blue-500">{"\u2717"} State change</span>
                <span className="text-zinc-400">{"\u2014"} Skipped</span>
            </div>
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400">
                        <th className="px-2 py-1.5 text-left font-medium">Bar</th>
                        <th className="px-2 py-1.5 text-left font-medium">Time</th>
                        <th className="px-2 py-1.5 text-right font-medium">Close</th>
                        {CONDITION_DEFS.map((c) => (
                            <th key={c.name} className="px-1.5 py-1.5 text-center font-medium" title={`${c.priority}. ${c.label} (${c.type})`}>
                                <span className="text-zinc-600 text-[9px]">{c.priority}</span>{c.name.replace("_", "\u200B_")}
                            </th>
                        ))}
                        <th className="px-2 py-1.5 text-center font-medium">Action</th>
                        <th className="px-2 py-1.5 text-right font-medium">SL</th>
                    </tr>
                </thead>
                <tbody>
                    {decisionLog.map((entry, idx) => {
                        if (isFullDecisionLogEntry(entry)) {
                            return (
                                <FullEntryRow
                                    key={idx}
                                    entry={entry}
                                />
                            );
                        }
                        return (
                            <CompressedEntryRow
                                key={idx}
                                barIndex={entry.barIndex}
                            />
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function formatGap(gapMs: number): string {
    const totalMin = Math.round(gapMs / 60000);
    if (totalMin < 60) return `${totalMin}min`;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

function FullEntryRow({ entry }: { entry: DecisionLogFullEntry }) {
    const conditionMap = new Map(entry.conditions.map((c) => [c.name, c.result]));
    const alignments = entry.multiTfAlignments;
    const totalCols = 3 + CONDITION_NAMES.length + 2; // bar + time + close + conditions + action + SL

    const triggeredExit = entry.action === "CLOSE"
        ? entry.conditions.find((c) => c.result === "TRIGGERED" && EXIT_CONDITIONS.has(c.name))
        : null;

    return (
        <>
            <tr className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${actionBg[entry.action]}`}>
                <td className="px-2 py-1 text-zinc-300 tabular-nums">{entry.barIndex}</td>
                <td className="px-2 py-1 text-zinc-400 tabular-nums">{formatTime(entry.timestamp)}</td>
                <td className="px-2 py-1 text-right text-zinc-300 tabular-nums">{formatPrice(entry.ohlcv.close)}</td>
                {CONDITION_NAMES.map((name) => {
                    const result = conditionMap.get(name) ?? "SKIPPED";
                    return (
                        <td key={name} className={`px-1.5 py-1 text-center ${conditionResultColor(result, name)}`}>
                            {conditionResultLabel[result]}
                        </td>
                    );
                })}
                <td className={`px-2 py-1 text-center ${actionColor[entry.action]}`}>
                    {entry.action}
                </td>
                <td className="px-2 py-1 text-right text-zinc-400 tabular-nums">
                    {formatPrice(entry.stateSnapshot.activeStop)}
                </td>
            </tr>
            {triggeredExit && (
                <tr className="border-b border-zinc-800/50 bg-red-500/5">
                    <td colSpan={totalCols} className="px-4 py-0.5 text-[10px] text-red-400">
                        Evaluation stopped after {triggeredExit.name} triggered — remaining conditions skipped
                    </td>
                </tr>
            )}
            {alignments && alignments.length > 0 && (
                <tr className="border-b border-zinc-800/50 bg-indigo-500/5">
                    <td colSpan={totalCols} className="px-4 py-0.5">
                        <div className="flex flex-wrap gap-3 text-[10px] text-indigo-400">
                            {alignments.map((a, i) => (
                                <span key={i}>
                                    <span className="font-medium">{a.blockId}</span>
                                    {" \u2192 "}
                                    <span className="text-indigo-300">{a.timeframe}</span>
                                    {" bar "}
                                    <span className="text-zinc-400">{formatTime(a.alignedBarTime)}</span>
                                    <span className="text-zinc-500"> ({formatGap(a.gapMs)} before)</span>
                                </span>
                            ))}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

function CompressedEntryRow({ barIndex }: { barIndex: number }) {
    return (
        <tr className="border-b border-zinc-800/50">
            <td className="px-2 py-1 text-zinc-500 tabular-nums">{barIndex}</td>
            <td colSpan={CONDITION_NAMES.length + 3} className="px-2 py-1 text-zinc-500 text-center">
                HOLD
            </td>
        </tr>
    );
}
