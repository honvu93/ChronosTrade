import { PrismaClient } from '@prisma/client';

export type FailureDomain = 'ingestion' | 'signal' | 'alert' | 'trading';
export type FailureSeverity = 'critical' | 'warning' | 'ok';

export interface DomainFailureItem {
    id: string;
    domain: FailureDomain;
    severity: FailureSeverity;
    title: string;
    detail: string;
    detectedAt: string;
    signalCode?: string | null;
    signalVersion?: number | null;
    backtestRunId?: string | null;
    indicatorInstanceId?: string | null;
    symbol?: string | null;
    timeframe?: string | null;
}

export interface DomainStatus {
    severity: FailureSeverity;
    items: DomainFailureItem[];
}

export interface FailureClassificationSnapshot {
    domains: Record<FailureDomain, DomainStatus>;
    totalCritical: number;
    totalWarning: number;
    evaluatedAt: string;
}

const STALE_WARNING_MS = 4 * 60 * 60 * 1000;
const STALE_CRITICAL_MS = 24 * 60 * 60 * 1000;

function ok(): DomainStatus {
    return { severity: 'ok', items: [] };
}

function worstSeverity(items: DomainFailureItem[]): FailureSeverity {
    if (items.some((item) => item.severity === 'critical')) return 'critical';
    if (items.some((item) => item.severity === 'warning')) return 'warning';
    return 'ok';
}

export class FailureClassificationService {
    constructor(private prisma: PrismaClient) {}

    public async classify(): Promise<FailureClassificationSnapshot> {
        const [ingestion, signal, alert, trading] = await Promise.all([
            this.checkIngestion().catch(() => ok()),
            this.checkSignal().catch(() => ok()),
            this.checkAlert().catch(() => ok()),
            this.checkTrading().catch(() => ok()),
        ]);

        const allItems = [
            ...ingestion.items,
            ...signal.items,
            ...alert.items,
            ...trading.items,
        ];

        return {
            domains: { ingestion, signal, alert, trading },
            totalCritical: allItems.filter((item) => item.severity === 'critical').length,
            totalWarning: allItems.filter((item) => item.severity === 'warning').length,
            evaluatedAt: new Date().toISOString(),
        };
    }

    // -----------------------------------------------------------------------
    // Domain: ingestion - price_candles freshness per symbol/timeframe
    // -----------------------------------------------------------------------
    private async checkIngestion(): Promise<DomainStatus> {
        const groups = await this.prisma.candle.groupBy({
            by: ['symbol', 'timeframe'],
            _max: { time: true },
        });

        const now = Date.now();
        const items: DomainFailureItem[] = [];

        for (const row of groups) {
            const lastTime = row._max.time;
            if (!lastTime) continue;

            const ageMs = now - lastTime.getTime();

            if (ageMs > STALE_CRITICAL_MS) {
                items.push({
                    id: `ingestion-${row.symbol}-${row.timeframe}`,
                    domain: 'ingestion',
                    severity: 'critical',
                    title: `${row.symbol} ${row.timeframe} - data feed stopped`,
                    detail: `Last candle received ${Math.floor(ageMs / 3_600_000)}h ago. Ingestion appears dead.`,
                    detectedAt: lastTime.toISOString(),
                });
            } else if (ageMs > STALE_WARNING_MS) {
                items.push({
                    id: `ingestion-${row.symbol}-${row.timeframe}`,
                    domain: 'ingestion',
                    severity: 'warning',
                    title: `${row.symbol} ${row.timeframe} - data delay`,
                    detail: `Last candle received ${Math.floor(ageMs / 3_600_000)}h ago. Feed may be delayed.`,
                    detectedAt: lastTime.toISOString(),
                });
            }
        }

        return { severity: worstSeverity(items), items };
    }

    // -----------------------------------------------------------------------
    // Domain: signal - IndicatorInstance failures (backtest-linked instances)
    // -----------------------------------------------------------------------
    private async checkSignal(): Promise<DomainStatus> {
        const instances = await this.prisma.indicatorInstance.findMany({
            where: {
                status: { in: ['FAILED', 'PAUSED'] },
                sourceBacktestRunId: { not: null },
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
                updatedAt: true,
                errorMessage: true,
            },
        });

        const items: DomainFailureItem[] = instances.map((instance) => ({
            id: `signal-${instance.id}`,
            domain: 'signal',
            severity: instance.status === 'FAILED' ? 'critical' : 'warning',
            title: `Signal indicator ${instance.status.toLowerCase()}: ${instance.name}`,
            detail: instance.errorMessage
                ? `Signal ${instance.signalCode}: ${instance.errorMessage}`
                : `Signal ${instance.signalCode} indicator entered ${instance.status} state.`,
            detectedAt: instance.updatedAt.toISOString(),
            signalCode: instance.signalCode,
            signalVersion: instance.signalVersion,
            backtestRunId: instance.sourceBacktestRunId,
            indicatorInstanceId: instance.id,
            symbol: instance.symbol,
            timeframe: instance.timeframe,
        }));

        return { severity: worstSeverity(items), items };
    }

    // -----------------------------------------------------------------------
    // Domain: alert - BacktestRun failures in the last 24 h (alert re-eval proxy)
    // -----------------------------------------------------------------------
    private async checkAlert(): Promise<DomainStatus> {
        const cutoff = new Date(Date.now() - STALE_CRITICAL_MS);

        const failedRuns = await this.prisma.backtestRun.findMany({
            where: { status: 'FAILED', createdAt: { gte: cutoff } },
            select: {
                id: true,
                name: true,
                signalCode: true,
                signalVersion: true,
                symbol: true,
                timeframe: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        const items: DomainFailureItem[] = failedRuns.map((run) => ({
            id: `alert-${run.id}`,
            domain: 'alert',
            severity: 'warning',
            title: `Backtest run failed: ${run.name}`,
            detail: `${run.symbol} ${run.timeframe} run failed in the last 24h - alert re-evaluation affected.`,
            detectedAt: run.createdAt.toISOString(),
            signalCode: run.signalCode ?? null,
            signalVersion: run.signalVersion ?? null,
            backtestRunId: run.id,
            symbol: run.symbol,
            timeframe: run.timeframe,
        }));

        return { severity: worstSeverity(items), items };
    }

    // -----------------------------------------------------------------------
    // Domain: trading - live IndicatorInstance failures (sourceBacktestRunId IS NULL)
    // -----------------------------------------------------------------------
    private async checkTrading(): Promise<DomainStatus> {
        const liveInstances = await this.prisma.indicatorInstance.findMany({
            where: {
                status: { in: ['FAILED', 'PAUSED'] },
                sourceBacktestRunId: null,
            },
            select: {
                id: true,
                name: true,
                status: true,
                signalCode: true,
                signalVersion: true,
                symbol: true,
                timeframe: true,
                updatedAt: true,
                errorMessage: true,
            },
        });

        const items: DomainFailureItem[] = liveInstances.map((instance) => ({
            id: `trading-${instance.id}`,
            domain: 'trading',
            severity: instance.status === 'FAILED' ? 'critical' : 'warning',
            title: `Live indicator ${instance.status.toLowerCase()}: ${instance.name}`,
            detail: instance.errorMessage
                ? `Live signal ${instance.signalCode}: ${instance.errorMessage}`
                : `Live signal ${instance.signalCode} indicator entered ${instance.status} state.`,
            detectedAt: instance.updatedAt.toISOString(),
            signalCode: instance.signalCode,
            signalVersion: instance.signalVersion,
            indicatorInstanceId: instance.id,
            symbol: instance.symbol,
            timeframe: instance.timeframe,
        }));

        return { severity: worstSeverity(items), items };
    }
}
