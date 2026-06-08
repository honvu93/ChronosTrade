# 10. Scripts & CLI Tools

This document covers all scripts in `src/scripts/` and root-level utility scripts. These are standalone CLI tools for backtesting, optimization, data integrity checking, and operational setup. Each script connects directly to TimescaleDB via Prisma and runs as a one-shot process.

---

## 1. Scripts Overview

### Categorization by Purpose

| Category | Scripts | Purpose |
|---|---|---|
| **Batch Backtesting** | `runBatchBacktest.ts` | Preset-based batch backtest runner with sharding, deduplication, and leaderboard |
| **Artifact Backtesting** | `runArtifactBacktests.ts`, `persistXauNewLogicBaseBacktests.ts` | Target-based runner that persists new signal logic into DB |
| **Signal Matrix** | `runTier1SignalMatrix.ts`, `executeTier1BacktestMatrix.ts` | Cross-product matrix of signals x symbols x timeframes |
| **Optimization Matrices** | `runXauPhase1OptimizationMatrix.ts`, `runXauExpandedOptimizationMatrix.ts`, `runXauAsianBreak*.ts`, `runOpt*.ts`, `runS5ConfirmRefinementMatrix.ts`, `runChallenger*.ts`, `runCorrectRulesMatrix.ts`, `runDdProtectionMatrix.ts` | Parameter sweep and exit-profile optimization |
| **Walk-Forward Validation** | `runWalkForward15M.ts`, `runWalkForward1H.ts`, `runWalkForward2H.ts`, `runWalkForward4H.ts`, `runWalkForwardD1.ts`, `runWalkForwardValidation.ts`, `runXauOosValidation.ts` | Out-of-sample and walk-forward fold validation |
| **Metal Optimization Harness** | `metalOptimizationHarness.ts`, `xauAbcOptimizationShared.ts`, `xauPriorityBacktestShared.ts`, `xagM5OptimizationShared.ts` | Shared harness for variant-based optimization runs |
| **Preview / Smoke** | `runSignalBatchPreviewSmoke.ts`, `runSignalPlatformSmoke.ts`, `runXauM5RoadmapPreview.ts`, `runXauSmartTrailConfirmPreview.ts`, `smoke_xau_05.ts` | Quick validation and preview runs |
| **Strategy Research** | `runBobVolmanBacktest.ts`, `bobVolmanBacktestShared.ts`, `runNewStrategy*.ts`, `runExitProfileBatch.ts`, `runRRComparison.ts`, `runBE1RPartial2RTrailComparison.ts` | New strategy development and comparison |
| **Data Integrity** | `checkSyncStatus.ts`, `checkLastCandle.ts`, `auditHigherTimeframeCandles.ts` | Candle data freshness and gap auditing |
| **Data Management** | `migrateBtcMt5SymbolCasing.ts`, `cleanupBacktestRuns.ts`, `cleanupKeepWinners.ts`, `tagWinnerBacktests.ts`, `rerunAffectedBacktests.ts` | Data migration, cleanup, and reprocessing |
| **Seeding** | `seedSignalDefinitions.ts`, `seedTier1ComposedSignals.ts`, `seedEngineDemo.ts` | Database seeding for signal definitions |
| **Go-Live Setup** | `setupGoLivePaper.ts`, `setupPaperTrade*.ts`, `setupSignalOnlyTelegramCandidates.ts`, `updatePaperTradeExitProfiles.ts` | Paper/live trading environment configuration |
| **Reporting** | `renderXau*Report.ts` | Post-optimization report generation |
| **Persist Variants** | `persistOpt9*.ts`, `persistXau*.ts` | Persist optimization winners into DB as new signal definitions |
| **Portfolio** | `runPortfolioCorrelation.ts`, `runCorrelationAnalysis.ts` | Cross-strategy correlation analysis |
| **Compound Equity** | `runCompoundSweep.ts`, `runCompoundGuarded.ts`, `runCompoundCapped1Lot.ts` | Compound equity growth simulations |
| **Export** | `exportMt5TradeExecEnv.ts` | Export MT5 environment for trade execution |
| **Root-Level Data** | `check_gaps.ts`, `check_all_tf_gaps.ts`, `check_data_json.ts`, `query.ts` | Quick data inspection utilities |

### Total Script Count

There are approximately 120+ script files in `src/scripts/`, organized into a flat directory with descriptive naming conventions:

- `run*.ts` -- execute a backtest, matrix, or optimization
- `persist*.ts` -- persist optimization results as new signal definitions + backtest runs
- `render*.ts` -- generate reports from completed optimization runs
- `setup*.ts` -- configure live/paper trading infrastructure
- `seed*.ts` -- insert baseline data into DB
- `check*.ts` -- data integrity verification
- `cleanup*.ts` -- remove or archive old backtest data

---

## 2. Batch Backtest System

### Core Script: `runBatchBacktest.ts`

The primary batch runner. Executes a named preset of signal-code/timeframe combinations, persists results to DB, and writes a JSON artifact.

#### CLI Usage

```bash
# Run default preset
ts-node src/scripts/runBatchBacktest.ts --preset xau-phase1

# Run with sharding (for parallel terminals)
ts-node src/scripts/runBatchBacktest.ts --preset 4tf-1h --shard-count 3 --shard-index 0
ts-node src/scripts/runBatchBacktest.ts --preset 4tf-1h --shard-count 3 --shard-index 1
ts-node src/scripts/runBatchBacktest.ts --preset 4tf-1h --shard-count 3 --shard-index 2

# List available presets
ts-node src/scripts/runBatchBacktest.ts --list-presets

# Queue runs without executing (for BullMQ worker pickup)
ts-node src/scripts/runBatchBacktest.ts --preset xau-phase1 --queue-only
```

#### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--preset <name>` | `xau-phase1` | Batch preset ID. One of: `xau-phase1`, `xau-phase1b`, `4tf-15m`, `4tf-1h`, `4tf-2h`, `4tf-4h`, `4tf-volman` |
| `--list-presets` | -- | Show all available presets with descriptions |
| `--symbol <symbol>` | `XAUUSD` | Market symbol |
| `--from <date>` | `2019-01-01` | Start date (YYYY-MM-DD or ISO) |
| `--to <date>` | `2022-12-31` | End date (YYYY-MM-DD or ISO) |
| `--initialEquity <num>` | `10000` | Starting equity in USD |
| `--riskPercent <num>` | `1` | Risk per trade as percentage |
| `--batchTag <tag>` | auto-generated | Unique tag for deduplication and artifact naming |
| `--out <path>` | `.artifacts/batch-backtests/<preset>-<batchTag>.json` | Output artifact path |
| `--maxConcurrency <num>` | `1` | Number of parallel worker coroutines within this process |
| `--shard-count <num>` | `1` | Split preset runs into N contiguous shards |
| `--shard-index <num>` | `0` | Zero-based shard index to execute |
| `--queue-only` | false | Create backtest runs in DB but skip execution |

#### Presets

Each preset defines a list of `{ signalCode, timeframe, strategyFamily, notes }` entries:

- **`xau-phase1`** -- 12 runs: 3 strategy families (Asian Sweep Reversal, PDL/PDH Sweep Reclaim, Asian Break Continuation) across 15m and 1h, long + short
- **`xau-phase1b`** -- 4 runs: Salvage lane focused on 1H bullish continuation
- **`4tf-15m`** -- 16 runs: All M15 strategies (S1-S8) including Volman Pressure, CHoCH+BOS
- **`4tf-1h`** -- 14 runs: All H1 strategies (S1-S7) including PD Level Break, RSI Divergence
- **`4tf-2h`** -- 10 runs: All 2H strategies (S1-S5) including BOS+FVG, Volman False Break
- **`4tf-4h`** -- 10 runs: All 4H strategies (S1-S5) including CHoCH Trend Shift
- **`4tf-volman`** -- 8 runs: Volman early validation gate across 15m/1h/2h/4h

#### Execution Flow

1. Load `.env` and initialize Prisma
2. Upsert Tier 1 composed signal definitions into DB via `upsertTier1ComposedSignals()`
3. Resolve signal versions from seed definitions
4. Apply sharding: slice the run list by `shard-index`/`shard-count`
5. Check existing runs by `batchTag` and task key to skip already-completed runs
6. For each run (with concurrency control):
   - Create a `BacktestRun` record via `SignalBacktestRunService.createGeneratedBacktest()`
   - Execute via `SignalBacktestExecutionService.executeRun()` (unless `--queue-only`)
   - Track outcome: `SKIPPED_COMPLETED | EXECUTED | FAILED | QUEUED`
7. Build leaderboard by querying persisted trade results and risk summaries
8. Write JSON artifact to `--out` path
9. Print summary table to console

#### Deduplication

Runs are deduplicated by a composite key: `signalCode@signalVersion|symbol|timeframe|from|to`, scoped to the `batchTag`. If a matching COMPLETED run exists, it is skipped. RUNNING runs cause a FAILED outcome. PENDING/FAILED runs are re-executed.

---

## 3. Backtest Worker Core

### `backtestWorkerCore.ts`

Exports the `runBacktestVariant()` function used by optimization scripts that need to persist results directly to DB (as opposed to in-memory preview runs).

#### Execution Flow

1. Resolve base signal definition from `getTier1ComposedSignalSeeds()` by `signalCode`
2. Deep-clone the composed blocks definition
3. Apply variant mutations (RSI threshold, ATR multiplier, stop lookback, TP multiple, EMA filter, market regime, signal area guard)
4. Register a temporary signal plugin with a generated code (e.g., `XAB_VAR_<id>`)
5. Create a `BacktestRun` in DB via `SignalBacktestRunService.createGeneratedBacktest()`
6. Execute via `SignalBacktestExecutionService.executeRun()`
7. Unregister the temporary signal and disconnect Prisma

#### Key Types

```typescript
interface VariantConfig {
    id: string;
    signalCode: string;       // Base signal to clone
    timeframe: string;        // Target timeframe
    riskPercent: number;       // Risk per trade
    exitProfile: string;      // Exit management profile code
    params: Record<string, any>; // Variant-specific parameter overrides
}
```

### Shared Utilities

#### `bobVolmanBacktestShared.ts`

Defines Bob Volman strategy specifications as `BobVolmanStrategySpec` objects. Each variant includes:

- Composed signal definition with specific blocks (SESSION_FILTER, CONFIRMATION_TREND, VOLMAN_PRICE_ACTION)
- Execution config with trade guards (minTradeSpacing, equityCurveFilter)
- Four variants: `breakout_long`, `breakout_short`, `false_break_long`, `false_break_short`
- Default parameters: buildupBars=4, lookbackBars=20, atrPeriod=14, compressionFactor=1.4

#### `xauAbcOptimizationShared.ts`

Shared mutation helpers for XAU Asian Break Continuation optimization. Exports:

- `applyM5Base(definition)` -- Switch timeframe parameters to M5
- `setRsiThreshold(definition, value)` -- Override RSI condition threshold
- `setAtrMultiplier(definition, value)` -- Override ATR stop multiplier
- `setStopLookback(definition, value)` -- Override structure stop lookback bars
- `setTakeProfitMultiple(definition, value)` -- Override R-multiple TP target
- `addPriceAboveEma(definition)` -- Add EMA trend filter block
- `addBullishMarketRegime(definition)` -- Add market regime gate block
- `setSignalAreaGuard(definition, config)` -- Set entry area suppression

#### `metalOptimizationHarness.ts`

A generalized harness for running variant groups against a base signal. Key exports:

```typescript
type MetalHarnessConfig = {
    symbol: string;
    from: Date;
    to: Date;
    initialEquity: number;
    riskPercent: number;
    baseSignalCode: string;
    defaultOutDir: string;
    codePrefix: string;
    defaultExecutionConfig: ExecutionConfigInput;
};

type MetalVariantSpec = {
    id: string;
    label: string;
    changeSummary: string;
    exitProfile?: ExitProfile;
    riskPercent?: number;
    executionConfigOverride?: Partial<ExecutionConfigInput>;
    mutate(definition: ComposedSignalDefinition): void;
};
```

The `runMetalVariantGroup()` function:
1. Loads the base signal seed
2. For each variant: clones definition, applies mutations, registers a temp plugin, runs backtest via `SignalBacktestRunner`, computes risk summary
3. Writes results to JSON file
4. Prints console summary table

---

## 4. Optimization Matrices

### Pattern: Parameter Sweep Scripts

Most `runXau*.ts` and `runOpt*.ts` scripts follow the same pattern:

1. Define a `GROUPS` object mapping group keys to lists of variant IDs
2. Define a `VARIANTS` array of `MetalVariantSpec` (or similar), each with:
   - `id` -- unique variant identifier
   - `label` -- human-readable description
   - `changeSummary` -- what this variant changes from baseline
   - `exitProfile` -- exit management strategy
   - `mutate(definition)` -- function that modifies the composed signal definition
3. Parse `--group` and `--out` CLI flags
4. Delegate to `runMetalVariantGroup()` or equivalent

#### Example: `runXauM5RoadmapPreview.ts`

```bash
# List available groups
node -r ts-node/register src/scripts/runXauM5RoadmapPreview.ts --list-groups

# Run all variants
node -r ts-node/register src/scripts/runXauM5RoadmapPreview.ts --group all --out .artifacts/xau-m5-roadmap/all.json

# Run a specific group
node -r ts-node/register src/scripts/runXauM5RoadmapPreview.ts --group freshness_sequence
```

Available groups in this script:
- `guarded_safety` -- Capped safety lane with trade guards
- `freshness_sequence` -- Breakout freshness via SEQUENCE match mode
- `freshness_sequence_area_guard` -- + entry area suppression
- `freshness_sequence_trade_guards` -- + loss streak/session/day caps
- `hybrid_confirm` -- ABC + STC confirmation
- `regime_switch` -- Alpha/safety geometry pair
- `all` -- All variants combined

### Execution Config

All optimization scripts share a standard execution config:

```typescript
const DEFAULT_EXECUTION_CONFIG: ExecutionConfigInput = {
    entryFeeBps: 4,            // 0.04% entry fee
    exitFeeBps: 4,             // 0.04% exit fee
    entrySlippageBps: 2,       // 0.02% entry slippage
    exitSlippageBps: 2,        // 0.02% exit slippage
    orderTiming: 'NEXT_BAR_OPEN',
    stopLoss: { mode: 'SIGNAL_PRICE' },
    takeProfit: { mode: 'SIGNAL_PRICE' },
    positionSizing: { mode: 'RISK_BASED' },
};
```

### Exit Profiles

Scripts sweep across these exit management profiles:

| Profile Code | Description |
|---|---|
| `HARD_SIGNAL_TP` | Hard take-profit at signal TP level |
| `BE_1R_TP_2R` | Move to break-even at 1R, take profit at 2R |
| `PARTIAL_1R_BE_SWING_TRAIL` | Partial close at 1R, BE, then trail via swing structure |
| `BE_1R_TRAIL_2R_3R` | BE at 1R, trail between 2R and 3R |
| `XAU_NY_CLOSE` | Close at NY session end |
| `TIME_24` | Time-based 24-bar exit |

### Trade Guards

Advanced execution configs may include trade guards:

```typescript
tradeGuards: {
    lossStreakThrottle: {
        steps: [
            { afterLosses: 2, riskPercent: 0.5 },
            { afterLosses: 4, riskPercent: 0.25 },
        ],
    },
    sessionLossCap: { maxLosses: 2, maxNetR: 2 },
    dayLossCap: { maxNetR: 3 },
}
```

### Artifact Persistence Scripts (`persist*.ts`)

These scripts take optimization winners and persist them as new signal definitions with executed backtests in the database. Pattern:

1. Define `PersistVariant[]` with mutation logic
2. Create signal definitions in DB via `prisma.signalDefinition.create()`
3. Create and execute backtest runs
4. Write summary JSON to `.artifacts/`

---

## 5. Signal Preview & Smoke Tests

### `runSignalBatchPreviewSmoke.ts`

Runs a quick batch preview via `SignalPlatformService.runPreviewBatch()`. Hardcoded to test SONG_TRAP signal on BTC and XAU at 1H timeframe over a ~8 month window. Does NOT persist to DB -- results are printed to console as JSON.

### `runTier1SignalMatrix.ts`

A comprehensive signal matrix runner that evaluates all Tier 1 composed signals across multiple symbols and timeframes.

#### CLI Usage

```bash
# Full matrix with defaults (BTC/XAU/XAG x 15m/30m/1h/3h/4h)
ts-node src/scripts/runTier1SignalMatrix.ts

# Custom symbols and timeframes
ts-node src/scripts/runTier1SignalMatrix.ts --symbols=XAUUSD --timeframes=1h,4h

# Show all rows (not just top 20)
ts-node src/scripts/runTier1SignalMatrix.ts --full

# Skip file output
ts-node src/scripts/runTier1SignalMatrix.ts --no-write
```

#### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--symbols=X,Y` | `BTCUSD,XAUUSD,XAGUSD` | Comma-separated symbols |
| `--timeframes=X,Y` | `15m,30m,1h,3h,4h` | Comma-separated timeframes |
| `--from=YYYY-MM-DD` | `2019-01-01` | Start date |
| `--to=YYYY-MM-DD` | `2026-03-14` | End date |
| `--initialEquity=N` | `10000` | Starting equity |
| `--riskPercent=N` | `2` | Risk per trade |
| `--maxConcurrency=N` | `2` | Parallel workers (capped at 8) |
| `--top=N` | `20` | Number of top rows to display |
| `--full` | false | Show all rows instead of top N |
| `--no-write` | false | Skip writing output files |
| `--outputDir=PATH` | `artifacts/signal-matrix` | Output directory |
| `--feeBps=N` | 4 | Shorthand: set both entry and exit fee |
| `--slippageBps=N` | 2 | Shorthand: set both entry and exit slippage |
| `--entryFeeBps=N` | 4 | Entry fee in basis points |
| `--exitFeeBps=N` | 4 | Exit fee in basis points |
| `--entrySlippageBps=N` | 2 | Entry slippage in basis points |
| `--exitSlippageBps=N` | 2 | Exit slippage in basis points |
| `--orderTiming=X` | `NEXT_BAR_OPEN` | Order timing mode |

This script runs in-memory (via `SignalPlatformService.runPreview()`) and does NOT persist to the database. It produces three output formats: JSON, CSV, and Markdown.

### `executeTier1BacktestMatrix.ts`

Similar to `runTier1SignalMatrix.ts` but persists results to the database. Uses `SignalBacktestRunService` to create runs and `SignalBacktestExecutionService` to execute them. Supports deduplication via `batchTag`.

#### Additional Flag (vs. runTier1SignalMatrix)

| Flag | Default | Description |
|---|---|---|
| `--batchTag=X` | `tier1-matrix-2019-2026-03-14` | Tag for deduplication in DB |

---

## 6. Data Integrity Scripts

### `checkSyncStatus.ts` (in `src/scripts/`)

Checks the latest candle timestamp for each symbol/timeframe combination and displays the lag in minutes.

```bash
ts-node src/scripts/checkSyncStatus.ts
```

Output format:
```
XAUUSD   | 1h  | UTC: 2026-04-14T12:00:00.000Z | GMT+7: 2026-04-14 19:00:00 | Lag: 45 min
```

Checks symbols: XAUUSD, XAGUSD, BTCUSD across timeframes: 1m, 5m, 15m, 1h.

### `checkLastCandle.ts` (in `src/scripts/`)

Quick check of the 5 most recent XAUUSD 1H candles. Minimal diagnostic script.

```bash
ts-node src/scripts/checkLastCandle.ts
```

### `auditHigherTimeframeCandles.ts` (in `src/scripts/`)

Comprehensive audit of higher-timeframe candle data (1D, W, MN1) for all assets. Checks:

- Physical row count and distinct timestamps
- Data range and hours since last candle
- Symbol aliases present
- Group-level breakdowns by symbol/timeframe/exchange
- Duplicate/overlap timestamps
- Gaps above configurable threshold (4 days for 1D, 10 days for W, 45 days for MN1)
- Sample candles (earliest and latest 3)

```bash
# Text report (default)
ts-node src/scripts/auditHigherTimeframeCandles.ts

# JSON output
ts-node src/scripts/auditHigherTimeframeCandles.ts --json

# Filter by asset and timeframe
ts-node src/scripts/auditHigherTimeframeCandles.ts --assets=BTC,XAU --timeframes=1D,W
```

### `check_gaps.ts` (scripts/dev/)

Full gap analysis across all symbols (BTCUSD, XAUUSD, XAGUSD) and timeframes (1d, 4h, 1h, 15m, 5m, 1m). Features:

- Metal-aware weekend filtering (Friday 21:00 UTC to Sunday 22:00 UTC)
- Writes detailed gap report to `gap_report.json`
- Prints top 3 largest gaps per symbol/timeframe to console

```bash
ts-node scripts/dev/check_gaps.ts
```

### `check_all_tf_gaps.ts` (scripts/dev/)

Focused gap analysis for BTCUSD across all timeframes, filtered to data since 2026-02-01.

```bash
ts-node scripts/dev/check_all_tf_gaps.ts
```

### `check_data_json.ts` (scripts/dev/)

Outputs machine-readable JSON summary of candle counts, signal counts, and backtest run counts grouped by symbol/timeframe/status. Output is wrapped in `===JSON_START===` / `===JSON_END===` markers for programmatic parsing.

```bash
ts-node scripts/dev/check_data_json.ts
```

### `query.ts` (scripts/dev/)

Writes a detailed `result.json` file with candle group counts, signal group counts, and backtest group counts. Similar to `check_data_json.ts` but writes to file instead of stdout.

```bash
ts-node scripts/dev/query.ts
```

---

## 7. Migration Scripts

### `migrateBtcMt5SymbolCasing.ts`

Migrates candle data from legacy symbol `BTCUSDC` to canonical `BTCUSD` for the MT5 exchange. Operations:

1. Count rows before migration
2. INSERT ... ON CONFLICT UPDATE candles from BTCUSDC to BTCUSD
3. DELETE the BTCUSDC rows
4. Update references in `backtestRun`, `signal`, and `signalOptimizationJob` tables
5. Count rows after migration
6. Print JSON summary

```bash
ts-node src/scripts/migrateBtcMt5SymbolCasing.ts
```

### `cleanupBacktestRuns.ts`

Cleanup utility that keeps the top ~50 most important backtest runs (by priority tags) and deletes the rest. Supports dry-run mode.

```bash
# Preview what would be deleted
ts-node src/scripts/cleanupBacktestRuns.ts

# Actually delete
ts-node src/scripts/cleanupBacktestRuns.ts --apply
```

Priority order for keeping runs:
1. `[go-live-candidate]` tagged runs
2. `[portfolio-corr]` tagged runs
3. `[phase3]` tagged runs
4. `[compound-sweep]` with `risk=3%`
5. `[compound-guarded]` with `R3-LIGHT`

### `tagWinnerBacktests.ts`

Tags selected backtest runs as winners for later reference.

### `rerunAffectedBacktests.ts`

Re-executes backtests that were affected by signal logic changes.

---

## 8. CLI Interface

### Argument Parsing Patterns

All scripts use a manual argument parser (no external CLI library). Two styles are used:

**Space-separated style** (used by `runBatchBacktest.ts`):
```bash
--preset xau-phase1 --from 2019-01-01 --maxConcurrency 4
```

**Equals-sign style** (used by `runTier1SignalMatrix.ts`):
```bash
--symbols=XAUUSD,XAGUSD --timeframes=1h,4h --riskPercent=2
```

### Common Flags Across Scripts

| Flag | Used By | Description |
|---|---|---|
| `--group <name>` | Optimization matrices | Select variant group to execute |
| `--list-groups` | Optimization matrices | Show available groups |
| `--out <path>` | Most scripts | Output artifact path |
| `--from` / `--to` | Backtest scripts | Date range (YYYY-MM-DD or ISO 8601) |
| `--symbol` / `--symbols` | Backtest scripts | Market symbol(s) |
| `--timeframes` | Matrix scripts | Comma-separated timeframes |
| `--initialEquity` | Backtest scripts | Starting equity (default: 10000) |
| `--riskPercent` | Backtest scripts | Risk per trade % (default: 1-2) |
| `--maxConcurrency` | Batch/matrix scripts | Parallel workers within process |
| `--batchTag` | Batch/matrix scripts | Deduplication tag |
| `--logic` | Artifact scripts | Select which logic variant(s) to run |
| `--list-logics` | Artifact scripts | Show available logic keys |
| `--list-targets` | `runArtifactBacktests.ts` | Show artifact targets |
| `--target` | `runArtifactBacktests.ts` | Select artifact target |
| `--preset` | `runBatchBacktest.ts` | Select batch preset |
| `--list-presets` | `runBatchBacktest.ts` | Show available presets |
| `--shard-count` | `runBatchBacktest.ts` | Number of shards for parallel execution |
| `--shard-index` | `runBatchBacktest.ts` | Zero-based shard index |
| `--queue-only` | `runBatchBacktest.ts` | Create runs without executing |
| `--full` | `runTier1SignalMatrix.ts` | Show all rows instead of top N |
| `--no-write` | `runTier1SignalMatrix.ts` | Skip file output |
| `--json` | `auditHigherTimeframeCandles.ts` | Output as JSON |
| `--apply` | `cleanupBacktestRuns.ts` | Execute destructive operation (default: dry-run) |
| `--help` / `-h` | Most scripts | Print usage |

### Date Parsing

Dates accept two formats:
- Short: `2019-01-01` -- auto-expanded to `2019-01-01T00:00:00.000Z` (for `--from`) or `2019-01-01T23:59:59.999Z` (for `--to`)
- ISO: `2019-01-01T00:00:00.000Z` -- used as-is

---

## 9. Output Formats

### Batch Backtest Artifact (`.artifacts/batch-backtests/*.json`)

```json
{
    "preset": "xau-phase1",
    "description": "Phase 1 XAU baseline...",
    "batchTag": "xau-phase1-2019-01-01-2022-12-31",
    "queueOnly": false,
    "symbol": "XAUUSD",
    "from": "2019-01-01T00:00:00.000Z",
    "to": "2022-12-31T23:59:59.999Z",
    "initialEquity": 10000,
    "riskPercent": 1,
    "generatedAt": "2026-04-14T10:00:00.000Z",
    "shard": {
        "index": 0,
        "count": 1,
        "start": 0,
        "end": 12,
        "selectedRuns": 12,
        "totalPresetRuns": 12
    },
    "outcomes": [
        {
            "preset": { "signalCode": "...", "timeframe": "15m", "strategyFamily": "15M-S1", "notes": "..." },
            "signalVersion": 1,
            "runId": "uuid",
            "state": "EXECUTED",
            "status": "COMPLETED",
            "counts": { "signals": 150, "events": 500, "traces": 300, "results": 80 }
        }
    ],
    "leaderboard": [
        {
            "runId": "uuid",
            "signalCode": "SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG",
            "timeframe": "1h",
            "status": "COMPLETED",
            "strategyFamily": "1H-baseline-C",
            "totalTrades": 80,
            "closedTrades": 78,
            "wins": 45,
            "losses": 33,
            "winRate": 57.69,
            "profitFactor": 1.85,
            "netR": 28.5,
            "netUsd": 2850.0,
            "maxDrawdownPct": -8.5,
            "equityCurveMaxDdUsd": 850.0,
            "equityCurveMaxDdPct": 6.5,
            "maxConsecutiveLosses": 4,
            "maxConsecutiveLosingDays": 3,
            "guardActivationCount": 0,
            "blockedEntryCount": 0,
            "avgRPerTrade": 0.37,
            "medianRPerTrade": 0.25
        }
    ]
}
```

### Signal Matrix Report (`artifacts/signal-matrix/`)

Three files are generated per run:
- `tier1-signal-matrix-<timestamp>.json` -- Full report with all rows
- `tier1-signal-matrix-<timestamp>.csv` -- Flat CSV for spreadsheet analysis
- `tier1-signal-matrix-<timestamp>.md` -- Markdown summary with tables

Plus "latest" symlinks:
- `tier1-signal-matrix-latest.json`
- `tier1-signal-matrix-latest.csv`
- `tier1-signal-matrix-latest.md`

#### Matrix Row Fields

| Field | Type | Description |
|---|---|---|
| `signalCode` | string | Signal definition code |
| `signalVersion` | number | Signal version |
| `signalName` | string | Human-readable name |
| `definitionSource` | `'db' \| 'seed'` | Where the definition was loaded from |
| `symbol` | string | Market symbol |
| `timeframe` | string | Candle timeframe |
| `status` | `SUCCEEDED \| NO_DATA \| FAILED` | Run outcome |
| `barsProcessed` | number | Total candle bars evaluated |
| `signalCount` | number | Signals generated |
| `closedTrades` | number | Completed trades |
| `wins` / `losses` / `breakEven` | number | Trade outcome counts |
| `winRate` | number | Win percentage |
| `profitFactor` | number | Gross profit / gross loss |
| `expectancy` | number | Average R per trade |
| `netR` | number | Net R-multiple (sum of closed trade R) |
| `netUsd` | number | Net P&L in USD |
| `avgWinR` / `avgLossR` | number | Average R for wins/losses |
| `maxDrawdownPct` | number | Maximum drawdown percentage |
| `durationMs` | number | Execution time in milliseconds |

### Metal Optimization Output (`.artifacts/<dir>/*.json`)

```json
{
    "generatedAt": "2026-04-14T10:00:00.000Z",
    "group": "all",
    "groupLabel": "All variants",
    "symbol": "XAUUSD",
    "from": "2019-01-01T00:00:00.000Z",
    "to": "2026-03-14T23:59:59.999Z",
    "initialEquity": 10000,
    "riskPercent": 2,
    "executionConfig": { ... },
    "baseSignalCode": "SYS_XAU_ASIAN_BREAK_CONTINUATION_LONG",
    "baseSignalName": "...",
    "notes": ["..."],
    "results": [
        {
            "variantId": "guarded_capped_safety",
            "variantLabel": "Guarded capped safety lane",
            "changeSummary": "Cap M5 continuation to 5 entries per area...",
            "baseSignalCode": "...",
            "baseSignalName": "...",
            "timeframe": "M5",
            "exitProfile": "HARD_SIGNAL_TP",
            "riskPercent": 1,
            "executionConfig": { ... },
            "summary": {
                "trades": 500,
                "netPnl": 3200.0,
                "netR": 32.0,
                "winRate": 58.5,
                "maxDd": -12.3,
                "profitFactor": 1.65
            },
            "riskSummary": { ... }
        }
    ]
}
```

### Output Directory Structure

```
.artifacts/
  batch-backtests/
    xau-phase1-<batchTag>.json
    4tf-1h-<batchTag>-shard-1-of-3.json
  xau-m5-roadmap/
    all.json
    freshness_sequence.json
  xau-new-logics-2026-03-16/
    persisted_m5_base_runs.json
  walk-forward/
    *.json

artifacts/
  signal-matrix/
    tier1-signal-matrix-<timestamp>.json
    tier1-signal-matrix-<timestamp>.csv
    tier1-signal-matrix-<timestamp>.md
    tier1-signal-matrix-latest.json

gap_report.json           (from check_gaps.ts)
result.json               (from query.ts)
```

---

## 10. Script Patterns

### Common Initialization Pattern

Every script follows this initialization sequence:

```typescript
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenv.config();

async function main() {
    const prisma = new PrismaClient();
    try {
        // ... script logic
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
});
```

### Concurrency Control

Batch scripts use a cursor-based worker pool pattern:

```typescript
let cursor = 0;
const worker = async () => {
    while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        // execute task at index
    }
};
await Promise.all(
    Array.from({ length: maxConcurrency }, () => worker())
);
```

This pattern avoids creating a separate Promise per task and provides natural load balancing.

### Signal Registration for Variants

When running variants that modify composed signal definitions, scripts:

1. Clone the base definition: `const definition = JSON.parse(JSON.stringify(baseSeed.composedBlocks))`
2. Apply mutations via helper functions
3. Register a temporary plugin: `registry.register(new ComposedSignalPlugin(definition, blockRegistry, tmpCode, version, name))`
4. Execute the backtest
5. Unregister: `registry.unregister(tmpCode, version)` in a `finally` block

### Symbol Normalization

All scripts normalize symbols via `normalizeMarketSymbol()` and use `getMarketSymbolAliases()` when querying candles, to handle variations like `BTCUSDT`, `BTC/USDT`, `BTCUSD`.

### Date Boundary Normalization

Short dates are expanded based on boundary:
- Start boundary: `2019-01-01` becomes `2019-01-01T00:00:00.000Z`
- End boundary: `2022-12-31` becomes `2022-12-31T23:59:59.999Z`

### Error Handling

- Scripts set `process.exitCode = 1` on partial failures (some runs failed)
- Scripts call `process.exit(1)` on fatal errors
- `printUsage()` is called on argument parse errors
- Prisma disconnect is always in a `finally` block

### Sharding for Parallel Execution

The batch backtest system supports distributing runs across multiple terminals:

```bash
# Terminal 1
ts-node src/scripts/runBatchBacktest.ts --preset 4tf-15m --shard-count 3 --shard-index 0

# Terminal 2
ts-node src/scripts/runBatchBacktest.ts --preset 4tf-15m --shard-count 3 --shard-index 1

# Terminal 3
ts-node src/scripts/runBatchBacktest.ts --preset 4tf-15m --shard-count 3 --shard-index 2
```

Sharding divides the preset's run list into contiguous slices. Combined with `--maxConcurrency`, this enables 3 terminals x 20 parallel = 60 concurrent backtests (per project memory).

### Deduplication via Batch Tags

All batch/matrix scripts tag their runs with a batch identifier embedded in the `notes` field (e.g., `[batch:xau-phase1-2019-01-01-2022-12-31]`). Before executing, scripts query for existing runs with the same tag and task key. Completed runs are skipped; failed/pending runs are re-executed.

### Risk Summary Computation

After execution, batch scripts compute risk summaries via `BacktestRiskSummaryService.summarize()`, which aggregates:

- Equity curve max drawdown (USD and %)
- Max consecutive losses
- Max consecutive losing days
- Guard activation and blocked entry counts
- Average and median R per trade
