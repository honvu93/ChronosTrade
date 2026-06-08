import dotenv from 'dotenv';
import { runBacktestVariant, VariantConfig } from './backtestWorkerCore';

dotenv.config();

/**
 * OPT-3: Exit Profile Upgrade Matrix
 *
 * Tests 4 exit management profiles against top-3 baseline variants
 * from OPT-1/OPT-2 optimization runs.
 *
 * Base variants (all using HARD_SIGNAL_TP baseline):
 *   - B1_ATR135_HARD:    atrMultiplier=1.35
 *   - B4_TP25_HARD:      tpMultiple=2.5, stopLookback=72
 *   - B4_LOOKBACK96_HARD: tpMultiple=2.0, stopLookback=96
 *
 * Exit profiles to test:
 *   - BE_1R_TP_2R:               Break-even at +1R, target 2R
 *   - PARTIAL_1R_BE_R3:          50% partial at 1R, BE, target 3R
 *   - BE_1R_TRAIL_2R_3R:         BE at 1R, ratchet trail at 2R & 3R
 *   - PARTIAL_1R_BE_SWING_TRAIL: 50% at 1R, BE, swing trail 12-bar
 *
 * Total: 3 variants x 4 profiles = 12 runs
 * Period: 2019-01-01 -> 2026-03-14, equity $10K, risk 2%
 */

const BASE_VARIANTS = [
    {
        name: 'B1_ATR135',
        params: { atrMultiplier: 1.35 },
    },
    {
        name: 'B4_TP25',
        params: { tpMultiple: 2.5, stopLookback: 72 },
    },
    {
        name: 'B4_LOOKBACK96',
        params: { tpMultiple: 2.0, stopLookback: 96 },
    },
];

const EXIT_PROFILES = [
    'BE_1R_TP_2R',
    'PARTIAL_1R_BE_R3',
    'BE_1R_TRAIL_2R_3R',
    'PARTIAL_1R_BE_SWING_TRAIL',
] as const;

function buildMatrix(): VariantConfig[] {
    const variants: VariantConfig[] = [];

    for (const base of BASE_VARIANTS) {
        for (const profile of EXIT_PROFILES) {
            const id = `OPT3_${base.name}_${profile}`;
            variants.push({
                id,
                signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
                timeframe: 'M5',
                riskPercent: 2,
                exitProfile: profile,
                params: { ...base.params },
            });
        }
    }

    return variants;
}

async function main() {
    const variants = buildMatrix();

    console.log('=== OPT-3: Exit Profile Upgrade Matrix ===');
    console.log(`Total runs: ${variants.length}`);
    console.log(`Variants: ${BASE_VARIANTS.map(v => v.name).join(', ')}`);
    console.log(`Profiles: ${EXIT_PROFILES.join(', ')}`);
    console.log('');

    const results: Array<{ id: string; status: string }> = [];

    for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        console.log(`\n[${i + 1}/${variants.length}] Running: ${variant.id}`);
        console.log(`  Base params: ${JSON.stringify(variant.params)}`);
        console.log(`  Exit profile: ${variant.exitProfile}`);

        try {
            await runBacktestVariant(variant);
            results.push({ id: variant.id, status: 'DONE' });
        } catch (error: any) {
            console.error(`  => FAILED: ${variant.id} | ${error.message}`);
            results.push({ id: variant.id, status: `FAILED: ${error.message}` });
        }
    }

    console.log('\n=== OPT-3 Matrix Complete ===');
    console.table(results);
}

main().catch(console.error);
