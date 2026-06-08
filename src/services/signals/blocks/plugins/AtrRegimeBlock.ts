import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

// ─── Params & State ───────────────────────────────────────────────────────────

interface AtrRegimeParams {
    atrPeriod: number;
    basePeriod: number; // For average ATR
}

interface AtrRegimeState {
    atrValues: (number | null)[];
    atrSmaValues: (number | null)[];
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const paramSchema: FieldSchema[] = [
    { id: 'atrPeriod', type: 'number', label: 'ATR Period', default: 14, min: 2, max: 100 },
    { id: 'basePeriod', type: 'number', label: 'Base Average Period', default: 50, min: 10, max: 500 },
];

const conditions: ConditionDef[] = [
    {
        id: 'atr_low',
        name: 'Low Volatility',
        description: 'ATR is below average ATR (Normal/Quiet).',
        paramSchema: [
            { id: 'multiplier', type: 'number', label: 'Multiplier', default: 0.8 },
        ],
    },
    {
        id: 'atr_normal',
        name: 'Normal Volatility',
        description: 'ATR is roughly equal to average ATR.',
        paramSchema: [
            { id: 'minMultiplier', type: 'number', label: 'Min Multiplier', default: 0.8 },
            { id: 'maxMultiplier', type: 'number', label: 'Max Multiplier', default: 1.2 },
        ],
    },
    {
        id: 'atr_expansion',
        name: 'Volatility Expansion',
        description: 'ATR is significantly above average ATR (Expansion).',
        paramSchema: [
            { id: 'multiplier', type: 'number', label: 'Multiplier', default: 1.5 },
        ],
    },
];

const definition: TechIndicatorDefinition = {
    id: 'ATR_REGIME',
    name: 'ATR Volatility Regime',
    category: 'volatility',
    description: 'Classifies volatility by comparing current ATR to its own moving average.',
    paramSchema,
    conditions,
};

// ─── Block Implementation ─────────────────────────────────────────────────────

export const atrRegimeBlock: TechIndicatorBlock<AtrRegimeParams, AtrRegimeState> = {
    definition,

    initialize(bars: CandleBar[], params: AtrRegimeParams, services: SignalRuntimeServices): AtrRegimeState {
        const atrPeriod = params.atrPeriod ?? 14;
        const basePeriod = params.basePeriod ?? 50;

        const atrRaw = services.indicatorSeries.calculateATR(bars, atrPeriod);
        const atrAligned = services.indicatorSeries.alignPointsToBars(bars, atrRaw);

        const atrPoints = atrAligned.flatMap((point) => (
            point.value === null ? [] : [{ time: point.time, value: point.value }]
        ));
        const atrSmaRaw = services.indicatorSeries.calculateSMA(atrPoints, basePeriod);
        const atrSmaAligned = services.indicatorSeries.alignPointsToBars(bars, atrSmaRaw);

        return {
            atrValues: atrAligned.map(p => p.value),
            atrSmaValues: atrSmaAligned.map(p => p.value),
        };
    },

    evaluate(
        _bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: AtrRegimeState,
        _params: AtrRegimeParams,
        conditionId: string,
        conditionParams: Record<string, unknown>,
    ): BlockEvaluateResult<AtrRegimeState> {
        const atr = state.atrValues[index];
        const atrSma = state.atrSmaValues[index];

        const values: Record<string, number | null> = { atr, atrSma };
        let isActive = false;

        if (atr === null || atrSma === null || atrSma === 0) {
            return { state, isActive, values };
        }

        switch (conditionId) {
            case 'atr_low': {
                const multiplier = Number(conditionParams['multiplier'] ?? 0.8);
                isActive = atr < atrSma * multiplier;
                break;
            }
            case 'atr_normal': {
                const min = Number(conditionParams['minMultiplier'] ?? 0.8);
                const max = Number(conditionParams['maxMultiplier'] ?? 1.2);
                isActive = atr >= atrSma * min && atr <= atrSma * max;
                break;
            }
            case 'atr_expansion': {
                const multiplier = Number(conditionParams['multiplier'] ?? 1.5);
                isActive = atr > atrSma * multiplier;
                break;
            }
        }

        return { state, isActive, values };
    },
};
