import { PrismaClient } from '@prisma/client';
import {
    AccountReadinessState,
} from './TradingAccountReadinessService';
import { TradingAccountService } from './TradingAccountService';

export type SignalVersionOriginKind =
    | 'signal-definition'
    | 'backtest-run'
    | 'indicator-instance';

export interface SignalVersionLookupInput {
    code: string;
    version: number;
    backtestRunId?: string | null;
    indicatorInstanceId?: string | null;
    actorUserId?: string | null;
}

export interface SignalVersionAccountContext {
    readinessState: AccountReadinessState;
    accountId: string | null;
    accountLabel: string | null;
    mt5Login: string | null;
    mt5Server: string | null;
}

export interface SignalVersionSnapshot {
    signalCode: string;
    signalVersion: number;
    signalName: string;
    category: string | null;
    description: string | null;
    parameterSchema: Record<string, unknown>;
    indicatorSchema: Record<string, unknown> | null;
    eventSchema: Record<string, unknown> | null;
    composedBlocks: Record<string, unknown> | null;
    isComposed: boolean;
    createdBy: string | null;
    createdAt: string;
    originKind: SignalVersionOriginKind;
    originRecordId: string | null;
    originRecordLabel: string | null;
    originStatus: string | null;
    originSymbol: string | null;
    originTimeframe: string | null;
    parameterValuesJson: Record<string, unknown> | null;
    linkedBacktestRunId: string | null;
    linkedBacktestName: string | null;
    linkedBacktestStatus: string | null;
    linkedBacktestSymbol: string | null;
    linkedBacktestTimeframe: string | null;
    executionConfigJson: Record<string, unknown> | null;
    accountContext: SignalVersionAccountContext | null;
}

export class SignalVersionService {
    constructor(
        private prisma: PrismaClient,
        private env: Record<string, string | undefined> = process.env,
        private readonly tradingAccountService: Pick<TradingAccountService, 'getReadinessSnapshotForUser'> = new TradingAccountService(prisma, env),
    ) {}

    private async findPreferredBacktestRun(code: string, version: number) {
        const completedRun = await this.prisma.backtestRun.findFirst({
            where: { signalCode: code, signalVersion: version, status: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
        });

        return completedRun ?? await this.prisma.backtestRun.findFirst({
            where: { signalCode: code, signalVersion: version },
            orderBy: { createdAt: 'desc' },
        });
    }

    public async getSnapshot(input: SignalVersionLookupInput): Promise<SignalVersionSnapshot | null> {
        const code = input.code;
        const version = input.version;

        const def = await this.prisma.signalDefinition.findUnique({
            where: { code_version: { code, version } },
        });

        if (!def) return null;

        if (input.backtestRunId && input.indicatorInstanceId) {
            return null;
        }

        let originKind: SignalVersionOriginKind = 'signal-definition';
        let originRecordId: string | null = null;
        let originRecordLabel: string | null = def.name;
        let originStatus: string | null = null;
        let originSymbol: string | null = null;
        let originTimeframe: string | null = null;
        let parameterValuesJson: Record<string, unknown> | null = null;
        let executionConfigJson: Record<string, unknown> | null = null;
        let linkedRun: Awaited<ReturnType<SignalVersionService['findPreferredBacktestRun']>> | null = null;
        let accountContext: SignalVersionAccountContext | null = null;

        if (input.indicatorInstanceId) {
            const indicatorInstance = await this.prisma.indicatorInstance.findFirst({
                where: {
                    id: input.indicatorInstanceId,
                    signalCode: code,
                    signalVersion: version,
                },
                select: {
                    id: true,
                    name: true,
                    status: true,
                    sourceBacktestRunId: true,
                    signalCode: true,
                    signalVersion: true,
                    symbol: true,
                    timeframe: true,
                    parameterJson: true,
                    executionConfigJson: true,
                },
            });

            if (!indicatorInstance) {
                return null;
            }

            originKind = 'indicator-instance';
            originRecordId = indicatorInstance.id;
            originRecordLabel = indicatorInstance.name;
            originStatus = indicatorInstance.status;
            originSymbol = indicatorInstance.symbol;
            originTimeframe = indicatorInstance.timeframe;
            parameterValuesJson = indicatorInstance.parameterJson as Record<string, unknown>;
            executionConfigJson = (indicatorInstance.executionConfigJson ?? null) as Record<string, unknown> | null;

            if (indicatorInstance.sourceBacktestRunId) {
                linkedRun = await this.prisma.backtestRun.findFirst({
                    where: {
                        id: indicatorInstance.sourceBacktestRunId,
                        signalCode: code,
                        signalVersion: version,
                    },
                });
            } else {
                linkedRun = await this.findPreferredBacktestRun(code, version);
                const readiness = await this.tradingAccountService.getReadinessSnapshotForUser(
                    input.actorUserId ?? null,
                );
                accountContext = {
                    readinessState: readiness.state,
                    accountId: readiness.accountId,
                    accountLabel: readiness.accountLabel,
                    mt5Login: readiness.mt5Login,
                    mt5Server: readiness.mt5Server,
                };
            }
        } else if (input.backtestRunId) {
            linkedRun = await this.prisma.backtestRun.findFirst({
                where: {
                    id: input.backtestRunId,
                    signalCode: code,
                    signalVersion: version,
                },
            });

            if (!linkedRun) {
                return null;
            }

            originKind = 'backtest-run';
            originRecordId = linkedRun.id;
            originRecordLabel = linkedRun.name;
            originStatus = linkedRun.status;
            originSymbol = linkedRun.symbol;
            originTimeframe = linkedRun.timeframe;
            parameterValuesJson = (linkedRun.parametersJson ?? null) as Record<string, unknown> | null;
            executionConfigJson = (linkedRun.executionConfigJson ?? null) as Record<string, unknown> | null;
        } else {
            linkedRun = await this.findPreferredBacktestRun(code, version);

            if (linkedRun) {
                originKind = 'backtest-run';
                originRecordId = linkedRun.id;
                originRecordLabel = linkedRun.name;
                originStatus = linkedRun.status;
                originSymbol = linkedRun.symbol;
                originTimeframe = linkedRun.timeframe;
                parameterValuesJson = (linkedRun.parametersJson ?? null) as Record<string, unknown> | null;
                executionConfigJson = (linkedRun.executionConfigJson ?? null) as Record<string, unknown> | null;
            }
        }

        return {
            signalCode: def.code,
            signalVersion: def.version,
            signalName: def.name,
            category: def.category ?? null,
            description: def.description ?? null,
            parameterSchema: def.parameterSchema as Record<string, unknown>,
            indicatorSchema: (def.indicatorSchema ?? null) as Record<string, unknown> | null,
            eventSchema: (def.eventSchema ?? null) as Record<string, unknown> | null,
            composedBlocks: (def.composedBlocks ?? null) as Record<string, unknown> | null,
            isComposed: def.isComposed,
            createdBy: def.createdBy ?? null,
            createdAt: def.createdAt.toISOString(),
            originKind,
            originRecordId,
            originRecordLabel,
            originStatus,
            originSymbol,
            originTimeframe,
            parameterValuesJson,
            linkedBacktestRunId: linkedRun?.id ?? null,
            linkedBacktestName: linkedRun?.name ?? null,
            linkedBacktestStatus: linkedRun?.status ?? null,
            linkedBacktestSymbol: linkedRun?.symbol ?? null,
            linkedBacktestTimeframe: linkedRun?.timeframe ?? null,
            executionConfigJson,
            accountContext,
        };
    }
}
