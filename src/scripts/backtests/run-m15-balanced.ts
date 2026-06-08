import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'm15_balanced',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M15',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"tpMultiple":2.5,"stopLookback":24,"atrBufferMultiplier":0.22}
}).catch(console.error);
