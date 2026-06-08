import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'b4_lookback48_hard',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M5',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"stopLookback":48}
}).catch(console.error);
