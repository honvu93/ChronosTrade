import { runBacktestVariant } from '../backtestWorkerCore';

runBacktestVariant({
    id: 'atr12_guard_baseline',
    signalCode: 'SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG',
    timeframe: 'M5',
    riskPercent: 2,
    exitProfile: 'HARD_SIGNAL_TP',
    params: {"atrMultiplier":1.20,"useMarketRegime":true}
}).catch(console.error);
