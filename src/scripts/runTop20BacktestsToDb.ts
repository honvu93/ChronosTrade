import dotenv from 'dotenv';
import { runBacktestVariant, VariantConfig } from './backtestWorkerCore';

dotenv.config();

const BATCH_TAG = 'top-20-optimization-2026-03-16';

const TOP_20_VARIANTS: VariantConfig[] = [
    {
        id: 'b4_tp25_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 2.5, stopLookback: 72 }
    },
    {
        id: 'b4_lookback96_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 2.0, stopLookback: 96 }
    },
    {
        id: 'b4_buffer015_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 2.0, stopLookback: 72, atrBufferMultiplier: 0.15 }
    },
    {
        id: 'b4_buffer030_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 2.0, stopLookback: 72, atrBufferMultiplier: 0.30 }
    },
    {
        id: 'b5_ema_hold_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 2.0, stopLookback: 72, useEmaFilter: true }
    },
    {
        id: 'b2_rsi56_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { rsiThreshold: 56 }
    },
    {
        id: 'b4_lookback60_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { stopLookback: 60 }
    },
    {
        id: 'b2_rsi58_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { rsiThreshold: 58 }
    },
    {
        id: 'b4_lookback48_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { stopLookback: 48 }
    },
    {
        id: 'b1_atr125_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { atrMultiplier: 1.25 }
    },
    {
        id: 'm15_extended',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M15',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 3.0, stopLookback: 30, atrBufferMultiplier: 0.25 }
    },
    {
        id: 'b1_atr130_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { atrMultiplier: 1.30 }
    },
    {
        id: 'b2_rsi56_atr130_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { rsiThreshold: 56, atrMultiplier: 1.30 }
    },
    {
        id: 'b2_rsi58_atr130_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { rsiThreshold: 58, atrMultiplier: 1.30 }
    },
    {
        id: 'b1_atr135_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { atrMultiplier: 1.35 }
    },
    {
        id: 'm15_balanced',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M15',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 2.5, stopLookback: 24, atrBufferMultiplier: 0.22 }
    },
    {
        id: 'cap5_geom_tp25_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 2.5, maxSignalsPerArea: 5 }
    },
    {
        id: 'm30_balanced',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M30',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { tpMultiple: 3.0, stopLookback: 18, atrBufferMultiplier: 0.25 }
    },
    {
        id: 'cap5_geom_look96_hard',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { stopLookback: 96, maxSignalsPerArea: 5 }
    },
    {
        id: 'ATR12_GUARD_BASELINE',
        signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
        timeframe: 'M5',
        riskPercent: 2,
        exitProfile: 'HARD_SIGNAL_TP',
        params: { atrMultiplier: 1.20, useMarketRegime: true }
    }
];

async function main() {
    const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : TOP_20_VARIANTS.length;

    console.log(`Starting Top 20 Backtest Batch: ${BATCH_TAG}`);
    console.log(`Limit: ${limit} / ${TOP_20_VARIANTS.length}`);

    for (let i = 0; i < limit; i++) {
        const variant = TOP_20_VARIANTS[i];
        console.log(`[${i + 1}/${limit}] Executing: ${variant.id} (${variant.timeframe})`);
        try {
            await runBacktestVariant(variant);
        } catch (error: any) {
            console.error(`  => FAILED: ${variant.id} | ${error.message}`);
        }
    }

    console.log('Batch complete.');
}

main().catch(console.error);
