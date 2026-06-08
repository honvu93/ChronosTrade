import { PrismaClient } from '@prisma/client';
import { SignalRegistry } from './SignalRegistry';
import { CandleQueryService } from './CandleQueryService';
import { ExecutionModelService } from './ExecutionModelService';
import { IndicatorSeriesService } from './IndicatorSeriesService';
import { SignalAnnotationSerializer } from './SignalAnnotationSerializer';
import { SignalBacktestRunner } from './SignalBacktestRunner';
import { LogicTraceSerializer } from './LogicTraceSerializer';
import { createDefaultBlockRegistry } from './blocks/createDefaultBlockRegistry';
import { validateComposedSignalDefinition } from './composedSignalValidation';
import { ComposedSignalDefinition, ComposedSignalPlugin } from './ComposedSignalPlugin';
import { SignalBatchPlannerService } from './SignalBatchPlannerService';
import {
    SignalBatchPreviewInput,
    SignalBatchPreviewItem,
    SignalBatchPreviewOutput,
    SignalRunRequest,
} from './types';

const clampConcurrency = (value: number | undefined) => {
    if (!value || !Number.isFinite(value)) return 2;
    return Math.max(1, Math.min(Math.trunc(value), 8));
};

export class SignalPlatformService {
    private readonly prisma: PrismaClient;
    private readonly candleQuery: CandleQueryService;
    private readonly indicatorSeries: IndicatorSeriesService;
    private readonly executionModel: ExecutionModelService;
    private readonly registry = SignalRegistry.getInstance();
    private readonly blockRegistry = createDefaultBlockRegistry();
    private readonly annotationSerializer: SignalAnnotationSerializer;
    private readonly traceSerializer: LogicTraceSerializer;
    private readonly runner: SignalBacktestRunner;
    private readonly batchPlanner: SignalBatchPlannerService;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.candleQuery = new CandleQueryService(prisma);
        this.indicatorSeries = new IndicatorSeriesService();
        this.executionModel = new ExecutionModelService();
        this.annotationSerializer = new SignalAnnotationSerializer();
        this.traceSerializer = new LogicTraceSerializer();
        this.batchPlanner = new SignalBatchPlannerService();
        this.runner = new SignalBacktestRunner(
            this.candleQuery,
            this.indicatorSeries,
            this.executionModel,
            this.registry,
        );
    }

    public async runPreview<TParams = Record<string, unknown>>(request: SignalRunRequest<TParams>) {
        await this.ensureDefinitionLoaded(request.signalCode, request.signalVersion);
        return this.runner.run(request);
    }

    public async runPreviewBatch(input: SignalBatchPreviewInput): Promise<SignalBatchPreviewOutput> {
        const tasks = this.batchPlanner.expand(input);
        const maxConcurrency = clampConcurrency(input.maxConcurrency);
        const items: SignalBatchPreviewItem[] = new Array(tasks.length);
        let cursor = 0;

        const worker = async () => {
            while (cursor < tasks.length) {
                const index = cursor;
                cursor += 1;
                const task = tasks[index];
                const startedAt = Date.now();

                try {
                    const output = await this.runner.run(task);
                    items[index] = {
                        requestKey: task.requestKey,
                        signalCode: task.signalCode,
                        signalVersion: task.signalVersion,
                        symbol: task.symbol,
                        timeframe: task.timeframe,
                        from: task.from.toISOString(),
                        to: task.to.toISOString(),
                        status: 'SUCCEEDED',
                        durationMs: Date.now() - startedAt,
                        counts: {
                            barsProcessed: output.barsProcessed,
                            signals: output.signals.length,
                            events: output.events.length,
                            traces: output.traces.length,
                            results: output.results.length,
                        },
                    };
                } catch (error: any) {
                    items[index] = {
                        requestKey: task.requestKey,
                        signalCode: task.signalCode,
                        signalVersion: task.signalVersion,
                        symbol: task.symbol,
                        timeframe: task.timeframe,
                        from: task.from.toISOString(),
                        to: task.to.toISOString(),
                        status: 'FAILED',
                        durationMs: Date.now() - startedAt,
                        counts: {
                            barsProcessed: 0,
                            signals: 0,
                            events: 0,
                            traces: 0,
                            results: 0,
                        },
                        error: error.message,
                    };
                }
            }
        };

        await Promise.all(Array.from(
            { length: Math.min(maxConcurrency, tasks.length) },
            () => worker(),
        ));

        return {
            total: items.length,
            succeeded: items.filter((item) => item.status === 'SUCCEEDED').length,
            failed: items.filter((item) => item.status === 'FAILED').length,
            maxConcurrency,
            items,
        };
    }

    public getRegistryDefinitions() {
        return this.registry.list();
    }

    public getIndicatorSeriesService() {
        return this.indicatorSeries;
    }

    public getExecutionModelService() {
        return this.executionModel;
    }

    public getAnnotationSerializer() {
        return this.annotationSerializer;
    }

    public getTraceSerializer() {
        return this.traceSerializer;
    }

    private async ensureDefinitionLoaded(signalCode: string, signalVersion: number) {
        if (this.registry.get(signalCode, signalVersion)) {
            return;
        }

        const definition = await this.prisma.signalDefinition.findUnique({
            where: {
                code_version: {
                    code: signalCode.trim().toUpperCase(),
                    version: signalVersion,
                },
            },
            select: {
                code: true,
                version: true,
                name: true,
                isActive: true,
                isComposed: true,
                composedBlocks: true,
            },
        });

        if (!definition || !definition.isActive || !definition.isComposed || !definition.composedBlocks) {
            return;
        }

        const composedDef = definition.composedBlocks as unknown as ComposedSignalDefinition;
        const issues = validateComposedSignalDefinition(composedDef, this.blockRegistry);
        if (issues.length > 0) {
            throw new Error(`Signal definition ${definition.code}@${definition.version} failed composed-signal validation.`);
        }

        this.registry.register(new ComposedSignalPlugin(
            composedDef,
            this.blockRegistry,
            definition.code,
            definition.version,
            definition.name,
        ));
    }
}
