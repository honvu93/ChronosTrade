import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'm30_balanced',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M30',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"tpMultiple":3.0,"stopLookback":18,"atrBufferMultiplier":0.25}
}).catch(console.error);
