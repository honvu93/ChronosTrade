import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'b4_buffer030_hard',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M5',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"tpMultiple":2.0,"stopLookback":72,"atrBufferMultiplier":0.30}
}).catch(console.error);
