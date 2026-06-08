export interface GeneratedBacktestRouteState {
    definitionKey: string | null;
    symbol: string | null;
    timeframe: string | null;
    runId: string | null;
}

export interface GeneratedBacktestLaunchSource {
    code: string;
    version: number;
    composedBlocks?: {
        symbol?: string;
        timeframe?: string;
    } | null;
}

const SIGNAL_TO_BACKTEST_TIMEFRAME: Record<string, string> = {
    M1: "1m",
    M5: "5m",
    M15: "15m",
    M30: "30m",
    H1: "1h",
    H4: "4h",
    D1: "1d",
};

const readNonEmpty = (value: string | null) => {
    if (!value) {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

export const buildSignalDefinitionKey = (input: Pick<GeneratedBacktestLaunchSource, "code" | "version">) => (
    `${input.code}:${input.version}`
);

export const mapSignalTimeframeToBacktest = (timeframe: string | null | undefined) => {
    const normalized = readNonEmpty(timeframe ?? null);
    if (!normalized) {
        return null;
    }

    return SIGNAL_TO_BACKTEST_TIMEFRAME[normalized] ?? normalized;
};

export const parseGeneratedBacktestSearchParams = (
    searchParams: URLSearchParams,
): GeneratedBacktestRouteState => ({
    definitionKey: readNonEmpty(searchParams.get("definition")),
    symbol: readNonEmpty(searchParams.get("symbol")),
    timeframe: readNonEmpty(searchParams.get("timeframe")),
    runId: readNonEmpty(searchParams.get("run")),
});

export const buildGeneratedBacktestSearchParams = (
    input: GeneratedBacktestRouteState,
    existing?: URLSearchParams,
) => {
    const params = new URLSearchParams(existing?.toString() ?? "");

    const mappings: Array<[key: string, value: string | null]> = [
        ["definition", input.definitionKey],
        ["symbol", input.symbol],
        ["timeframe", input.timeframe],
        ["run", input.runId],
    ];

    mappings.forEach(([key, value]) => {
        if (value) {
            params.set(key, value);
        } else {
            params.delete(key);
        }
    });

    return params;
};

export const buildGeneratedBacktestLaunchHref = (
    signal: GeneratedBacktestLaunchSource,
    existing?: URLSearchParams,
) => {
    const params = buildGeneratedBacktestSearchParams({
        definitionKey: buildSignalDefinitionKey(signal),
        symbol: readNonEmpty(signal.composedBlocks?.symbol ?? null),
        timeframe: mapSignalTimeframeToBacktest(signal.composedBlocks?.timeframe),
        runId: null,
    }, existing);

    const query = params.toString();
    return query ? `/signals?${query}` : "/signals";
};
