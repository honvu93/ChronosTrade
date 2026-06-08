export type BacktestTradeReplayMode = "drawer" | "expanded";

export const parseBacktestTradeReplayMode = (value: string | null | undefined): BacktestTradeReplayMode => (
    value === "expanded" ? "expanded" : "drawer"
);

export const buildBacktestTradeReplaySearchParams = (
    current: URLSearchParams,
    mode: BacktestTradeReplayMode,
) => {
    const next = new URLSearchParams(current.toString());
    if (mode === "expanded") {
        next.set("replay", "expanded");
    } else {
        next.delete("replay");
    }
    return next;
};
