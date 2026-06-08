import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';
import { buildSwingLookup, detectSwings } from '../utils/swingDetection';

// â”€â”€â”€ Params & State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface SmcParams {
    swingStrength: number; // bars each side for swing detection (default 3)
    lookback: number;      // max bars to look back for OB origin (default 50)
}

interface SmcState {
    /** Per-bar boolean flags â€” all precomputed in initialize() */
    bullishObFormedAt: boolean[];
    bearishObFormedAt: boolean[];
    priceInBullishOb: boolean[];
    priceInBearishOb: boolean[];
    bullishBosAt: boolean[];
    bearishBosAt: boolean[];
    bullishChochAt: boolean[];
    bearishChochAt: boolean[];
    bullishFvgAt: boolean[];
    bearishFvgAt: boolean[];
}

// â”€â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const paramSchema: FieldSchema[] = [
    {
        id: 'swingStrength',
        type: 'number',
        label: 'Swing Strength',
        default: 3,
        min: 1,
        max: 10,
        step: 1,
    },
    {
        id: 'lookback',
        type: 'number',
        label: 'OB Lookback (bars)',
        default: 50,
        min: 5,
        max: 200,
        step: 5,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'bullish_ob_formed',
        name: 'Bullish OB just formed',
        description: 'A bullish Order Block is confirmed on this bar (the last bearish candle before the bullish impulse).',
        paramSchema: [],
    },
    {
        id: 'bearish_ob_formed',
        name: 'Bearish OB just formed',
        description: 'A bearish Order Block is confirmed on this bar (the last bullish candle before the bearish impulse).',
        paramSchema: [],
    },
    {
        id: 'price_in_bullish_ob',
        name: 'Price inside Bullish OB',
        description: 'Current price is touching or trading inside an active Bullish Order Block zone.',
        paramSchema: [],
    },
    {
        id: 'price_in_bearish_ob',
        name: 'Price inside Bearish OB',
        description: 'Current price is touching or trading inside an active Bearish Order Block zone.',
        paramSchema: [],
    },
    {
        id: 'bullish_bos',
        name: 'Bullish Break of Structure',
        description: 'Close breaks above the nearest swing high, confirming bullish structure.',
        paramSchema: [],
    },
    {
        id: 'bearish_bos',
        name: 'Bearish Break of Structure',
        description: 'Close breaks below the nearest swing low, confirming bearish structure.',
        paramSchema: [],
    },
    {
        id: 'bullish_choch',
        name: 'Bullish Change of Character',
        description: 'The first bullish BOS after a bearish BOS sequence, signaling a potential reversal upward.',
        paramSchema: [],
    },
    {
        id: 'bearish_choch',
        name: 'Bearish Change of Character',
        description: 'The first bearish BOS after a bullish BOS sequence, signaling a potential reversal downward.',
        paramSchema: [],
    },
    {
        id: 'bullish_fvg',
        name: 'Bullish Fair Value Gap (FVG)',
        description: 'Bullish price imbalance zone: bar[i-2].high < bar[i].low. Not yet filled.',
        paramSchema: [],
    },
    {
        id: 'bearish_fvg',
        name: 'Bearish Fair Value Gap (FVG)',
        description: 'Bearish price imbalance zone: bar[i-2].low > bar[i].high. Not yet filled.',
        paramSchema: [],
    },
];

// â”€â”€â”€ Definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const definition: TechIndicatorDefinition = {
    id: 'SMC',
    name: 'Smart Money Concepts (SMC)',
    category: 'structure',
    description:
        'Analyzes Smart Money market structure: Order Blocks, Break of Structure, Change of Character, and Fair Value Gaps.',
    paramSchema,
    conditions,
};

// â”€â”€â”€ Precompute Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface OrderBlock {
    zoneHigh: number;
    zoneLow: number;
    formationBarIdx: number;
    active: boolean;
}

function computeObs(
    bars: CandleBar[],
    swingLows: number[],
    swingHighs: number[],
    lookback: number,
    swingStrength: number,
): { bullishObs: OrderBlock[]; bearishObs: OrderBlock[] } {
    const bullishObs: OrderBlock[] = [];
    const bearishObs: OrderBlock[] = [];

    // Bullish OB: last bearish candle before a swing low (origin of the impulse down then reversal up)
    for (const slIdx of swingLows) {
        for (let k = slIdx - 1; k >= Math.max(0, slIdx - lookback); k--) {
            if (bars[k].close < bars[k].open) {
                // Bearish candle found â€” its body is the OB zone
                bullishObs.push({
                    zoneHigh: bars[k].open,
                    zoneLow: bars[k].close,
                    formationBarIdx: slIdx + swingStrength, // confirmed after swing low
                    active: true,
                });
                break;
            }
        }
    }

    // Bearish OB: last bullish candle before a swing high
    for (const shIdx of swingHighs) {
        for (let k = shIdx - 1; k >= Math.max(0, shIdx - lookback); k--) {
            if (bars[k].close > bars[k].open) {
                bearishObs.push({
                    zoneHigh: bars[k].close,
                    zoneLow: bars[k].open,
                    formationBarIdx: shIdx + swingStrength,
                    active: true,
                });
                break;
            }
        }
    }

    return { bullishObs, bearishObs };
}

// â”€â”€â”€ Block Implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const smcBlock: TechIndicatorBlock<SmcParams, SmcState> = {
    definition,

    initialize(bars: CandleBar[], params: SmcParams): SmcState {
        const strength = Math.max(1, params.swingStrength ?? 3);
        const lookback = Math.max(5, params.lookback ?? 50);
        const n = bars.length;

        // â”€â”€ Step 1: Swing detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const { highs: swingHighs, lows: swingLows } = detectSwings(bars, strength);
        const { lastHighAt, lastLowAt } = buildSwingLookup(n, swingHighs, swingLows, strength);

        // â”€â”€ Step 2: Initialize state arrays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const state: SmcState = {
            bullishObFormedAt: new Array(n).fill(false),
            bearishObFormedAt: new Array(n).fill(false),
            priceInBullishOb: new Array(n).fill(false),
            priceInBearishOb: new Array(n).fill(false),
            bullishBosAt: new Array(n).fill(false),
            bearishBosAt: new Array(n).fill(false),
            bullishChochAt: new Array(n).fill(false),
            bearishChochAt: new Array(n).fill(false),
            bullishFvgAt: new Array(n).fill(false),
            bearishFvgAt: new Array(n).fill(false),
        };

        // â”€â”€ Step 3: BOS detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        for (let i = 1; i < n; i++) {
            const shIdx = lastHighAt[i];
            const slIdx = lastLowAt[i];

            if (shIdx >= 0 && bars[i].close > bars[shIdx].high) {
                state.bullishBosAt[i] = true;
            }
            if (slIdx >= 0 && bars[i].close < bars[slIdx].low) {
                state.bearishBosAt[i] = true;
            }
        }

        // â”€â”€ Step 4: CHoCH detection (first BOS after structure flip) â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let structure: 'BULLISH' | 'BEARISH' | null = null;
        for (let i = 0; i < n; i++) {
            if (state.bullishBosAt[i]) {
                if (structure === 'BEARISH') state.bullishChochAt[i] = true;
                structure = 'BULLISH';
            }
            if (state.bearishBosAt[i]) {
                if (structure === 'BULLISH') state.bearishChochAt[i] = true;
                structure = 'BEARISH';
            }
        }

        // â”€â”€ Step 5: Order Blocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const { bullishObs, bearishObs } = computeObs(bars, swingLows, swingHighs, lookback, strength);

        // Sweep through bars chronologically to track OB validity
        for (let i = 0; i < n; i++) {
            for (const ob of bullishObs) {
                if (ob.formationBarIdx === i) {
                    state.bullishObFormedAt[i] = true;
                }
                if (i >= ob.formationBarIdx && ob.active) {
                    // Invalidate if price closes below OB zone
                    if (bars[i].close < ob.zoneLow) {
                        ob.active = false;
                    } else if (bars[i].low <= ob.zoneHigh && bars[i].high >= ob.zoneLow) {
                        state.priceInBullishOb[i] = true;
                    }
                }
            }

            for (const ob of bearishObs) {
                if (ob.formationBarIdx === i) {
                    state.bearishObFormedAt[i] = true;
                }
                if (i >= ob.formationBarIdx && ob.active) {
                    if (bars[i].close > ob.zoneHigh) {
                        ob.active = false;
                    } else if (bars[i].high >= ob.zoneLow && bars[i].low <= ob.zoneHigh) {
                        state.priceInBearishOb[i] = true;
                    }
                }
            }
        }

        // â”€â”€ Step 6: Fair Value Gaps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Track active FVGs as we scan; remove them when filled
        const activeBullishFvgs: { fvgLow: number; fvgHigh: number }[] = [];
        const activeBearishFvgs: { fvgLow: number; fvgHigh: number }[] = [];

        for (let i = 2; i < n; i++) {
            // Detect new FVGs at bar i (formed by bars i-2, i-1, i)
            if (bars[i].low > bars[i - 2].high) {
                activeBullishFvgs.push({ fvgLow: bars[i - 2].high, fvgHigh: bars[i].low });
            }
            if (bars[i].high < bars[i - 2].low) {
                activeBearishFvgs.push({ fvgHigh: bars[i - 2].low, fvgLow: bars[i].high });
            }

            // Check active bullish FVGs â€” remove if filled (price closes below fvgLow)
            let hasBullishFvg = false;
            const keptBullish: typeof activeBullishFvgs = [];
            for (const fvg of activeBullishFvgs) {
                if (bars[i].close >= fvg.fvgLow) {
                    hasBullishFvg = true;
                    keptBullish.push(fvg); // still active
                }
                // If price closed below fvgLow, the FVG is filled â€” drop it
            }
            activeBullishFvgs.length = 0;
            activeBullishFvgs.push(...keptBullish);
            state.bullishFvgAt[i] = hasBullishFvg;

            // Check active bearish FVGs
            let hasBearishFvg = false;
            const keptBearish: typeof activeBearishFvgs = [];
            for (const fvg of activeBearishFvgs) {
                if (bars[i].close <= fvg.fvgHigh) {
                    hasBearishFvg = true;
                    keptBearish.push(fvg);
                }
            }
            activeBearishFvgs.length = 0;
            activeBearishFvgs.push(...keptBearish);
            state.bearishFvgAt[i] = hasBearishFvg;
        }

        return state;
    },

    evaluate(
        _bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: SmcState,
        _params: SmcParams,
        conditionId: string,
    ): BlockEvaluateResult<SmcState> {
        // All values are precomputed â€” this is purely a lookup
        const values: Record<string, number | null> = {
            bullishOb: state.priceInBullishOb[index] ? 1 : 0,
            bearishOb: state.priceInBearishOb[index] ? 1 : 0,
            bullishBos: state.bullishBosAt[index] ? 1 : 0,
            bearishBos: state.bearishBosAt[index] ? 1 : 0,
            bullishFvg: state.bullishFvgAt[index] ? 1 : 0,
            bearishFvg: state.bearishFvgAt[index] ? 1 : 0,
        };

        let isActive = false;
        switch (conditionId) {
            case 'bullish_ob_formed':     isActive = state.bullishObFormedAt[index];  break;
            case 'bearish_ob_formed':     isActive = state.bearishObFormedAt[index];  break;
            case 'price_in_bullish_ob':   isActive = state.priceInBullishOb[index];   break;
            case 'price_in_bearish_ob':   isActive = state.priceInBearishOb[index];   break;
            case 'bullish_bos':           isActive = state.bullishBosAt[index];        break;
            case 'bearish_bos':           isActive = state.bearishBosAt[index];        break;
            case 'bullish_choch':         isActive = state.bullishChochAt[index];      break;
            case 'bearish_choch':         isActive = state.bearishChochAt[index];      break;
            case 'bullish_fvg':           isActive = state.bullishFvgAt[index];        break;
            case 'bearish_fvg':           isActive = state.bearishFvgAt[index];        break;
            default: break;
        }

        return { state, isActive, values };
    },
};
