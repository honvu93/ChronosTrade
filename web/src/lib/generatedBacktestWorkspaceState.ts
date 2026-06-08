import { SignalDefinition } from "@/types/signals";
import { mapSignalTimeframeToBacktest } from "./generatedBacktestContext";

export interface GeneratedBacktestMarketFormState {
    symbol: string;
    timeframe: string;
}

export interface GeneratedBacktestRouteContext {
    symbol: string | null;
    timeframe: string | null;
}

export interface GeneratedBacktestExecutionDefaults {
    stopLossMode: "SIGNAL_PRICE";
    takeProfitMode: "SIGNAL_PRICE";
}

export const getInheritedGeneratedBacktestContext = (definition: SignalDefinition | null) => {
    if (!definition?.isComposed || !definition.composedBlocks) {
        return {
            symbol: null,
            timeframe: null,
        };
    }

    return {
        symbol: definition.composedBlocks.symbol ?? null,
        timeframe: mapSignalTimeframeToBacktest(definition.composedBlocks.timeframe),
    };
};

export const buildGeneratedBacktestMarketContextPatch = ({
    routeContext,
    inheritedContext,
}: {
    routeContext: GeneratedBacktestRouteContext;
    inheritedContext: GeneratedBacktestRouteContext;
}) => {
    const symbol = routeContext.symbol ?? inheritedContext.symbol;
    const timeframe = routeContext.timeframe ?? inheritedContext.timeframe;

    return {
        ...(symbol ? { symbol } : {}),
        ...(timeframe ? { timeframe } : {}),
    };
};

export const getGeneratedBacktestExecutionDefaults = (definition: SignalDefinition | null): GeneratedBacktestExecutionDefaults | null => {
    if (!definition?.isComposed || !definition.composedBlocks) {
        return null;
    }

    return {
        stopLossMode: "SIGNAL_PRICE",
        takeProfitMode: "SIGNAL_PRICE",
    };
};
