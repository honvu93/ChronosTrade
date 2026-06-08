# Signal System -- Disaster Recovery Documentation

This document provides a comprehensive specification of the signal system in the trading automation platform. It is detailed enough to allow a developer to reimplement each service from scratch.

**Source directory:** `src/services/signals/`

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Core Types & Interfaces](#2-core-types--interfaces)
3. [Signal Registry](#3-signal-registry)
4. [Composed Signal Architecture](#4-composed-signal-architecture)
5. [Signal Blocks](#5-signal-blocks)
6. [Signal Plugins](#6-signal-plugins)
7. [Backtesting Engine](#7-backtesting-engine)
8. [Optimization System](#8-optimization-system)
9. [Indicator System](#9-indicator-system)
10. [Alert System](#10-alert-system)
11. [Tracing & Debugging](#11-tracing--debugging)

---

## 1. System Overview

The signal system is the analytical core of the trading platform. It generates, evaluates, backtests, and live-runs trading signals. A signal represents a potential trade entry with entry price, stop loss, and take profit levels.

### Role in the Platform

The signal system sits between raw market data (candles) and trade execution:

```
Candles (TimescaleDB) --> Signal System --> TradingTradeIntent --> MT5 Broker
                                |
                        Backtesting Engine
                        Optimization Engine
                        Live Indicator Runner
```

### Key Responsibilities

- **Signal Definition**: User-composed or hardcoded strategy definitions stored in the database
- **Signal Plugin Runtime**: Evaluate candles bar-by-bar, emit entry/exit signals, events, and traces
- **Backtesting**: Run signals over historical data, produce trade results with full P&L accounting
- **Live Running**: Evaluate signals on incoming candles in real time, persist events, trigger trade intents
- **Optimization**: Parameter sweep across entry/guard/exit variants with train/validation splits
- **Walk-Forward Validation**: Rolling window out-of-sample testing
- **Correlation Analysis**: Detect redundant strategies via trade overlap, equity curve correlation

---

## 2. Core Types & Interfaces

**File:** `types.ts`

### Enums and Constants

```typescript
ORDER_TIMING_VALUES = ['SIGNAL_BAR_CLOSE', 'NEXT_BAR_OPEN', 'LIMIT_TOUCH']
STOP_LOSS_MODE_VALUES = ['SIGNAL_PRICE', 'FIXED_AMOUNT', 'ACCOUNT_PERCENT']
TAKE_PROFIT_MODE_VALUES = ['SIGNAL_PRICE', 'FIXED_AMOUNT', 'ACCOUNT_PERCENT', 'R_MULTIPLE']
POSITION_SIZING_MODE_VALUES = ['RISK_BASED', 'FIXED_QUANTITY', 'ACCOUNT_PERCENT']
```

### CandleBar

The fundamental price data unit:

```typescript
interface CandleBar {
    time: Date;
    symbol: string;
    timeframe: string;
    exchange: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    quoteVolume?: number | null;
    trades?: number | null;
    takerBuyVolume?: number | null;
    isClosed: boolean;
}
```

### NumericPoint / AlignedPoint

Used for indicator series (SMA, RSI, EMA, etc.):

```typescript
interface NumericPoint { time: Date; value: number; }
interface AlignedPoint { time: Date; value: number | null; }
```

### ExecutionConfigInput / ExecutionConfigResolved

Execution configuration controls how trades are modeled:

- **entryFeeBps / exitFeeBps**: Fee in basis points applied to entry/exit fills
- **entrySlippageBps / exitSlippageBps**: Slippage in basis points
- **orderTiming**: When the entry is filled (signal bar close, next bar open, or limit touch)
- **stopLoss**: SL mode and value (SIGNAL_PRICE uses the signal's own SL; FIXED_AMOUNT/ACCOUNT_PERCENT override it)
- **takeProfit**: TP mode and value (same logic; R_MULTIPLE sets TP as a risk multiple)
- **positionSizing**: How position size is determined (RISK_BASED from SL distance, FIXED_QUANTITY, or ACCOUNT_PERCENT)
- **compoundEquity**: When true, position sizing uses running equity instead of initial equity
- **tradeGuards**: Risk management rules (see below)

### TradeGuardConfigInput

Comprehensive risk management layer:

- **lossStreakThrottle**: Steps array defining reduced risk % after N consecutive losses. Example: `[{afterLosses: 3, riskPercent: 0.5}]`
- **lossStreakCooldown**: After N losses, pause trading for M minutes. Resets after cooldown expires.
- **sessionLossCap**: Max losses or max negative net R per trading session (ASIAN/LONDON/NY)
- **dayLossCap**: Same but per UTC day
- **equityCurveFilter**: EMA over N closed trades. If equity < EMA: BLOCK (skip) or HALF_RISK (halve position)
- **maxDrawdownHalt**: Halt all entries when drawdown from equity peak exceeds X%
- **minTradeSpacing**: Minimum minutes between last exit and next entry
- **entryBurstCooldown**: Max N entries within M minutes window; triggers cooldown if exceeded. Unblocks early if any burst trade exits.

### SignalPlugin Interface

The core runtime contract every signal strategy must implement:

```typescript
interface SignalPlugin<TParams, TState> {
    definition: SignalPluginDefinition;  // {code, version, name}
    getRequiredTimeframes?(params, baseTimeframe): string[];
    initialize(context: SignalInitializationContext<TParams>): TState;
    onBar(context: SignalBarContext<TParams, TState>): SignalStepResult<TState> | null;
    finalize?(context & { finalState, output }): Partial<SignalRunOutput> | null;
}
```

- **initialize()**: Called once before the bar loop with all historical bars. Returns initial state.
- **onBar()**: Called for each bar. Returns updated state plus any signals/events/traces/results.
- **finalize()**: Called after all bars. Used for trade lifecycle management (exits, P&L, trade guards).

### SignalStepResult

What a plugin returns per bar:

```typescript
interface SignalStepResult<TState> {
    state: TState;
    signal?: RuntimeSignalDraft;          // New trade signal
    events?: RuntimeSignalEventDraft[];   // Signal lifecycle events
    traces?: RuntimeLogicTraceDraft[];    // Debug/audit traces
    results?: RuntimeResultDraft[];       // Closed trade results
}
```

### RuntimeSignalDraft

A trade signal produced by a plugin:

```typescript
interface RuntimeSignalDraft {
    symbol: string;
    timeframe: string;
    side: PositionSide;           // LONG or SHORT
    strategyCode?: string;
    entryTime: Date;
    entryPrice: number;
    stopLoss: number;
    takeProfit1?: number;
    takeProfit2?: number;
    invalidationPrice?: number;
    notes?: string;
    externalKey?: string;         // Unique key linking signal to events/traces/results
    definitionCode?: string;
    definitionVersion?: number;
    executionConfigJson?: Record<string, unknown>;
}
```

### RuntimeResultDraft

A closed trade result:

```typescript
interface RuntimeResultDraft {
    signalExternalKey: string;
    exitRuleId?: string;
    exitRuleCode?: string;
    resultSide: PositionSide;
    session: TradingSession;
    win: boolean;
    isOpen: boolean;
    rMultiple: number;
    pnlUsd: number;
    maxDrawdownPct: number;
    exitReason: string;
    exitTime?: Date;
    exitPrice?: number;
}
```

### SignalRunRequest / SignalRunOutput

Request to run a signal over a date range:

```typescript
interface SignalRunRequest<TParams> {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    from: Date;
    to: Date;
    parameters: TParams;
    initialEquity?: number;       // default 10,000
    riskPercent?: number;          // default 1%
    executionConfig?: ExecutionConfigInput;
}

interface SignalRunOutput {
    barsProcessed: number;
    signals: RuntimeSignalDraft[];
    events: RuntimeSignalEventDraft[];
    traces: RuntimeLogicTraceDraft[];
    results: RuntimeResultDraft[];
}
```

### Batch Preview Types

For running multiple backtests in parallel:

- **SignalBatchPreviewInput**: Accepts either explicit `requests[]` or a `matrix` of `assets x definitions`
- **SignalBatchPreviewTask**: Normalized task with a `requestKey`
- **SignalBatchPreviewOutput**: Aggregated results with total/succeeded/failed counts

### SignalRuntimeServices

Services injected into plugins during execution:

```typescript
interface SignalRuntimeServices {
    indicatorSeries: {
        calculateSMAFromCandles, calculateSMA,
        calculateRSIFromCandles, calculateRSI,
        calculateEMAFromCandles, calculateEMA,
        calculateWMA,
        getPointAtOrBefore,
        alignPointsToBars,
        calculateATR,
        calculateADX,
    };
    executionModel: {
        resolveConfig, getEntryFill, getExitFill,
        resolvePositionSizing, resolveStopLoss, resolveTakeProfit,
        calculateNetPnl, calculateNetR,
    };
}
```

---

## 3. Signal Registry

**Files:** `SignalRegistry.ts`, `createDefaultSignalRegistry.ts`, `loadComposedSignals.ts`

### SignalRegistry

A singleton in-memory registry that maps `CODE@VERSION` keys to `SignalPlugin` instances.

```typescript
class SignalRegistry {
    static getInstance(): SignalRegistry;
    register<TParams, TState>(plugin: SignalPlugin<TParams, TState>): void;
    unregister(code: string, version: number): void;
    get<TParams, TState>(code: string, version: number): SignalPlugin | null;
    list(): Array<{code, version, name}>;
}
```

Key format: `CODE.toUpperCase()@version` (e.g., `SONG_TRAP@1`).

### createDefaultSignalRegistry()

Creates a new `SignalRegistry` and registers the built-in `songTrapRuntime` plugin. Composed signals are loaded asynchronously at server startup.

### loadComposedSignals()

Called at server startup. Loads all composed signal definitions from the database (`signalDefinition` table where `isComposed=true` and `isActive=true`), validates that all referenced blocks exist in the `TechIndicatorRegistry`, and registers each as a `ComposedSignalPlugin`.

```typescript
async function loadComposedSignals(
    signalRegistry: SignalRegistry,
    prisma: PrismaClient,
    blockRegistry: TechIndicatorRegistry,
    indicatorCatalogService?: IndicatorCatalogService,
): Promise<void>;
```

Process:
1. If `indicatorCatalogService` is provided, sync runtime aliases first
2. Query all active composed signal definitions from DB
3. For each row, parse `composedBlocks` JSON into `ComposedSignalDefinition`
4. Validate all referenced block IDs exist in the block registry
5. Create `ComposedSignalPlugin` instance and register it

---

## 4. Composed Signal Architecture

**Files:** `ComposedSignalPlugin.ts`, `ComposedSignalService.ts`, `composedSignalValidation.ts`

### ComposedSignalDefinition

The JSON structure stored in the database `composed_blocks` column:

```typescript
interface ComposedSignalDefinition {
    matchMode: 'ALL' | 'ANY' | 'SEQUENCE';
    windowBars: number;           // Max bar gap between first and last condition firing
    side: 'LONG' | 'SHORT';
    blocks: ComposedBlockConfig[];
    stopLoss: ComposedStopLossConfig;
    takeProfit: ComposedTakeProfitConfig;
    entryManagement?: ComposedEntryManagementConfig;
    exitManagement?: ComposedExitManagementConfig;
    lineage?: ComposedSignalLineage;
}
```

### ComposedBlockConfig

Each block in a composition:

```typescript
interface ComposedBlockConfig {
    id: string;                    // Unique within this composition
    indicatorId: string;           // Which TechIndicatorBlock (e.g., "RSI", "SMC")
    conditionId: string;           // Which condition from that block
    indicatorParams: Record<string, unknown>;
    conditionParams: Record<string, unknown>;
    timeframe?: string;            // Optional: use a different timeframe
}
```

### Match Modes

- **ALL**: Every block must fire within `windowBars`. windowBars=1 means all on the same bar.
- **ANY**: First block to fire triggers the signal.
- **SEQUENCE**: All blocks must fire, and their fire indices must be non-decreasing in block order.

### Stop Loss Configuration

```typescript
interface ComposedStopLossConfig {
    type: 'BELOW_STRUCTURE' | 'FIXED_PERCENT';
    value: number;                 // Buffer fraction (BELOW_STRUCTURE) or percent fraction (FIXED_PERCENT)
    lookback?: number;             // Bars to look back for BELOW_STRUCTURE (default 20)
    atrBufferMultiplier?: number;  // Optional: add ATR-based buffer
    atrPeriod?: number;            // ATR period for buffering (default 14)
}
```

**BELOW_STRUCTURE logic:**
- LONG: SL = lowest low in lookback bars * (1 - buffer) - optional ATR buffer
- SHORT: SL = highest high in lookback bars * (1 + buffer) + optional ATR buffer

**FIXED_PERCENT logic:**
- LONG: SL = entry * (1 - value)
- SHORT: SL = entry * (1 + value)

### Take Profit Configuration

```typescript
interface ComposedTakeProfitConfig {
    type: 'R_MULTIPLE' | 'FIXED_PERCENT';
    value: number;
}
```

### Exit Management Profiles

10 predefined exit strategy profiles control trade lifecycle after entry:

| Code | Name | Behavior |
|------|------|----------|
| `HARD_SIGNAL_TP` | Hard SL / Signal TP | Simple SL/TP from signal definition |
| `FIXED_1R` | Hard SL / 1R | Fixed 1:1 risk-reward |
| `FIXED_2R` | Hard SL / 2R | Fixed 2R target |
| `BE_1R_TP_2R` | Move BE at 1R / TP 2R | Break-even at 1R, target 2R |
| `PARTIAL_1R_BE_R3` | 50% at 1R / BE / TP 3R | Take 50% at 1R, move BE, target 3R remainder |
| `BE_1R_TRAIL_2R_3R` | BE at 1R / Trail at 2R and 3R | BE at 1R, ratchet stop: 1R@2R, 2R@3R |
| `BE_1R_PARTIAL_2R_TRAIL` | BE 1R / 50% at 2R / Trail | BE at 1R, 50% at 2R, trail remainder through 3R-6R |
| `PARTIAL_1R_BE_SWING_TRAIL` | 50% at 1R / BE / Swing Trail | 50% at 1R, BE, trail behind 12-bar structure |
| `XAU_NY_CLOSE` | TP 2R / Force Close NY End | 2R target, BE at 1R, force close at 21:00 UTC |
| `TIME_24` | Time Stop 24 Bars | 1.5R target, force close after 24 bars |

Each profile is defined as a `ComposedExitProfile` with:
- `targetR`: R-multiple target (null = use signal TP)
- `breakEvenAtR`: Move stop to entry when price reaches this R
- `partialAtR` / `partialCloseFraction`: Take partial profit at this R
- `trailStages[]`: Array of `{triggerR, stopToR}` for progressive trailing
- `maxBarsInTrade`: Force close after N bars (null = no limit)
- `trailByStructureLookback`: Trail behind N-bar swing structure
- `exitAtNyClose`: Force close at 21:00 UTC

### Signal Area Guard

Prevents signal clustering in the same price zone:

```typescript
interface ComposedSignalAreaGuardConfig {
    maxSignalsPerArea: number;    // Max signals in one price area
    resetBars?: number;           // Reset area after N bars of inactivity (default 24)
    priceDistanceR?: number;      // How far (in R) before a new area starts (default 1)
}
```

### ComposedSignalPlugin -- onBar() Logic

1. **Evaluate each block**: For each `ComposedBlockConfig`, look up the `TechIndicatorBlock` in the registry. If the block uses a different timeframe, binary-search for the corresponding bar in `barsByTimeframe`. Call `block.evaluate()` to get `isActive` and updated state.

2. **Update condition window**: If a block's condition fires, record `conditionWindow[blockId] = currentIndex`. Purge entries older than `windowBars`.

3. **Check match**: Apply `matchMode` logic:
   - ALL: every block ID must be present in `conditionWindow`
   - ANY: at least one block ID present
   - SEQUENCE: all present AND indices non-decreasing in block order

4. **Deduplicate**: Skip if the match signature (block states + bar time) equals `lastEmittedMatchSignature`.

5. **Signal area guard**: If configured, check if the new signal is in the same price area. If the area's `emittedSignals >= maxSignalsPerArea`, suppress the signal.

6. **Build signal**: Calculate entry (bar close), stop loss, take profit, and create `RuntimeSignalDraft` + events + traces.

7. **Clear window**: After emitting a signal, clear `conditionWindow` to prevent duplicate signals on adjacent bars.

### ComposedSignalPlugin -- finalize() Logic

The `finalize()` method handles the full trade lifecycle for every signal produced during `onBar()`:

1. **Trade guard evaluation**: For each signal, compute `TradeGuardState` from all previously closed trades:
   - Track consecutive losses, session/day loss caps, equity curve EMA, drawdown from peak
   - Apply loss streak throttle (reduce risk %)
   - Apply equity curve filter (BLOCK or HALF_RISK)
   - Apply max drawdown halt
   - Apply min trade spacing and entry burst cooldown
   - If any guard fires, block the entry and emit FAIL events/traces

2. **Position sizing**: Resolve stop loss, then position size based on effective risk %

3. **Bar-by-bar exit simulation**: Walk forward from entry bar, checking each bar for:
   - Stop hit (including break-even and trailing stops)
   - Partial profit target hit
   - Break-even trigger
   - Trail stage triggers (ratchet stop upward)
   - Swing trail updates (trail behind N-bar structure)
   - NY close force exit
   - Max bars time stop
   - Target hit (final TP)

4. **Result creation**: Build `RuntimeResultDraft` with net R, PnL USD, exit reason, and timing

5. **Compound equity**: Track running equity across trades for compound sizing

### Validation Rules

**File:** `composedSignalValidation.ts`

`validateComposedSignalDefinition()` checks:

- At least 1 block required
- `matchMode` must be ALL, ANY, or SEQUENCE
- `windowBars` must be a positive integer
- `side` must be LONG or SHORT
- `stopLoss.type` must be BELOW_STRUCTURE or FIXED_PERCENT; value must be 0 < v < 1
- BELOW_STRUCTURE requires `lookback >= 1`
- ATR buffer multiplier must be >= 0
- `takeProfit.type` must be R_MULTIPLE or FIXED_PERCENT; value must be > 0
- Exit management profile must be a known code
- Signal area guard: maxSignalsPerArea >= 1, resetBars >= 1, priceDistanceR > 0
- Lineage must use REFINEMENT relationship with valid parent fields
- Each block must have a unique `id`
- Each block's `indicatorId` must exist in the block registry
- Each block's `conditionId` must be valid for that indicator

### ComposedSignalService

**File:** `ComposedSignalService.ts`

CRUD operations for composed signals:

- **list()**: All composed signals ordered by active desc, updated desc
- **getById(id)**: Single composed signal
- **create(input)**: Validate blocks (both catalog and registry), generate code from name (uppercase, max 50 chars), auto-increment version, create DB row, register plugin
- **update(id, input)**: Validate, update DB, re-register plugin. Retired signals are read-only.
- **retire(id)**: Set `isActive=false`, unregister from SignalRegistry
- **listIndicatorBlocks()**: Return available blocks (from catalog service or block registry)

---

## 5. Signal Blocks

**Files:** `blocks/TechIndicatorBlock.ts`, `blocks/TechIndicatorRegistry.ts`, `blocks/createDefaultBlockRegistry.ts`, `blocks/plugins/*`

### TechIndicatorBlock Interface

```typescript
interface TechIndicatorBlock<TParams, TState> {
    definition: TechIndicatorDefinition;
    initialize(bars: CandleBar[], indicatorParams: TParams, services: SignalRuntimeServices): TState;
    evaluate(bar, prevBar, allBars, index, state, indicatorParams, conditionId, conditionParams, services): BlockEvaluateResult<TState>;
}
```

Each block:
1. Pre-computes indicator series in `initialize()` (runs once over all bars)
2. Evaluates a named condition per bar in `evaluate()` (returns `isActive` boolean + debug values)

### TechIndicatorDefinition

```typescript
interface TechIndicatorDefinition {
    id: string;
    name: string;
    category: 'momentum' | 'structure' | 'fibonacci' | 'trend' | 'volatility' | 'utility';
    description: string;
    paramSchema: FieldSchema[];
    conditions: ConditionDef[];
}
```

### TechIndicatorRegistry

Maps block IDs to `TechIndicatorBlock` instances. Supports aliases (e.g., catalog IDs mapping to runtime IDs).

```typescript
class TechIndicatorRegistry {
    register(block): this;
    registerAlias(aliasId, runtimeId): void;
    get(id): TechIndicatorBlock | null;
    has(id): boolean;
    list(): TechIndicatorBlock[];
    listDefinitions(): TechIndicatorDefinition[];
}
```

### Built-in Blocks (15 total)

#### Momentum

**RSI** (`RSI`, category: momentum)
- Params: `period` (default 14)
- Conditions:
  - `value_above`: RSI > threshold
  - `value_below`: RSI < threshold
  - `crosses_above`: RSI crosses above threshold from below
  - `crosses_below`: RSI crosses below threshold from above
  - `divergence_bullish`: Price lower low + RSI higher low
  - `divergence_bearish`: Price higher high + RSI lower high
  - `crosses_above_ema`: RSI crosses above its own EMA(9)
- State: Pre-computed RSI values and RSI EMA aligned to bars

#### Trend & Regime

**EMA Cross** (`EMA_CROSS`, category: trend)
- Params: `fastPeriod` (9), `slowPeriod` (21)
- Conditions: `price_above_ema`, `price_below_ema`, `fast_crosses_above`, `fast_crosses_below`

**Market Regime** (`MARKET_REGIME`, category: trend)
- Params: `adxPeriod` (14), `atrPeriod` (14), `emaFilterPeriod` (200)
- Conditions:
  - `regime_trending_bullish`: ADX > threshold AND price > EMA
  - `regime_trending_bearish`: ADX > threshold AND price < EMA
  - `regime_ranging_chop`: ADX < threshold
  - `regime_high_volatility`: ATR > multiplier * average ATR

**ATR Regime** (`ATR_REGIME`, category: volatility)
- Params: `atrPeriod` (14), `basePeriod` (50)
- Conditions: `atr_low` (below avg), `atr_normal` (near avg), `atr_expansion` (above avg)
- Compares current ATR to SMA of ATR values

**Smart Trail Switch** (`SMART_TRAIL_SWITCH`, category: trend)
- Params: `atrPeriod` (10), `multiplier` (3)
- Conditions: `bullish_switch`, `bearish_switch`, `bullish_state`, `bearish_state`
- ATR-based adaptive trend line that flips when price closes through it

**Confirmation Trend** (`CONFIRMATION_TREND`, category: trend)
- Params: `fastPeriod` (50), `slowPeriod` (200), `adxPeriod` (14)
- Conditions: `confirmation_uptrend`, `confirmation_downtrend`
- Triple confirmation: price vs slow EMA, fast EMA vs slow EMA, ADX strength

**Trend Catcher** (`TREND_CATCHER`, category: trend)
- Params: `fastPeriod` (10), `slowPeriod` (20), `rsiPeriod` (14)
- Conditions: `trend_catcher_bullish`, `trend_catcher_bearish`
- Short-horizon EMA + RSI for pullback detection inside larger moves

#### Structure / Smart Money

**SMC (Smart Money Concepts)** (`SMC`, category: structure)
- Params: `swingStrength` (3), `lookback` (60)
- Conditions:
  - `bullish_ob_formed` / `bearish_ob_formed`: Order Block formation
  - `price_in_bullish_ob` / `price_in_bearish_ob`: Price inside active OB zone
  - `bullish_bos` / `bearish_bos`: Break of Structure
  - `bullish_choch` / `bearish_choch`: Change of Character (first BOS in opposite direction)
  - `bullish_fvg` / `bearish_fvg`: Fair Value Gap (price imbalance)

**Dow Theory Structure** (`DOW_THEORY_STRUCTURE`, category: structure)
- Params: `swingStrength` (3)
- Conditions: `primary_uptrend_confirmed`, `primary_downtrend_confirmed`, `bullish_reversal_warning`, `bearish_reversal_warning`, `bullish_reversal_confirmed`, `bearish_reversal_confirmed`
- Pre-computes full swing structure analysis: higher highs/lows, lower highs/lows, trend state per bar

**Fibonacci** (`FIBONACCI`, category: fibonacci)
- Params: `swingStrength` (3), `lookback` (50), `tolerance` (0.3%)
- Conditions: `price_touch_236`, `price_touch_382`, `price_touch_500`, `price_touch_618`, `price_touch_786`, `price_in_golden_zone` (61.8-78.6%), `bounce_618`
- Pre-computes Fibonacci levels from detected swings

**Elliott Wave** (`ELLIOTT_WAVE`, category: structure)
- Params: `pivotLength` (4)
- Conditions: `motive_bullish` (12345), `motive_bearish` (12345), `corrective_bullish` (ABC), `corrective_bearish` (ABC)
- Detects wave patterns from pivot points

**Session Range Structure** (`SESSION_RANGE_STRUCTURE`, category: structure)
- Params: `asianStartHour` (0), `asianEndHour` (7)
- Conditions: `touches_asian_high`, `touches_asian_low`, `closes_above_asian_high`, `closes_below_asian_low`, `bullish_sweep_asian_low`, `bearish_sweep_asian_high`, `bullish_reclaim_asian_low`, `bearish_reclaim_asian_high`
- Tracks Asian session range for London/NY breakout and sweep signals

**Previous Period Levels** (`PD_LEVELS`, category: structure)
- Params: none
- Conditions (14 total): `touches_previous_day_high/low`, `closes_above/below_previous_day_high/low/midpoint`, `bullish/bearish_reclaim_previous_day_low/high`, `bullish/bearish_sweep_reclaim_previous_day_low/high`, `touches/closes_above/below_previous_week_high/low`
- Computes previous day and previous week high/low/midpoint levels

**Volman Price Action** (`VOLMAN_PRICE_ACTION`, category: structure)
- Params: `buildupBars` (4), `lookbackBars` (20), `atrPeriod` (14), `compressionFactor` (0.6), `boundaryTolerance` (1.5), `breakoutBuffer` (0.5)
- Conditions: `bullish_pressure_buildup`, `bearish_pressure_buildup`, `bullish_buildup_breakout`, `bearish_buildup_breakout`, `bullish_false_break_reversal`, `bearish_false_break_reversal`
- Detects Bob Volman-style buildup pressure patterns, breakouts, and false-break traps

#### Utility

**Session Filter** (`SESSION_FILTER`, category: utility)
- Params: `startHour`, `endHour` (UTC)
- Conditions: `in_session`
- Time-of-day filter

### Swing Detection Utility

**File:** `blocks/utils/swingDetection.ts`

```typescript
function detectSwings(bars: CandleBar[], strength: number): SwingPoints;
function buildSwingLookup(barCount, swingHighIndices, swingLowIndices, strength?): { lastHighAt, lastLowAt };
```

A swing high at index `i` requires `bars[i].high` to be strictly greater than all bars within `[i-strength, i+strength]`. Swing detection is foundational -- used by SMC, Fibonacci, Dow Theory, and Elliott Wave blocks.

---

## 6. Signal Plugins

**Files:** `plugins/songTrap/definition.ts`, `plugins/songTrap/runtime.ts`

### Song Trap Plugin

The only hardcoded (non-composed) signal plugin. Implements a multi-phase RSI-based trap detection strategy.

**Definition:** code=`SONG_TRAP`, version=1

**Parameters:**
- `rsiLength` (14), `emaLength` (9), `wmaLength` (45)
- `trapLevel` (70), `pullbackLevel` (60), `invalidateLevel` (50)
- `trendTf` (trend timeframe), `strategyCode`
- `breakEvenTriggerPct`, trail stage triggers and close percentages
- `closeRemainingOnRangeEnd`

**State machine phases:**
1. `IDLE` -- Waiting for RSI to exceed trap level
2. `AWAIT_PULLBACK` -- RSI crossed trap level, waiting for pullback below pullback level
3. `AWAIT_X1` -- Pullback confirmed, waiting for RSI to reset below EMA and WMA
4. `AWAIT_ENTRY` -- X1 confirmed, waiting for RSI to recross above WMA
5. `ENTRY_ACTIVE` -- Entry signal fired, awaiting confirmation
6. `ENTRY_CONFIRMED` -- Trade confirmed

**Multi-timeframe:** Uses `getRequiredTimeframes()` to request the trend timeframe's bars for trend RSI confirmation.

---

## 7. Backtesting Engine

**Files:** `SignalBacktestRunner.ts`, `SignalBacktestRunService.ts`, `SignalBacktestExecutionService.ts`, `SignalBacktestTradeReplayService.ts`, `BacktestRiskSummaryService.ts`

### Data Flow

```
CreateSignalBacktestInput
  --> SignalBacktestRunService.createGeneratedBacktest()    // Creates PENDING DB row
  --> SignalBacktestExecutionService.executeRun()           // Runs the backtest
      --> SignalPlatformService.runPreview()                // Executes the signal plugin
          --> SignalBacktestRunner.run()                    // Core bar-by-bar loop
      --> Persist signals, events, traces, results to DB
      --> Dispatch webhook outputs
```

### SignalBacktestRunner

The core execution engine. `run()` method:

1. Look up the `SignalPlugin` in the registry by code@version
2. Determine required timeframes (base + any extra from `getRequiredTimeframes()`)
3. Fetch candles for all timeframes via `CandleQueryService.getCandlesByTimeframes()`
4. Build `SignalInitializationContext` with bars, parameters, execution config, and runtime services
5. Call `plugin.initialize()` to get initial state
6. Loop through every base bar: call `plugin.onBar()`, collect signals/events/traces/results
7. Call `plugin.finalize()` if defined, append additional output
8. Return `SignalRunOutput`

### SignalBacktestRunService

Manages backtest run records in the database:

- **createGeneratedBacktest()**: Validate inputs, resolve execution config, create `backtestRun` row with PENDING status. Name format: `{signalName} {symbol} {timeframe} {from}..{to}`
- **listGeneratedBacktests()**: Query with filters (signalCode, symbol, timeframe, status, notes), max 250 rows
- **getGeneratedBacktest()**: Include counts of signals/events/traces/results
- **deleteGeneratedBacktest()**: Cascade delete in transaction (traces -> events -> results -> signals -> run). Blocks if linked to indicator instance or still running.
- **listRunEvents()**: Query signal events for a run with optional filters

### SignalBacktestExecutionService

Orchestrates the full backtest lifecycle:

1. Validate run has all required metadata
2. Set status to RUNNING
3. Call `SignalPlatformService.runPreview()` (which calls `SignalBacktestRunner.run()`)
4. In a transaction (120s timeout):
   - Delete existing signals/events/traces/results for this run
   - Persist each signal (resolving strategy IDs via upsert)
   - Persist events via `SignalAnnotationSerializer`
   - Persist traces via `LogicTraceSerializer`
   - Persist results (resolving exit rule IDs via upsert)
   - Update run status to COMPLETED
5. Dispatch webhook outputs (best-effort)
6. On error: set status to FAILED with error message

**Strategy resolution**: Derives strategy code from `signal.strategyCode`, `signal.definitionCode`, or `run.signalCode`. Normalizes to uppercase, max 40 chars, appends SHA1 hash if longer.

**Exit rule resolution**: Auto-creates exit rules via upsert from result `exitRuleCode`.

**createAndMaybeExecute()**: Convenience method to create and optionally execute in one call.

### SignalBacktestTradeReplayService

Generates rich replay data for visualizing individual trades:

**Response includes:**
- **summary**: Trade metadata (signal, strategy, entry/exit prices, R multiple, quality score)
- **window**: Time focus window with padding bars
- **pricePane**: Candles, price levels (entry/SL/TP), markers (events), trail line, session ranges
- **indicatorPane**: RSI, EMA(9), WMA(45) series
- **structurePane**: Higher-timeframe candles and markers
- **timeline**: Chronological events and traces
- **stageAnalysis**: 3-stage trade management analysis (At Risk -> Protected -> Trailing)
- **raw**: Raw events and traces

### BacktestRiskSummaryService

Computes post-backtest risk metrics:

```typescript
interface BacktestRiskSummary {
    maxConsecutiveLosses: number;
    maxConsecutiveLosingDays: number;
    guardActivationCount: number;
    blockedEntryCount: number;
    equityCurveMaxDdUsd: number;
    equityCurveMaxDdPct: number;
    avgRPerTrade: number;
    medianRPerTrade: number;
    equityCurveFilterBlockCount: number;
    maxDrawdownHaltBlockCount: number;
    minTradeSpacingBlockCount: number;
}
```

Logic:
- Iterates closed results chronologically
- Tracks consecutive loss streaks (respects cooldown resets)
- Groups results by day for consecutive losing day streaks
- Counts guard activations (where effectiveRisk < baseRisk)
- Counts blocked entries from RISK BLOCK events and `entry_blocked_by_trade_guard` traces
- Walks equity curve to find max drawdown (USD and %)
- Computes average and median R per trade

---

## 8. Optimization System

**Files:** `optimization/optimizationTypes.ts`, `optimization/TimeframeOptimizationEngine.ts`, `optimization/TimeframeSearchConfig.ts`, `optimization/WalkForwardEngine.ts`, `optimization/CorrelationService.ts`, `optimization/trainValSplit.ts`, `SignalOptimizationService.ts`, `SignalBatchPlannerService.ts`

### Optimization Architecture

Three-layer optimization:
1. **L1 Entry**: Sweep entry parameters (RSI period/threshold, ATR buffer, window bars, SMC lookback, session filters)
2. **L2 Guards**: Sweep trade guard configurations (tight/moderate/loose + BLOCK/HALF_RISK ECF)
3. **L3 Exit**: Sweep exit profiles + maxBarsInTrade

### SignalOptimizationService

Database-backed optimization job management:

```typescript
class SignalOptimizationService {
    createJob(input: CreateOptimizationJobInput): Promise<{id, signalCode, signalVersion, status}>;
    listJobs(filters): Promise<jobs[]>;
    getJob(id): Promise<job with runs>;
}
```

Jobs link to `signalOptimizationJob` table. Each job has multiple `optimizationRun` records linked to `backtestRun` records.

Default ranking config: `{primaryMetric: 'NET_R', sortProfile: 'DEFAULT_GUARDED'}`.

### TimeframeOptimizationEngine

Runs the 3-layer optimization:

1. Load base signal seed from tier1 definitions (or use override)
2. Detect or use provided date range
3. Split into train/validation sets (default 70/30)
4. Cache candle data for both sets
5. Run each layer sequentially:
   - For each variant in the layer, run backtest on train set
   - Compute `SweepMetrics` (trades, netPnl, netR, winRate, maxDD, profitFactor, etc.)
   - Filter by minimum trade count (varies by timeframe: M5=30, M15=20, H1=10, D1=5)
   - Rank and pick winner
   - Apply winner's parameters before moving to next layer
6. Optionally validate winner on validation set

### TimeframeSearchConfig

Generates parameter sweep variants per timeframe:

**L1 Entry Ranges by Timeframe:**
| Param | M5 | M15 | H1 | D1 |
|-------|-----|------|-----|-----|
| RSI Period | 7-14 | 9-18 | 12-24 | 14-28 |
| ATR Buffer | 1.0-2.0 | 1.0-2.2 | 1.2-2.8 | 1.5-3.5 |
| Window Bars | 2-6 | 2-5 | 1-4 | 1-3 |
| SMC Lookback | 20-60 | 15-50 | 10-30 | 5-15 |
| Session Filter | Yes | Yes | No | No |

Variants are generated via cartesian product of all sweep dimensions.

**L2 Guard Profiles:**
- 3 tightness levels (TIGHT, MODERATE, LOOSE)
- 2 ECF actions (BLOCK, HALF_RISK)
- = 6 guard variants per timeframe
- Each includes day loss caps, session loss caps (low TF only), entry burst cooldown (low TF only)

**L3 Exit Profiles by Timeframe:**
- M5: FIXED_2R, BE_1R_TP_2R, XAU_NY_CLOSE, TIME_24
- H1: PARTIAL_1R_BE_R3, BE_1R_TRAIL_2R_3R, PARTIAL_1R_BE_SWING_TRAIL
- D1: PARTIAL_1R_BE_SWING_TRAIL
- Each profile is swept with maxBarsInTrade range

### Walk-Forward Engine

Rolling out-of-sample validation:

```typescript
class WalkForwardEngine {
    run(candidate: WfCandidate, config: WfRunConfig, gate?: WalkForwardGate): Promise<WalkForwardResult>;
}
```

**Process:**
1. Generate folds: `generateWalkForwardFolds(dataFrom, dataTo, trainMonths=12, testMonths=6, stepMonths=6)`
2. For each fold: run backtest on train window, run backtest on test window
3. Apply gate criteria to test metrics:
   - `minTestPF` >= 1.30 (profit factor)
   - `maxTestDD` <= 15% (equity drawdown)
   - Optional: `maxWrDeltaPP` (max win rate delta between train and test)
4. Count passing folds. Overall pass requires >= `minFoldsPassRatio` (default 75%) of folds
5. Compute composite out-of-sample metrics

**WalkForwardResult includes:**
- Per-fold train and test metrics
- Pass/fail per fold with fail reasons
- Overall pass/fail
- Composite OOS metrics (total trades, net PnL, avg WR, avg PF)

### Correlation Service

Detects redundant strategies:

```typescript
class CorrelationService {
    loadRunTrades(symbol, timeframe): Promise<RunTrades[]>;
    computeCorrelationReport(runTradesArray, symbol, timeframe, clusterThreshold=0.7): CorrelationReport;
}
```

**Three correlation metrics (averaged for final score):**
1. **Trade Overlap %**: % of trades in A that match trades in B within +/-10 minutes
2. **Equity Curve Correlation**: Pearson correlation of daily R returns
3. **Concurrent Drawdown %**: How much drawdown periods overlap (>=50% of shorter period)

**Clustering**: Union-Find grouping of runs with avgCorrelation >= threshold. Each cluster has a representative (highest profit factor). Diversity score = 1 - average correlation.

### SignalBatchPlannerService

Expands batch preview inputs into normalized tasks:

```typescript
class SignalBatchPlannerService {
    expand(input: SignalBatchPreviewInput): SignalBatchPreviewTask[];
}
```

Two input modes:
1. **requests[]**: Direct list of preview requests
2. **matrix**: `assets[] x definitions[]` cartesian product

Max 100 tasks per batch. Each task gets a `requestKey` for tracking.

### Train/Val Split

```typescript
function splitDateRange(from, to, trainPct=70): TrainValSplit;
function generateWalkForwardFolds(dataFrom, dataTo, trainMonths=12, testMonths=6, stepMonths=6): WalkForwardFold[];
```

Walk-forward folds use rolling windows. With step=testMonths, test windows are contiguous (no overlap). Requires at least 1 month of test data.

---

## 9. Indicator System

**Files:** `IndicatorCatalogService.ts`, `IndicatorInstanceService.ts`, `IndicatorLiveRunner.ts`, `IndicatorStateService.ts`, `IndicatorSeriesService.ts`, `IndicatorPromotionService.ts`

### Indicator Lifecycle

```
SignalDefinition (composed) --> Backtest --> Promote --> IndicatorInstance (live)
                                              |
                                        IndicatorLiveRunner.runTick()
                                              |
                                        SignalEvents --> Redis pub/sub --> Frontend
                                              |
                                        TradingTradeIntent --> MT5 Execution
```

### IndicatorCatalogService

Manages the public catalog of indicator blocks with full lifecycle:

**Statuses:** DRAFT -> PUBLISHED -> RETIRED

**Key features:**
- Syncs runtime block definitions to DB catalog (`syncRuntimeAliases`)
- Each catalog entry maps to a runtime block via `runtimeBindingKey`
- Validates schema fields, conditions, and identifiers
- Tracks dependency references (which composed signals use each indicator)
- Provides diagnostics: binding status (MATCHED, MISSING_BINDING, MISSING_RUNTIME, SCHEMA_MISMATCH)
- Blocks publish if no runtime binding or if it's already published
- Blocks delete if any composed signals reference the indicator

**System-published runtime IDs:** DOW_THEORY_STRUCTURE, PD_LEVELS, SESSION_RANGE_STRUCTURE, ATR_REGIME, SMART_TRAIL_SWITCH, CONFIRMATION_TREND, TREND_CATCHER

### IndicatorInstanceService

CRUD for live indicator instances:

```typescript
class IndicatorInstanceService {
    createInstance(params): Promise<instance>;      // Creates with status=ACTIVE
    listInstances(filters): Promise<instances[]>;
    getInstance(id): Promise<instance with events>;
    updateStatus(id, status): Promise<instance>;    // DRAFT|ACTIVE|PAUSED|FAILED|ARCHIVED
    updateCheckpoint(id, stateJson, lastProcessedCandleTime): Promise<instance>;
    updateInstance(id, data): Promise<instance>;
}
```

### IndicatorLiveRunner

Real-time signal evaluation on incoming candles:

```typescript
class IndicatorLiveRunner {
    runTick(instanceId: string): Promise<void>;
}
```

**runTick() process:**
1. Check instance exists and is ACTIVE. Skip if already processing (reentrancy guard).
2. Look up the `SignalPlugin` from the registry
3. Fetch new candles since `lastProcessedCandleTime`
4. Fetch 200 bars of history for indicator warmup
5. Restore state from checkpoint or call `plugin.initialize()`
6. For each new bar, call `plugin.onBar()`
7. If events produced:
   - Persist to `signalEvent` table
   - Publish to Redis `indicator:events` channel for real-time frontend
   - Trigger `TradingTradeIntentService.captureAutoExecuteEntryIntents()` for automated trading
   - Trigger `ExternalActionEventService.captureActionableEvents()` for Telegram/webhook
   - Dispatch webhook outputs
8. If traces produced: persist to `signalLogicTrace` table
9. Save checkpoint (state + lastProcessedCandleTime)
10. Clear error message on success

**Reentrancy:** Uses `processingInstances` Set to prevent concurrent processing of the same instance.

**History window:** Loads 200 bars worth of history (200 * timeframe_minutes * 60000 ms) for indicator warmup.

### IndicatorStateService

Simple checkpoint persistence:

```typescript
class IndicatorStateService {
    saveCheckpoint(indicatorInstanceId, stateJson, lastProcessedCandleTime): Promise<void>;
    loadCheckpoint(indicatorInstanceId): Promise<{state, lastTime, config} | null>;
}
```

### IndicatorSeriesService

Pure calculation service for technical indicators:

```typescript
class IndicatorSeriesService {
    calculateSMAFromCandles(bars, period): NumericPoint[];
    calculateSMA(points, period): NumericPoint[];
    calculateRSIFromCandles(bars, period=14): NumericPoint[];
    calculateRSI(points, period=14): NumericPoint[];
    calculateEMAFromCandles(bars, period): NumericPoint[];
    calculateEMA(points, period): NumericPoint[];
    calculateWMAFromCandles(bars, period): NumericPoint[];
    calculateWMA(points, period): NumericPoint[];
    calculateATR(bars, period=14): NumericPoint[];
    calculateADX(bars, period=14): NumericPoint[];
    alignPointsToBars(bars, points): AlignedPoint[];
    getPointAtOrBefore(points, time): NumericPoint | null;
    toCloseSeries(bars): NumericPoint[];
}
```

**RSI implementation:** Wilder's smoothing method. Initial average over `period` bars, then exponential smoothing.

**ATR implementation:** True Range = max(H-L, |H-prevC|, |L-prevC|). Smoothed using Wilder's method.

**ADX implementation:** Directional Movement (+DM/-DM) -> Wilder's smoothing -> DI+/DI- -> DX -> smooth DX = ADX.

**EMA implementation:** SMA seed over first `period` bars, then k = 2/(period+1).

### IndicatorPromotionService

Promotes a completed backtest to a live indicator:

```typescript
class IndicatorPromotionService {
    promoteBacktest(backtestRunId, name?): Promise<instance>;
}
```

Creates an `IndicatorInstance` with the same signal code, version, parameters, and execution config as the backtest run. Links via `sourceBacktestRunId`.

### CandleQueryService

Fetches candle data from TimescaleDB:

```typescript
class CandleQueryService {
    getCandles(input: CandleQueryInput): Promise<CandleBar[]>;
    getCandlesByTimeframes(input): Promise<Record<string, CandleBar[]>>;
}
```

**Features:**
- Symbol normalization and alias resolution (e.g., BTCUSD, BTCUSDT, BTC/USD all resolve)
- Timeframe normalization and alias resolution
- Deduplication of rows from multiple symbol aliases
- **Auto-resampling**: If no data exists for the requested timeframe but 5m data is available, resamples from 5m bars
- Resampling: Groups source bars into target-timeframe buckets, aggregates OHLCV

---

## 10. Alert System

**Files:** `IndicatorAlertService.ts`, `AlertEngine.ts`, `IndicatorLogger.ts`

### IndicatorAlertService

CRUD for alert rules attached to indicator instances:

```typescript
class IndicatorAlertService {
    createAlert(params: {instanceId, type: 'PRICE'|'INDICATOR'|'VOLATILITY', conditionJson}): Promise<alert>;
    listAlerts(instanceId): Promise<alerts[]>;
    toggleAlert(id, isActive): Promise<alert>;
    deleteAlert(id): Promise<alert>;
    updateTriggerTime(id): Promise<alert>;
    getActiveAlerts(): Promise<alerts with instances>;
}
```

### AlertEngine

Real-time alert evaluation via Redis pub/sub:

```typescript
class AlertEngine {
    init(): void;  // Subscribes to Redis channels
}
```

**Subscriptions:**
- `live:*:*` -- Price tick updates (pattern subscribe)
- `indicator:events` -- Indicator signal events

**Price alert logic:**
- Finds active PRICE alerts where the indicator instance matches the symbol/timeframe
- Evaluates `conditionJson.operator` (> or <) against `conditionJson.target`
- 1-minute cooldown between triggers to prevent spam

**Indicator alert logic:**
- Finds active INDICATOR alerts for the matching instance ID
- Triggers when `event.eventType` matches `conditionJson.eventType`

**Trigger action:**
1. Update `lastTriggeredAt` timestamp
2. Publish to Redis `indicator:alerts:triggered` channel for frontend broadcast

### IndicatorLogger

Real-time logging via Redis pub/sub:

```typescript
class IndicatorLogger {
    log(instanceId, level: 'info'|'warn'|'error'|'debug', message, meta?): Promise<void>;
    info(instanceId, message, meta?): Promise<void>;
    warn(instanceId, message, meta?): Promise<void>;
    error(instanceId, message, meta?): Promise<void>;
    debug(instanceId, message, meta?): Promise<void>;
}
```

Publishes to Redis channel `indicator:logs:{instanceId}` for real-time streaming to the frontend. Also logs to console for server-side visibility.

---

## 11. Tracing & Debugging

**Files:** `SignalTraceService.ts`, `LogicTraceSerializer.ts`, `SignalAnnotationSerializer.ts`

### SignalTraceService

Query interface for logic traces:

```typescript
class SignalTraceService {
    listRunTraces(backtestRunId, filters: {signalId?, signalEventId?, eventType?}): Promise<traces[]>;
}
```

Returns traces ordered by `candleTime ASC, createdAt ASC`.

### LogicTraceSerializer

Converts `RuntimeLogicTraceDraft` objects to Prisma create inputs:

```typescript
class LogicTraceSerializer {
    toCreateManyInput(backtestRunId, signalIdByExternalKey, drafts): Prisma.SignalLogicTraceCreateManyInput[];
    toApi(trace: SignalLogicTrace): formatted trace;
}
```

Each trace record contains:
- `signalId` -- Resolved from `signalExternalKey` via the external key map
- `eventType` -- ENTRY, STOP_HIT, TP_HIT, TRAIL_START, etc.
- `candleTime` -- When the trace occurred
- `stateBefore` / `stateAfter` -- Serialized state snapshots
- `ruleId` -- Identifier of the rule that fired (e.g., `rsi_oversold:value_below`, `stop_hit`, `entry_blocked_by_trade_guard`)
- `indicatorJson` -- Current indicator values
- `thresholdJson` -- Threshold configuration that was evaluated
- `priceJson` -- Price levels at the time
- `notes` -- Human-readable description (e.g., `CONDITION_MET`, `CONDITION_NOT_MET`)

### SignalAnnotationSerializer

Converts `RuntimeSignalEventDraft` objects to Prisma create inputs:

```typescript
class SignalAnnotationSerializer {
    toCreateManyInput(backtestRunId, signalIdByExternalKey, drafts): Prisma.SignalEventCreateManyInput[];
    toApi(event: SignalEvent): formatted event;
}
```

Each event contains:
- `signalId` -- Resolved from external key
- `eventType` -- From `SignalEventType` enum (ENTRY, ENTRY_CONFIRMED, STOP_HIT, TP_HIT, TRAIL_START, TRAIL_UPDATE, MOVE_SL_BE, FAIL, etc.)
- `candleTime` / `price` / `label` / `metaJson`

### Trace Linking in Live Runner

When the live runner persists events and traces, it links them via a key-matching system:
- Event key: `event:{eventType}:{candleTime}` or `signal:{signalExternalKey}:{eventType}:{candleTime}`
- The first matching event candidate is consumed (splice from candidates array) and its `signalEventId` is assigned to the trace

---

## Tier 1 Composed Signal Seeds

**File:** `tier1ComposedSignals.ts`

Pre-defined signal strategies seeded into the database at startup. Examples include:

- **SYS_T1_OB_FIB_LONG**: Bullish order block + Fibonacci golden zone + RSI cross above EMA + market regime bullish
- **SYS_T1_OB_FIB_SHORT**: Mirror short version
- **SYS_T1_BULLISH_OB_RECLAIM**: Structure pullback with bullish OB reclaim
- Various PD level break, Asian session sweep/breakout, BOS+OB confluence strategies
- 4TF (four-timeframe) plan strategies using CHoCH, FVG, RSI divergence, Volman price action

Each seed uses block factory functions (e.g., `regimeBullish()`, `bullishOrderBlock()`, `fibGoldenZone()`) that generate `ComposedBlockConfig` objects with stable IDs (SHA1 hashed).

Seeds are upserted at startup: created if new, updated if the definition hash has changed. Validation runs against the block registry before persist.

---

## SignalPlatformService

**File:** `SignalPlatformService.ts`

The main orchestration service that ties everything together:

```typescript
class SignalPlatformService {
    runPreview(request): Promise<SignalRunOutput>;
    runPreviewBatch(input): Promise<SignalBatchPreviewOutput>;
    getRegistryDefinitions(): Array<{code, version, name}>;
    getIndicatorSeriesService(): IndicatorSeriesService;
    getExecutionModelService(): ExecutionModelService;
    getAnnotationSerializer(): SignalAnnotationSerializer;
    getTraceSerializer(): LogicTraceSerializer;
}
```

**runPreview()**: Ensures the signal definition is loaded (lazy-loads from DB if needed), then delegates to `SignalBacktestRunner.run()`.

**runPreviewBatch()**: Expands input via `SignalBatchPlannerService`, then runs up to `maxConcurrency` (1-8, default 2) workers in parallel. Each worker processes tasks sequentially from a shared cursor.

**ensureDefinitionLoaded()**: If the plugin is not in the registry, looks up the DB definition. If it's a valid, active composed signal, validates it and registers a new `ComposedSignalPlugin`.

---

## ExecutionModelService

**File:** `ExecutionModelService.ts`

Pure calculation service for trade execution modeling:

### resolveConfig(input?)

Resolves `ExecutionConfigInput` into `ExecutionConfigResolved` with defaults and validation:
- Default orderTiming: NEXT_BAR_OPEN
- Default SL/TP mode: SIGNAL_PRICE
- Default position sizing: RISK_BASED
- Validates: RISK_BASED requires SIGNAL_PRICE stop loss
- Sorts loss streak throttle steps by afterLosses ascending
- Validates paired fields (cooldown, ECF, burst cooldown require all fields or none)

### getEntryFill(request) / getExitFill(request)

Applies slippage:
- LONG entry: price * (1 + slippage_bps/10000) -- unfavorable
- LONG exit: price * (1 - slippage_bps/10000) -- unfavorable
- SHORT: reversed

Returns `{adjustedPrice, feeFraction}`.

### resolvePositionSizing(request)

- RISK_BASED: quantity = riskAmountUsd / |entryPrice - stopLossPrice|
- FIXED_QUANTITY: direct value
- ACCOUNT_PERCENT: notionalUsd = equity * pct / 100, quantity = notionalUsd / entryPrice
- Applies maxQuantity cap if configured

### resolveStopLoss(request) / resolveTakeProfit(request)

- SIGNAL_PRICE: uses the signal-provided price
- FIXED_AMOUNT / ACCOUNT_PERCENT: calculates distance from position size
- R_MULTIPLE (TP only): entry + |SL distance| * multiple

### calculateNetPnl(request) / calculateNetR(request)

Full P&L accounting with fees and slippage:
- grossPnl = (exitFill - entryFill) * quantity (LONG) or reversed
- feeUsd = (entryFill * entryFee + exitFill * exitFee) * quantity
- netPnl = grossPnl - feeUsd
- netR = netPnl / riskAmountUsd

---

## SignalDefinitionService

**File:** `SignalDefinitionService.ts`

Simple DB query service:

```typescript
class SignalDefinitionService {
    listDefinitions(): Promise<definitions[]>;  // Active definitions, ordered by code ASC, version DESC
    getDefinition(code, version): Promise<definition | null>;  // Lookup by code_version unique key
}
```
