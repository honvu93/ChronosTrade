import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

// â”€â”€â”€ Params & State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface MarketRegimeParams {
    adxPeriod: number;
    atrPeriod: number;
    emaFilterPeriod: number;
}

interface MarketRegimeState {
    adxValues: (number | null)[];
    atrValues: (number | null)[];
    emaValues: (number | null)[];
    atrSmaValues: (number | null)[];
}

const ATR_BASELINE_PERIOD = 50;

const buildPriorAtrBaseline = (atrValues: Array<number | null>, period: number): Array<number | null> => {
    const baselines = new Array<number | null>(atrValues.length).fill(null);
    const window: number[] = [];

    for (let index = 0; index < atrValues.length; index += 1) {
        if (window.length >= period) {
            const sum = window.reduce((total, value) => total + value, 0);
            baselines[index] = Number((sum / period).toFixed(8));
        }

        const currentAtr = atrValues[index];
        if (currentAtr !== null) {
            window.push(currentAtr);
            if (window.length > period) {
                window.shift();
            }
        }
    }

    return baselines;
};

// â”€â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const paramSchema: FieldSchema[] = [
    { id: 'adxPeriod', type: 'number', label: 'ADX Period', default: 14, min: 2, max: 100 },
    { id: 'atrPeriod', type: 'number', label: 'ATR Period', default: 14, min: 2, max: 100 },
    { id: 'emaFilterPeriod', type: 'number', label: 'EMA Filter Period', default: 200, min: 10, max: 500 },
];

const conditions: ConditionDef[] = [
    {
        id: 'regime_trending_bullish',
        name: 'Trending (Bullish)',
        description: 'ADX > 25 and price > EMA 200',
        paramSchema: [
            { id: 'adxThreshold', type: 'number', label: 'ADX Threshold', default: 25 },
        ],
    },
    {
        id: 'regime_trending_bearish',
        name: 'Trending (Bearish)',
        description: 'ADX > 25 and price < EMA 200',
        paramSchema: [
            { id: 'adxThreshold', type: 'number', label: 'ADX Threshold', default: 25 },
        ],
    },
    {
        id: 'regime_ranging_chop',
        name: 'Ranging / Chop',
        description: 'ADX < 20. The market has no clear directional trend.',
        paramSchema: [
            { id: 'adxThreshold', type: 'number', label: 'ADX Threshold', default: 20 },
        ],
    },
    {
        id: 'regime_high_volatility',
        name: 'High volatility',
        description: 'Current ATR is greater than 1.5x the average ATR of the prior 50 bars.',
        paramSchema: [
            { id: 'multiplier', type: 'number', label: 'Multiplier', default: 1.5 },
        ],
    },
];

// â”€â”€â”€ Definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const definition: TechIndicatorDefinition = {
    id: 'MARKET_REGIME',
    name: 'Market Regime Detector',
    category: 'trend',
    description: 'Classifies market regime using ADX (trend strength), ATR (volatility), and EMA (direction).',
    paramSchema,
    conditions,
};

// â”€â”€â”€ Block Implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const marketRegimeBlock: TechIndicatorBlock<MarketRegimeParams, MarketRegimeState> = {
    definition,

    initialize(bars: CandleBar[], params: MarketRegimeParams, services: SignalRuntimeServices): MarketRegimeState {
        const adxPeriod = params.adxPeriod ?? 14;
        const atrPeriod = params.atrPeriod ?? 14;
        const emaPeriod = params.emaFilterPeriod ?? 200;

        const adxRaw = services.indicatorSeries.calculateADX(bars, adxPeriod);
        const atrRaw = services.indicatorSeries.calculateATR(bars, atrPeriod);
        const emaRaw = services.indicatorSeries.calculateEMAFromCandles(bars, emaPeriod);

        const adxAligned = services.indicatorSeries.alignPointsToBars(bars, adxRaw);
        const atrAligned = services.indicatorSeries.alignPointsToBars(bars, atrRaw);
        const emaAligned = services.indicatorSeries.alignPointsToBars(bars, emaRaw);
        const atrValues = atrAligned.map(p => p.value);
        const atrSmaValues = buildPriorAtrBaseline(atrValues, ATR_BASELINE_PERIOD);

        return {
            adxValues: adxAligned.map(p => p.value),
            atrValues,
            emaValues: emaAligned.map(p => p.value),
            atrSmaValues,
        };
    },

    evaluate(
        bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: MarketRegimeState,
        _params: MarketRegimeParams,
        conditionId: string,
        conditionParams: Record<string, unknown>,
    ): BlockEvaluateResult<MarketRegimeState> {
        const adx = state.adxValues[index];
        const atr = state.atrValues[index];
        const ema = state.emaValues[index];
        const atrSma = state.atrSmaValues[index];

        const values: Record<string, number | null> = { adx, atr, ema, atrSma };
        let isActive = false;

        switch (conditionId) {
            case 'regime_trending_bullish': {
                const threshold = Number(conditionParams['adxThreshold'] ?? 25);
                isActive = adx !== null && ema !== null && adx > threshold && bar.close > ema;
                break;
            }
            case 'regime_trending_bearish': {
                const threshold = Number(conditionParams['adxThreshold'] ?? 25);
                isActive = adx !== null && ema !== null && adx > threshold && bar.close < ema;
                break;
            }
            case 'regime_ranging_chop': {
                const threshold = Number(conditionParams['adxThreshold'] ?? 20);
                isActive = adx !== null && adx < threshold;
                break;
            }
            case 'regime_high_volatility': {
                const multiplier = Number(conditionParams['multiplier'] ?? 1.5);
                isActive = atr !== null && atrSma !== null && atr > atrSma * multiplier;
                break;
            }
        }

        return { state, isActive, values };
    },
};
