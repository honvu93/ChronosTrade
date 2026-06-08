import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

// â”€â”€â”€ Params & State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ElliottWaveParams {
    pivotLength: number; // The 'left' parameter in Pine Script
}

interface Pivot {
    index: number;
    price: number;
    type: 'H' | 'L';
}

interface ElliottWaveState {
    /** Per-bar boolean flags — all precomputed in initialize() */
    motiveBullishAt: boolean[];
    motiveBearishAt: boolean[];
    correctiveBullishAt: boolean[];
    correctiveBearishAt: boolean[];
    /** Debug values per bar */
    pivotCountAt: number[];
    lastPivotPriceAt: (number | null)[];
}

type MotiveDirection = 'BULLISH' | 'BEARISH';

// â”€â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const paramSchema: FieldSchema[] = [
    {
        id: 'pivotLength',
        type: 'number',
        label: 'Pivot Length',
        default: 4,
        min: 1,
        max: 50,
        step: 1,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'motive_bullish',
        name: 'Motive Bullish (12345)',
        description: 'Signals completion of a bullish 1-2-3-4-5 motive wave.',
        paramSchema: [],
    },
    {
        id: 'motive_bearish',
        name: 'Motive Bearish (12345)',
        description: 'Signals completion of a bearish 1-2-3-4-5 motive wave.',
        paramSchema: [],
    },
    {
        id: 'corrective_bullish',
        name: 'Corrective Bullish (ABC)',
        description: 'Signals completion of an ABC corrective wave after a bullish trend.',
        paramSchema: [],
    },
    {
        id: 'corrective_bearish',
        name: 'Corrective Bearish (ABC)',
        description: 'Signals completion of an ABC corrective wave after a bearish trend.',
        paramSchema: [],
    },
];

// â”€â”€â”€ Definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const definition: TechIndicatorDefinition = {
    id: 'ELLIOTT_WAVE',
    name: 'Elliott Wave (LuxAlgo)',
    category: 'structure',
    description:
        'Automatically detects Elliott motive (12345) and corrective (ABC) waves using a ZigZag-based algorithm.',
    paramSchema,
    conditions,
};

function isBullishMotiveSequence(pivots: Pivot[]): boolean {
    if (pivots.length !== 6) {
        return false;
    }

    const [p0, p1, p2, p3, p4, p5] = pivots;
    const w1 = Math.abs(p1.price - p0.price);
    const w3 = Math.abs(p3.price - p2.price);
    const w5 = Math.abs(p5.price - p4.price);
    const minW = Math.min(w1, w3, w5);

    return p0.type === 'L'
        && p1.type === 'H'
        && p2.type === 'L'
        && p3.type === 'H'
        && p4.type === 'L'
        && p5.type === 'H'
        && w3 !== minW
        && p3.price > p1.price
        && p5.price > p3.price
        && p2.price > p0.price
        && p4.price > p1.price;
}

function isBearishMotiveSequence(pivots: Pivot[]): boolean {
    if (pivots.length !== 6) {
        return false;
    }

    const [p0, p1, p2, p3, p4, p5] = pivots;
    const w1 = Math.abs(p1.price - p0.price);
    const w3 = Math.abs(p3.price - p2.price);
    const w5 = Math.abs(p5.price - p4.price);
    const minW = Math.min(w1, w3, w5);

    return p0.type === 'H'
        && p1.type === 'L'
        && p2.type === 'H'
        && p3.type === 'L'
        && p4.type === 'H'
        && p5.type === 'L'
        && w3 !== minW
        && p3.price < p1.price
        && p5.price < p3.price
        && p2.price < p0.price
        && p4.price < p1.price;
}

function detectCorrectiveCompletion(
    pivots: Pivot[],
    direction: MotiveDirection,
): Pivot | null {
    if (pivots.length < 9) {
        return null;
    }

    const motive = pivots.slice(-9, -3);
    const correction = pivots.slice(-4);

    if (direction === 'BULLISH') {
        const [start, a, b, c] = correction;
        if (
            isBullishMotiveSequence(motive)
            && start.type === 'H'
            && a.type === 'L'
            && b.type === 'H'
            && c.type === 'L'
            && start.index === motive[5].index
            && a.price < start.price
            && b.price > a.price
            && b.price < start.price
            && c.price < a.price
        ) {
            return c;
        }
        return null;
    }

    const [start, a, b, c] = correction;
    if (
        isBearishMotiveSequence(motive)
        && start.type === 'L'
        && a.type === 'H'
        && b.type === 'L'
        && c.type === 'H'
        && start.index === motive[5].index
        && a.price > start.price
        && b.price < a.price
        && b.price > start.price
        && c.price > a.price
    ) {
        return c;
    }

    return null;
}

// â”€â”€â”€ Block Implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function detectPivotAt(
    bars: CandleBar[],
    checkIndex: number,
    left: number,
    right: number,
): Pivot | null {
    if (checkIndex < left || checkIndex >= bars.length - right) {
        return null;
    }

    const currentHigh = bars[checkIndex].high;
    const currentLow = bars[checkIndex].low;

    let isHigh = true;
    for (let i = checkIndex - left; i <= checkIndex + right; i++) {
        if (i === checkIndex) continue;
        if (bars[i].high >= currentHigh) {
            isHigh = false;
            break;
        }
    }

    let isLow = true;
    for (let i = checkIndex - left; i <= checkIndex + right; i++) {
        if (i === checkIndex) continue;
        if (bars[i].low <= currentLow) {
            isLow = false;
            break;
        }
    }

    if (isHigh) return { index: checkIndex, price: currentHigh, type: 'H' };
    if (isLow) return { index: checkIndex, price: currentLow, type: 'L' };
    return null;
}

function pushPivotToZigzag(pivots: Pivot[], newPivot: Pivot): void {
    const last = pivots.length > 0 ? pivots[pivots.length - 1] : null;
    if (!last) {
        pivots.push(newPivot);
    } else if (last.type === newPivot.type) {
        if ((last.type === 'H' && newPivot.price > last.price) ||
            (last.type === 'L' && newPivot.price < last.price)) {
            pivots[pivots.length - 1] = newPivot;
        }
    } else {
        pivots.push(newPivot);
    }
}

export const elliottWaveBlock: TechIndicatorBlock<ElliottWaveParams, ElliottWaveState> = {
    definition,

    initialize(bars: CandleBar[], params: ElliottWaveParams, _services: SignalRuntimeServices): ElliottWaveState {
        const left = params.pivotLength || 4;
        const right = 1;
        const n = bars.length;

        const state: ElliottWaveState = {
            motiveBullishAt: new Array(n).fill(false),
            motiveBearishAt: new Array(n).fill(false),
            correctiveBullishAt: new Array(n).fill(false),
            correctiveBearishAt: new Array(n).fill(false),
            pivotCountAt: new Array(n).fill(0),
            lastPivotPriceAt: new Array(n).fill(null),
        };

        let pivots: Pivot[] = [];

        for (let barIndex = 0; barIndex < n; barIndex++) {
            // LuxAlgo confirms at checkIndex = barIndex - right
            const checkIndex = barIndex - right;
            const newPivot = detectPivotAt(bars, checkIndex, left, right);

            if (newPivot) {
                pushPivotToZigzag(pivots, newPivot);
                if (pivots.length > 20) {
                    pivots = pivots.slice(-20);
                }
            }

            state.pivotCountAt[barIndex] = pivots.length;
            state.lastPivotPriceAt[barIndex] = pivots.length > 0
                ? pivots[pivots.length - 1].price
                : null;

            if (pivots.length >= 6 && newPivot) {
                const p = pivots.slice(-6);
                if (isBullishMotiveSequence(p) && newPivot.index === p[5].index) {
                    state.motiveBullishAt[barIndex] = true;
                }
                if (isBearishMotiveSequence(p) && newPivot.index === p[5].index) {
                    state.motiveBearishAt[barIndex] = true;
                }
            }

            if (pivots.length >= 9 && newPivot) {
                const bullishC = detectCorrectiveCompletion(pivots, 'BULLISH');
                if (bullishC && bullishC.index === newPivot.index) {
                    state.correctiveBullishAt[barIndex] = true;
                }
                const bearishC = detectCorrectiveCompletion(pivots, 'BEARISH');
                if (bearishC && bearishC.index === newPivot.index) {
                    state.correctiveBearishAt[barIndex] = true;
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
        state: ElliottWaveState,
        _params: ElliottWaveParams,
        conditionId: string,
        _conditionParams: Record<string, unknown>,
        _services: SignalRuntimeServices,
    ): BlockEvaluateResult<ElliottWaveState> {
        const values: Record<string, number | null> = {
            pivotCount: state.pivotCountAt[index],
            lastPivotPrice: state.lastPivotPriceAt[index],
        };

        let isActive = false;
        switch (conditionId) {
            case 'motive_bullish':
                isActive = state.motiveBullishAt[index] ?? false;
                break;
            case 'motive_bearish':
                isActive = state.motiveBearishAt[index] ?? false;
                break;
            case 'corrective_bullish':
                isActive = state.correctiveBullishAt[index] ?? false;
                break;
            case 'corrective_bearish':
                isActive = state.correctiveBearishAt[index] ?? false;
                break;
            default:
                break;
        }

        return { state, isActive, values };
    },
};
