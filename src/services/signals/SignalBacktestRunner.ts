import { CandleQueryService } from './CandleQueryService';
import { ExecutionModelService } from './ExecutionModelService';
import { IndicatorSeriesService } from './IndicatorSeriesService';
import { SignalRegistry } from './SignalRegistry';
import { normalizeSymbol } from '../../utils/symbols';
import {
    CandleBar,
    SignalInitializationContext,
    SignalRunOutput,
    SignalRunRequest,
    SignalRuntimeServices,
} from './types';

export class SignalBacktestRunner {
    private runtimeServices: SignalRuntimeServices;

    constructor(
        private candleQuery: CandleQueryService,
        private indicatorSeries: IndicatorSeriesService,
        private executionModel: ExecutionModelService,
        private registry: SignalRegistry,
    ) {
        this.runtimeServices = {
            indicatorSeries: {
                calculateSMAFromCandles: this.indicatorSeries.calculateSMAFromCandles.bind(this.indicatorSeries),
                calculateSMA: this.indicatorSeries.calculateSMA.bind(this.indicatorSeries),
                calculateRSIFromCandles: this.indicatorSeries.calculateRSIFromCandles.bind(this.indicatorSeries),
                calculateRSI: this.indicatorSeries.calculateRSI.bind(this.indicatorSeries),
                calculateEMAFromCandles: this.indicatorSeries.calculateEMAFromCandles.bind(this.indicatorSeries),
                calculateEMA: this.indicatorSeries.calculateEMA.bind(this.indicatorSeries),
                calculateWMA: this.indicatorSeries.calculateWMA.bind(this.indicatorSeries),
                getPointAtOrBefore: this.indicatorSeries.getPointAtOrBefore.bind(this.indicatorSeries),
                alignPointsToBars: this.indicatorSeries.alignPointsToBars.bind(this.indicatorSeries),
                calculateATR: this.indicatorSeries.calculateATR.bind(this.indicatorSeries),
                calculateADX: this.indicatorSeries.calculateADX.bind(this.indicatorSeries),
            },
            executionModel: {
                resolveConfig: this.executionModel.resolveConfig.bind(this.executionModel),
                getEntryFill: this.executionModel.getEntryFill.bind(this.executionModel),
                getExitFill: this.executionModel.getExitFill.bind(this.executionModel),
                resolvePositionSizing: this.executionModel.resolvePositionSizing.bind(this.executionModel),
                resolveStopLoss: this.executionModel.resolveStopLoss.bind(this.executionModel),
                resolveTakeProfit: this.executionModel.resolveTakeProfit.bind(this.executionModel),
                calculateNetPnl: this.executionModel.calculateNetPnl.bind(this.executionModel),
                calculateNetR: this.executionModel.calculateNetR.bind(this.executionModel),
            },
        };
    }

    public async run<TParams = Record<string, unknown>>(request: SignalRunRequest<TParams>): Promise<SignalRunOutput> {
        const plugin = this.registry.get<TParams>(request.signalCode, request.signalVersion);
        if (!plugin) {
            throw new Error(`Signal plugin ${request.signalCode}@${request.signalVersion} is not registered`);
        }

        const requiredTimeframes = Array.from(new Set([
            request.timeframe,
            ...(plugin.getRequiredTimeframes ? plugin.getRequiredTimeframes(request.parameters, request.timeframe) : []),
        ]));

        const barsByTimeframe = await this.candleQuery.getCandlesByTimeframes({
            symbol: request.symbol,
            timeframes: requiredTimeframes,
            from: request.from,
            to: request.to,
        });

        const baseBars = barsByTimeframe[request.timeframe] || [];
        if (baseBars.length === 0) {
            return {
                barsProcessed: 0,
                signals: [],
                events: [],
                traces: [],
                results: [],
            };
        }

        const initializationContext: SignalInitializationContext<TParams> = {
            symbol: normalizeSymbol(request.symbol),
            timeframe: request.timeframe,
            baseBars,
            barsByTimeframe,
            parameters: request.parameters,
            initialEquity: request.initialEquity ?? 10_000,
            riskPercent: request.riskPercent ?? 1,
            executionConfig: this.executionModel.resolveConfig(request.executionConfig),
            services: this.runtimeServices,
        };

        let state = await plugin.initialize(initializationContext);
        const output: SignalRunOutput = {
            barsProcessed: baseBars.length,
            signals: [],
            events: [],
            traces: [],
            results: [],
        };

        for (let index = 0; index < baseBars.length; index += 1) {
            const bar: CandleBar = baseBars[index];
            const step = await plugin.onBar({
                ...initializationContext,
                index,
                bar,
                state,
            });

            if (!step) {
                continue;
            }

            state = step.state;
            if (step.signal) {
                output.signals.push(step.signal);
            }
            if (step.events?.length) {
                output.events.push(...step.events);
            }
            if (step.traces?.length) {
                output.traces.push(...step.traces);
            }
            if (step.results?.length) {
                output.results.push(...step.results);
            }
        }

        if (plugin.finalize) {
            const finalized = await plugin.finalize({
                ...initializationContext,
                finalState: state,
                output,
            });

            if (finalized?.signals?.length) {
                output.signals.push(...finalized.signals);
            }
            if (finalized?.events?.length) {
                output.events.push(...finalized.events);
            }
            if (finalized?.traces?.length) {
                output.traces.push(...finalized.traces);
            }
            if (finalized?.results?.length) {
                output.results.push(...finalized.results);
            }
        }

        return output;
    }
}
