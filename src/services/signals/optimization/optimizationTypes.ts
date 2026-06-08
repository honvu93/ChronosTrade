import { BacktestRiskSummary } from '../BacktestRiskSummaryService';

// Re-export for convenience
export type { BacktestRiskSummary };

export type OptimizationLayer = 'entry' | 'guards' | 'exit';

export interface OptimizationRequest {
  signalCode: string;
  signalVersion: number;
  symbol: string;
  timeframe: string; // M5 | M15 | M30 | H1 | H4 | D1
  layer: OptimizationLayer | 'all';
  trainValSplit?: number; // default 70
  dateRange?: { from: Date; to: Date };
  topN?: number; // default 5
  minTrades?: number; // override MIN_TRADES_BY_TIMEFRAME
  persist?: boolean;
  dryRun?: boolean;
}

export interface SweepMetrics {
  trades: number;
  netPnl: number;
  netR: number;
  winRate: number;
  maxDd: number;
  profitFactor: number | null;
  maxConsecutiveLosses: number;
  maxConsecutiveLosingDays: number;
  equityCurveMaxDdPct: number;
  avgRPerTrade: number;
  medianRPerTrade: number;
  blockedEntryCount: number;
  guardActivationCount: number;
  equityCurveFilterBlockCount: number;
}

export interface TfVariantResult {
  variantId: string;
  variantLabel: string;
  params: Record<string, unknown>;
  trainMetrics: SweepMetrics;
  valMetrics?: SweepMetrics;
}

export interface LayerSweepResult {
  layer: OptimizationLayer;
  variants: TfVariantResult[]; // sorted by ranking metric
  winner: TfVariantResult;
  totalBacktests: number;
  durationMs: number;
}

export interface OptimizationResult {
  request: OptimizationRequest;
  layers: LayerSweepResult[];
  finalWinner: TfVariantResult;
  trainValSplit: TrainValSplit;
  durationMs: number;
}

export interface TrainValSplit {
  trainFrom: Date;
  trainTo: Date;
  valFrom: Date;
  valTo: Date;
  trainPct: number;
}

export interface EntryVariant {
  id: string;
  label: string;
  mutate(def: unknown): void; // ComposedSignalDefinition
}

export interface GuardVariant {
  id: string;
  label: string;
  guards: Record<string, unknown>; // TradeGuardConfigInput
}

export interface ExitVariant {
  id: string;
  label: string;
  profileCode: string;
  maxBarsInTrade?: number;
}

/** Minimum trades required per timeframe for a variant to be considered valid */
export const MIN_TRADES_BY_TIMEFRAME: Record<string, number> = {
  M5: 30,
  M15: 20,
  M30: 15,
  H1: 10,
  H4: 8,
  D1: 5,
};

// ─── Walk-Forward Types ──────────────────────────────────────────────────────

export interface WalkForwardFold {
  foldIndex: number;
  trainFrom: Date;
  trainTo: Date;
  testFrom: Date;
  testTo: Date;
}

export interface WalkForwardGate {
  /** Minimum PF on test window. Default 1.30 */
  minTestPF: number;
  /** Maximum equity DD% on test window. Default 15 */
  maxTestDD: number;
  /** Maximum |train WR - test WR| in percentage points. Set null to disable. */
  maxWrDeltaPP?: number | null;
  /** Absolute min folds that must pass. Takes precedence over ratio. */
  minFoldsPass?: number;
  /** Ratio of folds that must pass (0.75 = 75%). Used if minFoldsPass not set. Default 0.75 */
  minFoldsPassRatio?: number;
}

export interface WfFoldMetrics {
  backtestRunId?: string;
  trades: number;
  netPnl: number;
  winRate: number;
  profitFactor: number | null;
  equityDD: number;
  maxConsecLosses: number;
  finalEquity: number;
}

export interface WalkForwardFoldResult {
  fold: WalkForwardFold;
  trainMetrics: WfFoldMetrics;
  testMetrics: WfFoldMetrics;
  wrDelta: number;
  pass: boolean;
  failReasons: string[];
}

export interface WalkForwardResult {
  signalCode: string;
  timeframe: string;
  config: { trainMonths: number; testMonths: number; stepMonths: number };
  gate: WalkForwardGate & { resolvedMinFoldsPass: number };
  folds: WalkForwardFoldResult[];
  passCount: number;
  failCount: number;
  totalFolds: number;
  overallPass: boolean;
  compositeOOS: {
    totalTrades: number;
    totalNetPnl: number;
    avgWR: number;
    avgPF: number;
  };
  durationSec: number;
}
