import { OptimizationJobStatus, Prisma, PrismaClient } from '@prisma/client';
import { CreateOptimizationJobInput } from './types';
import { SignalDefinitionService } from './SignalDefinitionService';
import { ExecutionModelService } from './ExecutionModelService';
import { normalizeSymbol } from '../../utils/symbols';

export class SignalOptimizationService {
    private definitions: SignalDefinitionService;
    private executionModel: ExecutionModelService;

    constructor(private prisma: PrismaClient) {
        this.definitions = new SignalDefinitionService(prisma);
        this.executionModel = new ExecutionModelService();
    }

    public async createJob(input: CreateOptimizationJobInput) {
        const signalCode = input.signalCode.trim().toUpperCase();
        const definition = await this.definitions.getDefinition(signalCode, input.signalVersion);

        if (!definition || !definition.isActive) {
            throw new Error(`Signal definition ${signalCode}@${input.signalVersion} is not available`);
        }

        const from = new Date(input.dateRange.from);
        const to = new Date(input.dateRange.to);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
            throw new Error('Invalid dateRange');
        }

        const resolvedExecutionConfig = this.executionModel.resolveConfig(input.executionConfig);

        if (!input.parameterSpace || Object.keys(input.parameterSpace).length === 0) {
            throw new Error('parameterSpace is required');
        }

        const created = await this.prisma.signalOptimizationJob.create({
            data: {
                signalCode,
                signalVersion: input.signalVersion,
                symbol: normalizeSymbol(input.symbol),
                timeframe: input.timeframe,
                startedAt: from,
                finishedAt: to,
                executionConfigJson: resolvedExecutionConfig as unknown as Prisma.InputJsonValue,
                parameterSpaceJson: input.parameterSpace as Prisma.InputJsonValue,
                rankingConfigJson: (input.rankingConfig ?? {
                    primaryMetric: 'NET_R',
                    sortProfile: 'DEFAULT_GUARDED',
                }) as Prisma.InputJsonValue,
                status: OptimizationJobStatus.PENDING,
            },
        });

        return {
            id: created.id,
            signalCode: created.signalCode,
            signalVersion: created.signalVersion,
            status: created.status,
            createdAt: created.createdAt,
        };
    }

    public async listJobs(filters: {
        signalCode?: string;
        signalVersion?: number;
        status?: OptimizationJobStatus;
    }) {
        const jobs = await this.prisma.signalOptimizationJob.findMany({
            where: {
                ...(filters.signalCode ? { signalCode: filters.signalCode.toUpperCase() } : {}),
                ...(filters.signalVersion !== undefined ? { signalVersion: filters.signalVersion } : {}),
                ...(filters.status ? { status: filters.status } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });

        return jobs.map((job) => ({
            id: job.id,
            signalCode: job.signalCode,
            signalVersion: job.signalVersion,
            symbol: job.symbol,
            timeframe: job.timeframe,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            status: job.status,
            parameterSpaceJson: job.parameterSpaceJson,
            rankingConfigJson: job.rankingConfigJson,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        }));
    }

    public async getJob(id: string) {
        const job = await this.prisma.signalOptimizationJob.findUnique({
            where: { id },
            include: {
                runs: {
                    include: {
                        backtestRun: true,
                    },
                    orderBy: [
                        { rankOrder: 'asc' },
                        { createdAt: 'asc' },
                    ],
                },
            },
        });

        if (!job) {
            return null;
        }

        return {
            id: job.id,
            signalCode: job.signalCode,
            signalVersion: job.signalVersion,
            symbol: job.symbol,
            timeframe: job.timeframe,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            executionConfigJson: job.executionConfigJson,
            parameterSpaceJson: job.parameterSpaceJson,
            rankingConfigJson: job.rankingConfigJson,
            status: job.status,
            errorMessage: job.errorMessage,
            runs: job.runs.map((run) => ({
                id: run.id,
                backtestRunId: run.backtestRunId,
                parameterSetJson: run.parameterSetJson,
                rankingScore: run.rankingScore ? Number(run.rankingScore) : null,
                rankOrder: run.rankOrder,
                runStatus: run.backtestRun.status,
                runName: run.backtestRun.name,
                createdAt: run.createdAt,
            })),
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        };
    }
}
