import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'm15_extended',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M15',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"tpMultiple":3.0,"stopLookback":30,"atrBufferMultiplier":0.25}
}).catch(console.error);
