import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'cap5_geom_look96_hard',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M5',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"stopLookback":96,"maxSignalsPerArea":5}
}).catch(console.error);
