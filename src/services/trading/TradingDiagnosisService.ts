import { PrismaClient } from '@prisma/client';
import {
    TradingAuditService,
    TradeHistoryAuditSnapshot,
    TradeHistoryAuditDetailSnapshot,
} from './TradingAuditService';
import {
    TradingDiscrepancyService,
    TradingDiscrepancySnapshot,
    TradingDiscrepancyLookupInput,
} from './TradingDiscrepancyService';
import {
    TradingRootCauseService,
    TradingDiagnosisSnapshot,
    TradingDiagnosisLookupInput,
    RecordTradingInvestigationOutcomeInput,
} from './TradingRootCauseService';
import { TradingAccountService } from './TradingAccountService';

export type {
    TradeHistoryAuditSnapshot,
    TradeHistoryAuditDetailSnapshot,
    TradingDiscrepancySnapshot,
    TradingDiscrepancyLookupInput,
    TradingDiagnosisSnapshot,
    TradingDiagnosisLookupInput,
    RecordTradingInvestigationOutcomeInput,
};

export { TradingRootCauseCategory, TradingInvestigationOutcome } from './TradingRootCauseService';

/**
 * Unified facade over the three diagnosis-layer services:
 * - TradingAuditService    (trade history & timeline)
 * - TradingDiscrepancyService (backtest-vs-live comparison)
 * - TradingRootCauseService   (root cause analysis & investigation)
 *
 * API surface is identical — consolidation is structural, not behavioural.
 */
export class TradingDiagnosisService {
    private readonly audit: TradingAuditService;
    private readonly discrepancy: TradingDiscrepancyService;
    private readonly rootCause: TradingRootCauseService;

    constructor(
        prisma: PrismaClient,
        env?: Record<string, string | undefined>,
        tradingAccountService?: TradingAccountService,
    ) {
        this.audit = new TradingAuditService(prisma);
        this.discrepancy = new TradingDiscrepancyService(prisma);
        this.rootCause = new TradingRootCauseService(
            prisma,
            undefined,
            undefined,
            undefined,
            env,
            undefined,
            tradingAccountService,
        );
    }

    // ── Audit layer ────────────────────────────────────────────

    public async listHistory(options?: { limit?: number }): Promise<TradeHistoryAuditSnapshot> {
        return this.audit.listHistory(options);
    }

    public async getHistoryDetail(recordId: string): Promise<TradeHistoryAuditDetailSnapshot | null> {
        return this.audit.getHistoryDetail(recordId);
    }

    // ── Discrepancy layer ──────────────────────────────────────

    public async getDiscrepancy(input: TradingDiscrepancyLookupInput): Promise<TradingDiscrepancySnapshot | null> {
        return this.discrepancy.getSnapshot(input);
    }

    // ── Diagnosis layer ────────────────────────────────────────

    public async diagnose(input: TradingDiagnosisLookupInput): Promise<TradingDiagnosisSnapshot | null> {
        return this.rootCause.diagnose(input);
    }

    public async recordOutcome(input: RecordTradingInvestigationOutcomeInput) {
        return this.rootCause.recordOutcome(input);
    }
}
