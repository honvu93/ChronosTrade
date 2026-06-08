import { PrismaClient } from '@prisma/client';
import { SignalRegistry } from '../SignalRegistry';
import { SignalBacktestRunner } from '../SignalBacktestRunner';
import { CandleQueryService } from '../CandleQueryService';
import { IndicatorSeriesService } from '../IndicatorSeriesService';
import { ExecutionModelService } from '../ExecutionModelService';
import { createDefaultBlockRegistry } from '../blocks/createDefaultBlockRegistry';
import { BacktestRiskSummaryService } from '../BacktestRiskSummaryService';
import { ComposedSignalPlugin } from '../ComposedSignalPlugin';
import type { ComposedSignalDefinition } from '../ComposedSignalPlugin';
import { getTier1ComposedSignalSeeds } from '../tier1ComposedSignals';
import type { CandleBar, ExecutionConfigInput } from '../types';
import { normalizeMarketSymbol, getMarketSymbolAliases } from '../../../utils/symbols';
import { normalizeTimeframe, getTimeframeAliases } from '../../../utils/timeframes';
import { splitDateRange, formatSplitInfo } from './trainValSplit';
import {
    OptimizationRequest,
    OptimizationResult,
    OptimizationLayer,
    LayerSweepResult,
    TfVariantResult,
    SweepMetrics,
    EntryVariant,
    GuardVariant,
    ExitVariant,
    MIN_TRADES_BY_TIMEFRAME,
} from './optimizationTypes';

const BATCH_SIZE = 10;

interface BacktestJob {
    index: number;
    variantId: string;
    variantLabel: string;
    def: ComposedSignalDefinition;
    execParams: Record<string, unknown>;
    params: Record<string, unknown>;
}

export class TimeframeOptimizationEngine {
    private prisma: PrismaClient;
    private registry: SignalRegistry;
    private candleQuery: CandleQueryService;
    private riskService: BacktestRiskSummaryService;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.registry = SignalRegistry.getInstance();
        this.candleQuery = new CandleQueryService(prisma);
        this.riskService = new BacktestRiskSummaryService();
    }

    /**
     * Run optimization for a given request.
     * Accepts pre-generated variants for each layer.
     */
    async run(
        request: OptimizationRequest,
        variants: {
            entry?: EntryVariant[];
            guards?: GuardVariant[];
            exit?: ExitVariant[];
        },
        baseDefOverride?: ComposedSignalDefinition,
    ): Promise<OptimizationResult> {
        const startMs = Date.now();
        const { symbol, timeframe, layer } = request;

        // 1. Load base signal seed (or use override for cross-TF optimization)
        const baseDef = baseDefOverride ?? this.loadBaseSeed(request.signalCode);
        if (!baseDef) throw new Error(`Signal seed not found: ${request.signalCode}`);

        // 2. Determine date range
        const dateRange = request.dateRange ?? await this.detectDateRange(symbol, timeframe);

        // 3. Split train/val
        const split = splitDateRange(dateRange.from, dateRange.to, request.trainValSplit ?? 70);
        console.log(formatSplitInfo(split));

        // 4. Fetch and cache candles for train set
        console.log('Caching candle data...');
        const trainCandles = await this.candleQuery.getCandles({
            symbol, timeframe, from: split.trainFrom, to: split.trainTo,
        });
        console.log(`  Cached ${trainCandles.length} bars for train set`);

        const valCandles = await this.candleQuery.getCandles({
            symbol, timeframe, from: split.valFrom, to: split.valTo,
        });
        console.log(`  Cached ${valCandles.length} bars for val set`);

        // 5. Run layers
        const layers: LayerSweepResult[] = [];
        let currentDef = JSON.parse(JSON.stringify(baseDef)) as ComposedSignalDefinition;
        let currentGuards: Record<string, unknown> = {};

        const minTrades = request.minTrades ?? MIN_TRADES_BY_TIMEFRAME[timeframe] ?? 10;

        if (layer === 'entry' || layer === 'all') {
            if (!variants.entry || variants.entry.length === 0) {
                throw new Error('No entry variants provided');
            }
            console.log(`\n── Layer 1: Entry ── (${variants.entry.length} variants, min trades: ${minTrades})`);
            const result = await this.sweepEntryLayer(
                currentDef, variants.entry, symbol, timeframe,
                trainCandles, minTrades, request.topN ?? 5,
            );
            layers.push(result);
            // Apply winner mutations to currentDef
            const winnerVariant = variants.entry.find((v) => v.id === result.winner.variantId);
            if (winnerVariant) {
                currentDef = JSON.parse(JSON.stringify(baseDef));
                winnerVariant.mutate(currentDef);
            }
            console.log(`  → Winner: ${result.winner.variantLabel} (PF=${result.winner.trainMetrics.profitFactor?.toFixed(2) ?? 'N/A'})`);
        }

        if (layer === 'guards' || layer === 'all') {
            if (!variants.guards || variants.guards.length === 0) {
                throw new Error('No guard variants provided');
            }
            console.log(`\n── Layer 2: Guards ── (${variants.guards.length} variants)`);
            const result = await this.sweepGuardLayer(
                currentDef, variants.guards, symbol, timeframe,
                trainCandles, minTrades, request.topN ?? 5,
            );
            layers.push(result);
            currentGuards = result.winner.params;
            console.log(`  → Winner: ${result.winner.variantLabel} (streak=${result.winner.trainMetrics.maxConsecutiveLosses})`);
        }

        if (layer === 'exit' || layer === 'all') {
            if (!variants.exit || variants.exit.length === 0) {
                throw new Error('No exit variants provided');
            }
            console.log(`\n── Layer 3: Exit ── (${variants.exit.length} variants)`);
            const result = await this.sweepExitLayer(
                currentDef, currentGuards, variants.exit, symbol, timeframe,
                trainCandles, minTrades, request.topN ?? 5,
            );
            layers.push(result);
            console.log(`  → Winner: ${result.winner.variantLabel} (PF=${result.winner.trainMetrics.profitFactor?.toFixed(2) ?? 'N/A'})`);
        }

        // 6. Validate final winner on val set
        const finalWinner = layers[layers.length - 1].winner;
        console.log('\n── Validation ──');
        console.log(`  Train PF: ${finalWinner.trainMetrics.profitFactor?.toFixed(2) ?? 'N/A'}`);

        if (valCandles.length > 0 && finalWinner.variantId !== 'NONE') {
            try {
                // Reconstruct the winning definition
                const valDef = JSON.parse(JSON.stringify(baseDef)) as ComposedSignalDefinition;

                // Apply L1 entry winner mutations
                if (layer === 'entry' || layer === 'all') {
                    const entryWinner = layers.find((l) => l.layer === 'entry')?.winner;
                    const entryVariant = entryWinner ? variants.entry?.find((v) => v.id === entryWinner.variantId) : null;
                    if (entryVariant) entryVariant.mutate(valDef);
                }

                // Apply L3 exit winner
                const exitWinner = layers.find((l) => l.layer === 'exit')?.winner;
                if (exitWinner?.params?.profileCode) {
                    (valDef as unknown as Record<string, unknown>).exitManagement = { profileCode: exitWinner.params.profileCode };
                }

                // Build exec config from L2 guard winner
                const guardWinner = layers.find((l) => l.layer === 'guards')?.winner;
                const valExecParams = guardWinner?.params ?? {};

                if (exitWinner?.params?.maxBarsInTrade !== undefined) {
                    (valExecParams as Record<string, unknown>).maxBarsInTrade = exitWinner.params.maxBarsInTrade;
                }

                const valMetrics = await this.runBacktest(
                    valDef, valExecParams, `VAL_${timeframe}`, symbol, timeframe, valCandles,
                );

                if (valMetrics) {
                    finalWinner.valMetrics = valMetrics;
                    const pfDelta = valMetrics.profitFactor != null && finalWinner.trainMetrics.profitFactor != null
                        ? (valMetrics.profitFactor - finalWinner.trainMetrics.profitFactor).toFixed(2)
                        : 'N/A';
                    console.log(`  Val PF: ${valMetrics.profitFactor?.toFixed(2) ?? 'N/A'} (Δ ${pfDelta})`);
                    console.log(`  Val WR: ${valMetrics.winRate.toFixed(1)}% | Trades: ${valMetrics.trades} | DD: ${valMetrics.equityCurveMaxDdPct.toFixed(1)}%`);

                    // OOS health check
                    const trainPF = finalWinner.trainMetrics.profitFactor ?? 0;
                    const valPF = valMetrics.profitFactor ?? 0;
                    if (valPF < 1.0) {
                        console.log('  ⚠️  OOS FAIL: Val PF < 1.0 — likely overfit');
                    } else if (trainPF > 0 && valPF < trainPF * 0.5) {
                        console.log('  ⚠️  OOS DEGRADATION: Val PF dropped >50% from train');
                    } else {
                        console.log('  ✅ OOS PASS');
                    }
                } else {
                    console.log('  ⚠️  No val results (0 trades on val set)');
                }
            } catch (err: any) {
                console.log(`  ⚠️  Val run error: ${err.message}`);
            }
        }

        return {
            request,
            layers,
            finalWinner,
            trainValSplit: split,
            durationMs: Date.now() - startMs,
        };
    }

    // ─── Parallel Batch Runner ──────────────────────────────────────────────

    private async runBatchParallel(
        jobs: BacktestJob[],
        symbol: string,
        timeframe: string,
        candles: CandleBar[],
        minTrades: number,
        layerPrefix: string,
    ): Promise<TfVariantResult[]> {
        const results: TfVariantResult[] = [];
        const total = jobs.length;

        for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
            const batch = jobs.slice(batchStart, batchStart + BATCH_SIZE);

            const batchResults = await Promise.allSettled(
                batch.map(async (job) => {
                    const tmpCode = `${layerPrefix}_${job.index}`.slice(0, 60).toUpperCase();
                    try {
                        const metrics = await this.runBacktest(job.def, job.execParams, tmpCode, symbol, timeframe, candles);
                        if (metrics && metrics.trades >= minTrades) {
                            return {
                                variantId: job.variantId,
                                variantLabel: job.variantLabel,
                                params: job.params,
                                trainMetrics: metrics,
                            } as TfVariantResult;
                        }
                    } catch {
                        // Variant caused plugin error — skip silently
                    }
                    return null;
                }),
            );

            let batchFails = 0;
            for (const r of batchResults) {
                if (r.status === 'fulfilled' && r.value) {
                    results.push(r.value);
                } else if (r.status === 'rejected') {
                    batchFails++;
                }
            }

            const done = Math.min(batchStart + BATCH_SIZE, total);
            const failStr = batchFails > 0 ? ` (${batchFails} errors)` : '';
            console.log(`  Progress: ${done}/${total} (${results.length} valid)${failStr}`);
        }

        return results;
    }

    // ─── Layer Sweeps ────────────────────────────────────────────────────────

    private async sweepEntryLayer(
        baseDef: ComposedSignalDefinition,
        variants: EntryVariant[],
        symbol: string,
        timeframe: string,
        candles: CandleBar[],
        minTrades: number,
        topN: number,
    ): Promise<LayerSweepResult> {
        const startMs = Date.now();

        const jobs: BacktestJob[] = variants.map((variant, i) => {
            const def = JSON.parse(JSON.stringify(baseDef)) as ComposedSignalDefinition;
            variant.mutate(def);
            return {
                index: i,
                variantId: variant.id,
                variantLabel: variant.label,
                def,
                execParams: {},
                params: { entryVariantId: variant.id },
            };
        });

        const allResults = await this.runBatchParallel(jobs, symbol, timeframe, candles, minTrades, `TF_L1_${timeframe}`);

        // Filter out variants with dangerous streak or DD before ranking
        const MAX_STREAK_FILTER = 15;
        const MAX_DD_FILTER = 15;
        const safe = allResults.filter((r) =>
            r.trainMetrics.maxConsecutiveLosses <= MAX_STREAK_FILTER &&
            r.trainMetrics.equityCurveMaxDdPct <= MAX_DD_FILTER,
        );
        const results = safe.length > 0 ? safe : allResults;

        if (safe.length < allResults.length) {
            console.log(`  Safety filter: ${allResults.length - safe.length} variant(s) removed (streak>${MAX_STREAK_FILTER} or DD>${MAX_DD_FILTER}%)`);
        }

        // Rank by PF descending, then streak ascending as tiebreaker
        results.sort((a, b) => {
            const pfDiff = (b.trainMetrics.profitFactor ?? 0) - (a.trainMetrics.profitFactor ?? 0);
            if (Math.abs(pfDiff) > 0.01) return pfDiff;
            return a.trainMetrics.maxConsecutiveLosses - b.trainMetrics.maxConsecutiveLosses;
        });

        const topResults = results.slice(0, topN);
        for (let i = 0; i < topResults.length; i++) {
            const r = topResults[i];
            console.log(`  #${i + 1}  ${r.variantLabel.padEnd(35)} PF=${(r.trainMetrics.profitFactor ?? 0).toFixed(2)}  trades=${r.trainMetrics.trades}  WR=${r.trainMetrics.winRate.toFixed(0)}%  streak=${r.trainMetrics.maxConsecutiveLosses}  DD=${r.trainMetrics.equityCurveMaxDdPct.toFixed(1)}%`);
        }

        return {
            layer: 'entry',
            variants: results,
            winner: results[0] ?? this.emptyResult('entry'),
            totalBacktests: variants.length,
            durationMs: Date.now() - startMs,
        };
    }

    private async sweepGuardLayer(
        baseDef: ComposedSignalDefinition,
        variants: GuardVariant[],
        symbol: string,
        timeframe: string,
        candles: CandleBar[],
        minTrades: number,
        topN: number,
    ): Promise<LayerSweepResult> {
        const startMs = Date.now();

        const jobs: BacktestJob[] = variants.map((variant, i) => ({
            index: i,
            variantId: variant.id,
            variantLabel: variant.label,
            def: JSON.parse(JSON.stringify(baseDef)) as ComposedSignalDefinition,
            execParams: variant.guards,
            params: variant.guards,
        }));

        const results = await this.runBatchParallel(jobs, symbol, timeframe, candles, minTrades, `TF_L2_${timeframe}`);

        // Filter out unprofitable variants (PF < 1.0)
        const profitable = results.filter((r) => (r.trainMetrics.profitFactor ?? 0) >= 1.0);
        const ranked = profitable.length > 0 ? profitable : results;

        // Rank: streak ascending, then PF descending for same streak
        ranked.sort((a, b) => {
            const streakDiff = a.trainMetrics.maxConsecutiveLosses - b.trainMetrics.maxConsecutiveLosses;
            if (streakDiff !== 0) return streakDiff;
            return (b.trainMetrics.profitFactor ?? 0) - (a.trainMetrics.profitFactor ?? 0);
        });

        if (profitable.length < results.length) {
            console.log(`  Filtered: ${results.length - profitable.length} variant(s) with PF < 1.0`);
        }

        const topResults = ranked.slice(0, topN);
        for (let i = 0; i < topResults.length; i++) {
            const r = topResults[i];
            console.log(`  #${i + 1}  ${r.variantLabel.padEnd(35)} streak=${r.trainMetrics.maxConsecutiveLosses}  PF=${(r.trainMetrics.profitFactor ?? 0).toFixed(2)}  trades=${r.trainMetrics.trades}  WR=${r.trainMetrics.winRate.toFixed(0)}%`);
        }

        return {
            layer: 'guards',
            variants: ranked,
            winner: ranked[0] ?? this.emptyResult('guards'),
            totalBacktests: variants.length,
            durationMs: Date.now() - startMs,
        };
    }

    private async sweepExitLayer(
        baseDef: ComposedSignalDefinition,
        guardConfig: Record<string, unknown>,
        variants: ExitVariant[],
        symbol: string,
        timeframe: string,
        candles: CandleBar[],
        minTrades: number,
        topN: number,
    ): Promise<LayerSweepResult> {
        const startMs = Date.now();

        const jobs: BacktestJob[] = variants.map((variant, i) => {
            const def = JSON.parse(JSON.stringify(baseDef)) as ComposedSignalDefinition;
            (def as unknown as Record<string, unknown>).exitManagement = { profileCode: variant.profileCode };

            const execConfig: Record<string, unknown> = {
                ...guardConfig,
                exitStrategy: variant.profileCode,
            };
            if (variant.maxBarsInTrade !== undefined) {
                execConfig.maxBarsInTrade = variant.maxBarsInTrade;
            }

            return {
                index: i,
                variantId: variant.id,
                variantLabel: variant.label,
                def,
                execParams: execConfig,
                params: { profileCode: variant.profileCode, maxBarsInTrade: variant.maxBarsInTrade },
            };
        });

        const results = await this.runBatchParallel(jobs, symbol, timeframe, candles, minTrades, `TF_L3_${timeframe}`);

        // Rank by PF descending
        results.sort((a, b) => (b.trainMetrics.profitFactor ?? 0) - (a.trainMetrics.profitFactor ?? 0));

        const topResults = results.slice(0, topN);
        for (let i = 0; i < topResults.length; i++) {
            const r = topResults[i];
            console.log(`  #${i + 1}  ${r.variantLabel.padEnd(35)} PF=${(r.trainMetrics.profitFactor ?? 0).toFixed(2)}  trades=${r.trainMetrics.trades}  WR=${r.trainMetrics.winRate.toFixed(0)}%`);
        }

        return {
            layer: 'exit',
            variants: results,
            winner: results[0] ?? this.emptyResult('exit'),
            totalBacktests: variants.length,
            durationMs: Date.now() - startMs,
        };
    }

    // ─── Backtest Runner ─────────────────────────────────────────────────────

    private async runBacktest(
        def: ComposedSignalDefinition,
        executionParams: Record<string, unknown>,
        tmpCode: string,
        symbol: string,
        timeframe: string,
        candles: CandleBar[],
    ): Promise<SweepMetrics | null> {
        if (candles.length === 0) return null;

        const from = candles[0].time;
        const to = candles[candles.length - 1].time;

        const blockRegistry = createDefaultBlockRegistry();
        const plugin = new ComposedSignalPlugin(def, blockRegistry, tmpCode, 1, tmpCode);

        const indicatorService = new IndicatorSeriesService();
        const executionModel = new ExecutionModelService();

        const runner = new SignalBacktestRunner(
            this.candleQuery,
            indicatorService,
            executionModel,
            this.registry,
        );

        this.registry.register(plugin);

        try {
            const executionConfig: ExecutionConfigInput = {};
            if (executionParams.tradeGuards || executionParams.lossStreakThrottle || executionParams.lossStreakCooldown) {
                executionConfig.tradeGuards = executionParams as ExecutionConfigInput['tradeGuards'];
            } else if (Object.keys(executionParams).length > 0) {
                executionConfig.tradeGuards = executionParams as ExecutionConfigInput['tradeGuards'];
            }

            const output = await runner.run({
                signalCode: tmpCode,
                signalVersion: 1,
                symbol,
                timeframe,
                from,
                to,
                parameters: {},
                initialEquity: 10000,
                executionConfig: Object.keys(executionConfig).length > 0 ? executionConfig : undefined,
            });

            if (!output || output.results.length === 0) return null;

            const closedResults = output.results.filter((r) => !r.isOpen);
            if (closedResults.length === 0) return null;

            const riskSummary = this.riskService.summarize({
                initialEquity: 10000,
                results: output.results,
                signals: output.signals,
                events: output.events,
                traces: output.traces,
            });

            // Compute basic metrics
            let grossWin = 0, grossLoss = 0, wins = 0;
            for (const r of closedResults) {
                if (r.rMultiple > 0) { grossWin += r.rMultiple; wins++; }
                else if (r.rMultiple < 0) grossLoss += Math.abs(r.rMultiple);
            }

            const netR = closedResults.reduce((s, r) => s + r.rMultiple, 0);
            const netPnl = closedResults.reduce((s, r) => s + r.pnlUsd, 0);
            const pf = grossLoss === 0 ? (grossWin > 0 ? 999 : null) : grossWin / grossLoss;

            return {
                trades: closedResults.length,
                netPnl,
                netR,
                winRate: (wins / closedResults.length) * 100,
                maxDd: riskSummary.equityCurveMaxDdPct,
                profitFactor: pf ? Number(pf.toFixed(2)) : null,
                maxConsecutiveLosses: riskSummary.maxConsecutiveLosses,
                maxConsecutiveLosingDays: riskSummary.maxConsecutiveLosingDays,
                equityCurveMaxDdPct: riskSummary.equityCurveMaxDdPct,
                avgRPerTrade: riskSummary.avgRPerTrade,
                medianRPerTrade: riskSummary.medianRPerTrade,
                blockedEntryCount: riskSummary.blockedEntryCount,
                guardActivationCount: riskSummary.guardActivationCount,
                equityCurveFilterBlockCount: riskSummary.equityCurveFilterBlockCount,
            };
        } finally {
            this.registry.unregister(tmpCode, 1);
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private loadBaseSeed(signalCode: string): ComposedSignalDefinition | null {
        const seeds = getTier1ComposedSignalSeeds();
        const seed = seeds.find((s) => s.code === signalCode);
        return seed?.composedBlocks ?? null;
    }

    private async detectDateRange(symbol: string, timeframe: string): Promise<{ from: Date; to: Date }> {
        const symbolAliases = getMarketSymbolAliases(symbol);
        const tfAliases = getTimeframeAliases(timeframe);

        const earliest = await this.prisma.candle.findFirst({
            where: { symbol: { in: symbolAliases }, timeframe: { in: tfAliases } },
            orderBy: { time: 'asc' },
            select: { time: true },
        });
        const latest = await this.prisma.candle.findFirst({
            where: { symbol: { in: symbolAliases }, timeframe: { in: tfAliases } },
            orderBy: { time: 'desc' },
            select: { time: true },
        });
        if (!earliest || !latest) throw new Error(`No candle data for ${symbol} ${timeframe} (aliases: ${symbolAliases.join(',')} / ${tfAliases.join(',')})`);
        return { from: earliest.time, to: latest.time };
    }

    private emptyResult(layer: string): TfVariantResult {
        return {
            variantId: 'NONE',
            variantLabel: `No valid ${layer} variant found`,
            params: {},
            trainMetrics: {
                trades: 0, netPnl: 0, netR: 0, winRate: 0, maxDd: 0,
                profitFactor: null, maxConsecutiveLosses: 0, maxConsecutiveLosingDays: 0,
                equityCurveMaxDdPct: 0, avgRPerTrade: 0, medianRPerTrade: 0,
                blockedEntryCount: 0, guardActivationCount: 0, equityCurveFilterBlockCount: 0,
            },
        };
    }
}
