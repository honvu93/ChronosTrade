import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'b2_rsi58_hard',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M5',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"rsiThreshold":58}
}).catch(console.error);
