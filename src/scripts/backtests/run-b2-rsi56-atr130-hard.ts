import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'b2_rsi56_atr130_hard',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M5',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"rsiThreshold":56,"atrMultiplier":1.30}
}).catch(console.error);
