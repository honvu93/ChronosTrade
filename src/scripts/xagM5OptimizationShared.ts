import { ExecutionConfigInput } from '../services/signals/types';
import { MetalHarnessConfig } from './metalOptimizationHarness';

export const XAG_FROM = new Date('2019-01-01T00:00:00.000Z');
export const XAG_TO = new Date('2026-03-14T23:59:59.999Z');
export const XAG_SYMBOL = 'XAGUSD';
export const XAG_INITIAL_EQUITY = 10_000;
export const XAG_RISK_PERCENT = 2;
export const XAG_DEFAULT_OUT_DIR = '.artifacts/xag-m5-bootstrap';
export const XAG_BASE_SIGNAL_CODE = 'SYS_XAG_ASIAN_BREAK_CONTINUATION_LONG';
export const XAG_DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,
    exitFeeBps: 4,
    entrySlippageBps: 2,
    exitSlippageBps: 2,
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};

export const XAG_M5_HARNESS: MetalHarnessConfig = {
    symbol: XAG_SYMBOL,
    from: XAG_FROM,
    to: XAG_TO,
    initialEquity: XAG_INITIAL_EQUITY,
    riskPercent: XAG_RISK_PERCENT,
    baseSignalCode: XAG_BASE_SIGNAL_CODE,
    defaultOutDir: XAG_DEFAULT_OUT_DIR,
    codePrefix: 'XAGM5',
    defaultExecutionConfig: XAG_DEFAULT_EXECUTION_CONFIG,
};
