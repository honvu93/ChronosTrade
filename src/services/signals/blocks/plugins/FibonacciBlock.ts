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

interface FibonacciParams {
    swingStrength: number; // bars each side for swing detection (default 3)
    lookback: number;      // max bars to look back for swing pair (default 50)
    tolerance: number;     // price tolerance as fraction of range (default 0.003 = 0.3%)
}

interface FibonacciState {
    /** Per-bar boolean flags â€” all precomputed in initialize() */
    touch236: boolean[];
    touch382: boolean[];
    touch500: boolean[];
    touch618: boolean[];
    touch786: boolean[];
    inGoldenZone: boolean[];   // between 61.8% and 78.6%
    bounce618: boolean[];       // touched 618 and closed away (reversal)
    /** Fib levels at each bar for debug values (null if not calculable) */
    fib236At: (number | null)[];
    fib382At: (number | null)[];
    fib500At: (number | null)[];
    fib618At: (number | null)[];
    fib786At: (number | null)[];
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
        label: 'Swing Lookback (bars)',
        default: 50,
        min: 5,
        max: 200,
        step: 5,
    },
    {
        id: 'tolerance',
        type: 'number',
        label: 'Touch Tolerance (%)',
        default: 0.3,
        min: 0.05,
        max: 2,
        step: 0.05,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'price_touch_236',
        name: 'Price touches Fib 23.6%',
        description: 'Price (high/low) touches the 23.6% retracement level of the latest swing.',
        paramSchema: [],
    },
    {
        id: 'price_touch_382',
        name: 'Price touches Fib 38.2%',
        description: 'Price (high/low) touches the 38.2% retracement level of the latest swing.',
        paramSchema: [],
    },
    {
        id: 'price_touch_500',
        name: 'Price touches Fib 50.0%',
        description: 'Price (high/low) touches the 50.0% retracement level of the latest swing.',
        paramSchema: [],
    },
    {
        id: 'price_touch_618',
        name: 'Price touches Fib 61.8%',
        description: 'Price (high/low) touches the 61.8% retracement level, the primary Golden Ratio level.',
        paramSchema: [],
    },
    {
        id: 'price_touch_786',
        name: 'Price touches Fib 78.6%',
        description: 'Price (high/low) touches the 78.6% retracement level of the latest swing.',
        paramSchema: [],
    },
    {
        id: 'price_in_golden_zone',
        name: 'Price in Golden Zone (61.8%-78.6%)',
        description: 'Price is trading inside the Fibonacci Golden Zone between 61.8% and 78.6%.',
        paramSchema: [],
    },
    {
        id: 'bounce_from_618',
        name: 'Bounce from 61.8%',
        description: 'Price touches 61.8% and closes in reversal direction, signaling a strong bounce setup.',
        paramSchema: [],
    },
];

// â”€â”€â”€ Definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const definition: TechIndicatorDefinition = {
    id: 'FIBONACCI',
    name: 'Fibonacci Retracement',
    category: 'structure',
    description:
        'Analyzes Fibonacci support and resistance levels (23.6%, 38.2%, 50%, 61.8%, 78.6%) based on the latest swing high/low pair.',
    paramSchema,
    conditions,
};

// â”€â”€â”€ Precompute Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface FibLevels {
    f236: number;
    f382: number;
    f500: number;
    f618: number;
    f786: number;
    isUpswing: boolean; // true = retracement from high downward (bullish context)
}

function computeFibLevels(swingHigh: number, swingLow: number, isUpswing: boolean): FibLevels {
    const range = swingHigh - swingLow;
    if (isUpswing) {
        // Retracement downward from high
        return {
            f236: swingHigh - 0.236 * range,
            f382: swingHigh - 0.382 * range,
            f500: swingHigh - 0.500 * range,
            f618: swingHigh - 0.618 * range,
            f786: swingHigh - 0.786 * range,
            isUpswing: true,
        };
    } else {
        // Retracement upward from low
        return {
            f236: swingLow + 0.236 * range,
            f382: swingLow + 0.382 * range,
            f500: swingLow + 0.500 * range,
            f618: swingLow + 0.618 * range,
            f786: swingLow + 0.786 * range,
            isUpswing: false,
        };
    }
}

function touchesLevel(bar: CandleBar, level: number, tol: number): boolean {
    return bar.low <= level + tol && bar.high >= level - tol;
}

function inZone(bar: CandleBar, zoneLow: number, zoneHigh: number): boolean {
    // bar overlaps the zone
    return bar.low <= zoneHigh && bar.high >= zoneLow;
}

// â”€â”€â”€ Block Implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const fibonacciBlock: TechIndicatorBlock<FibonacciParams, FibonacciState> = {
    definition,

    initialize(bars: CandleBar[], params: FibonacciParams): FibonacciState {
        const strength = Math.max(1, params.swingStrength ?? 3);
        const lookback = Math.max(5, params.lookback ?? 50);
        const tolerancePct = Math.max(0.0001, (params.tolerance ?? 0.3) / 100);
        const n = bars.length;

        // â”€â”€ Step 1: Swing detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const { highs: swingHighs, lows: swingLows } = detectSwings(bars, strength);
        const { lastHighAt, lastLowAt } = buildSwingLookup(n, swingHighs, swingLows, strength);

        // â”€â”€ Step 2: Initialize state arrays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const state: FibonacciState = {
            touch236: new Array(n).fill(false),
            touch382: new Array(n).fill(false),
            touch500: new Array(n).fill(false),
            touch618: new Array(n).fill(false),
            touch786: new Array(n).fill(false),
            inGoldenZone: new Array(n).fill(false),
            bounce618: new Array(n).fill(false),
            fib236At: new Array(n).fill(null),
            fib382At: new Array(n).fill(null),
            fib500At: new Array(n).fill(null),
            fib618At: new Array(n).fill(null),
            fib786At: new Array(n).fill(null),
        };

        // â”€â”€ Step 3: Per-bar Fib computation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        for (let i = strength; i < n; i++) {
            const shIdx = lastHighAt[i]; // most recent swing high BEFORE bar i
            const slIdx = lastLowAt[i];  // most recent swing low BEFORE bar i

            // Need both a swing high and a swing low within lookback
            if (shIdx < 0 || slIdx < 0) continue;
            if (i - shIdx > lookback && i - slIdx > lookback) continue;

            const swingHigh = bars[shIdx].high;
            const swingLow = bars[slIdx].low;

            if (swingHigh <= swingLow) continue; // degenerate range

            // Determine direction: whichever swing point is more recent sets context
            // If swing low is more recent â†’ price fell then bouncing up â†’ bearish swing, fib retracement upward
            // If swing high is more recent â†’ price rose then retracing down â†’ bullish swing, fib retracement downward
            const isUpswing = shIdx > slIdx; // high formed after low â†’ upswing

            const range = swingHigh - swingLow;
            const tol = range * tolerancePct;

            const fib = computeFibLevels(swingHigh, swingLow, isUpswing);
            const bar = bars[i];

            state.fib236At[i] = fib.f236;
            state.fib382At[i] = fib.f382;
            state.fib500At[i] = fib.f500;
            state.fib618At[i] = fib.f618;
            state.fib786At[i] = fib.f786;

            state.touch236[i] = touchesLevel(bar, fib.f236, tol);
            state.touch382[i] = touchesLevel(bar, fib.f382, tol);
            state.touch500[i] = touchesLevel(bar, fib.f500, tol);
            state.touch618[i] = touchesLevel(bar, fib.f618, tol);
            state.touch786[i] = touchesLevel(bar, fib.f786, tol);

            // Golden zone: between 61.8 and 78.6 (order depends on swing direction)
            const goldenLow = Math.min(fib.f618, fib.f786);
            const goldenHigh = Math.max(fib.f618, fib.f786);
            state.inGoldenZone[i] = inZone(bar, goldenLow, goldenHigh);

            // Bounce from 618: touched 618 this bar AND closed in the opposite direction from retracement
            if (state.touch618[i] && i > 0) {
                const prevClose = bars[i - 1].close;
                if (isUpswing) {
                    // Retracement was downward; bounce = close above prev close (recovering)
                    state.bounce618[i] = bar.close > prevClose && bar.close > fib.f618;
                } else {
                    // Retracement was upward; bounce = close below prev close (recovering downward)
                    state.bounce618[i] = bar.close < prevClose && bar.close < fib.f618;
                }
            }
        }

        return state;
    },

    evaluate(
        _bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        index: number,
        state: FibonacciState,
        _params: FibonacciParams,
        conditionId: string,
    ): BlockEvaluateResult<FibonacciState> {
        const values: Record<string, number | null> = {
            fib236: state.fib236At[index],
            fib382: state.fib382At[index],
            fib500: state.fib500At[index],
            fib618: state.fib618At[index],
            fib786: state.fib786At[index],
        };

        let isActive = false;
        switch (conditionId) {
            case 'price_touch_236':    isActive = state.touch236[index];     break;
            case 'price_touch_382':    isActive = state.touch382[index];     break;
            case 'price_touch_500':    isActive = state.touch500[index];     break;
            case 'price_touch_618':    isActive = state.touch618[index];     break;
            case 'price_touch_786':    isActive = state.touch786[index];     break;
            case 'price_in_golden_zone': isActive = state.inGoldenZone[index]; break;
            case 'bounce_from_618':    isActive = state.bounce618[index];    break;
            default: break;
        }

        return { state, isActive, values };
    },
};
