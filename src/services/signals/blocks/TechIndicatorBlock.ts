import { CandleBar, SignalRuntimeServices } from '../types';

export interface FieldSchema {
    id: string;
    type: 'number' | 'string' | 'boolean' | 'select';
    label: string;
    default?: unknown;
    options?: Array<{ value: string; label: string }>;
    min?: number;
    max?: number;
    step?: number;
    required?: boolean;
}

export interface ConditionDef {
    id: string;
    name: string;
    description: string;
    paramSchema: FieldSchema[];
}

export interface TechIndicatorDefinition {
    id: string;
    name: string;
    category: 'momentum' | 'structure' | 'fibonacci' | 'trend' | 'volatility' | 'utility';
    description: string;
    paramSchema: FieldSchema[];
    conditions: ConditionDef[];
}

export type BlockTraceValue = number | string | boolean | null;

export interface BlockEvaluateResult<TState> {
    state: TState;
    /** Whether the requested conditionId is active on this bar */
    isActive: boolean;
    /** Current indicator values for trace/debug */
    values: Record<string, BlockTraceValue>;
}

/**
 * A TechIndicatorBlock is a reusable building block that:
 * 1. Pre-computes indicator series over historical bars in initialize()
 * 2. Evaluates a single named condition per bar in evaluate()
 *
 * Blocks are stateless between different ComposedSignalPlugin instances —
 * each instance holds its own blockState in ComposedState.blockStates.
 */
export interface TechIndicatorBlock<TParams = Record<string, unknown>, TState = unknown> {
    definition: TechIndicatorDefinition;

    /**
     * Called once before the bar loop with all bars for this indicator's timeframe.
     * Pre-computes indicator series and stores them in the returned state.
     */
    initialize(
        bars: CandleBar[],
        indicatorParams: TParams,
        services: SignalRuntimeServices,
    ): TState;

    /**
     * Called per bar. Evaluates whether the given conditionId is active.
     * Must not mutate state in place — always return a (possibly same) state reference.
     *
     * @param conditionId   - The condition to evaluate (from definition.conditions[].id)
     * @param conditionParams - Per-condition configuration (e.g., threshold value)
     */
    evaluate(
        bar: CandleBar,
        prevBar: CandleBar | null,
        allBars: CandleBar[],
        index: number,
        state: TState,
        indicatorParams: TParams,
        conditionId: string,
        conditionParams: Record<string, unknown>,
        services: SignalRuntimeServices,
    ): BlockEvaluateResult<TState>;
}
