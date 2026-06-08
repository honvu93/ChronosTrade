import { CandleBar } from '../../types';

export interface SwingPoint {
    index: number;
    price: number;
    type: 'HIGH' | 'LOW';
}

export interface SwingPoints {
    /** Bar indices where a swing high was confirmed (uses bars on both sides) */
    highs: number[];
    /** Bar indices where a swing low was confirmed (uses bars on both sides) */
    lows: number[];
}

/**
 * Detects confirmed swing highs and lows using a symmetric window.
 * A swing high at index i requires bar[i].high to be strictly greater than
 * all bars within [i-strength, i+strength].
 *
 * NOTE: swings near the start/end (within `strength` bars) are not detected.
 * For backtesting this is fine since we have all bars upfront.
 */
export function detectSwings(bars: CandleBar[], strength: number): SwingPoints {
    const highs: number[] = [];
    const lows: number[] = [];
    const n = bars.length;

    for (let i = strength; i < n - strength; i++) {
        let isHigh = true;
        let isLow = true;

        for (let j = 1; j <= strength; j++) {
            if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) {
                isHigh = false;
            }
            if (bars[i].low >= bars[i - j].low || bars[i].low >= bars[i + j].low) {
                isLow = false;
            }
            if (!isHigh && !isLow) break;
        }

        if (isHigh) highs.push(i);
        if (isLow) lows.push(i);
    }

    return { highs, lows };
}

/**
 * Builds per-bar lookup arrays: the index of the most recent swing high/low
 * that is confirmed before each bar. Returns -1 where none is found.
 *
 * When `strength` is provided, a swing at index `j` is only available from
 * bar `j + strength` onward (the bar that confirms it). Without `strength`,
 * swings are available from the bar immediately after their index (legacy
 * behaviour — callers should migrate to passing `strength`).
 */
export function buildSwingLookup(
    barCount: number,
    swingHighIndices: number[],
    swingLowIndices: number[],
    strength = 0,
): { lastHighAt: number[]; lastLowAt: number[] } {
    const lastHighAt: number[] = new Array(barCount).fill(-1);
    const lastLowAt: number[] = new Array(barCount).fill(-1);

    // Build maps from confirmation index → swing index
    const highConfirmAt = new Map<number, number>();
    for (const idx of swingHighIndices) {
        const confirmIdx = idx + strength;
        // If multiple swings confirm at the same bar, keep the latest one
        if (!highConfirmAt.has(confirmIdx) || idx > highConfirmAt.get(confirmIdx)!) {
            highConfirmAt.set(confirmIdx, idx);
        }
    }
    const lowConfirmAt = new Map<number, number>();
    for (const idx of swingLowIndices) {
        const confirmIdx = idx + strength;
        if (!lowConfirmAt.has(confirmIdx) || idx > lowConfirmAt.get(confirmIdx)!) {
            lowConfirmAt.set(confirmIdx, idx);
        }
    }

    let lastHigh = -1;
    let lastLow = -1;

    for (let i = 0; i < barCount; i++) {
        // Record the lookup for bar i BEFORE updating — so it reflects "before this bar"
        lastHighAt[i] = lastHigh;
        lastLowAt[i] = lastLow;

        if (highConfirmAt.has(i)) lastHigh = highConfirmAt.get(i)!;
        if (lowConfirmAt.has(i)) lastLow = lowConfirmAt.get(i)!;
    }

    return { lastHighAt, lastLowAt };
}
