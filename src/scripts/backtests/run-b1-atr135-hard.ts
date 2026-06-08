import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'b1_atr135_hard',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M5',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"atrMultiplier":1.35}
}).catch(console.error);
