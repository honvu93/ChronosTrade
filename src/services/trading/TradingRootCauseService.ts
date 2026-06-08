import {
    Prisma,
    PrismaClient,
} from '@prisma/client';
import {
    DomainFailureItem,
    FailureClassificationService,
} from './FailureClassificationService';
import {
    SignalBlockingReason,
    SignalLiveEligibilityItem,
    SignalLiveEligibilityService,
} from './SignalLiveEligibilityService';
import { AccountReadinessSnapshot } from './TradingAccountReadinessService';
import {
    TradingDiscrepancyInsight,
    TradingDiscrepancyService,
    TradingDiscrepancySnapshot,
} from './TradingDiscrepancyService';
import { TradingAccountService } from './TradingAccountService';
import {
    createTradingWebhookDeliveryService,
    TradingWebhookDeliveryService,
} from './TradingWebhookDeliveryService';

export type TradingRootCauseCategory =
    | 'data-quality'
    | 'signal-logic'
    | 'risk-settings'
    | 'broker-execution';

export type TradingInvestigationOutcome = 'resolved' | 'mitigated' | 'escalated';
export type TradingDiagnosisEvidenceSeverity = 'critical' | 'warning' | 'info';
export type TradingDiagnosisConfidence = 'high' | 'medium' | 'low';
export type TradingDiagnosisSectionKey =
    | 'differences'
    | 'backtest'
    | 'live'
    | 'timeline'
    | 'account'
    | 'history';

export interface TradingDiagnosisLookupInput {
    code: string;
    version: number;
    backtestRunId?: string | null;
    indicatorInstanceId?: string | null;
    tradeRecordId?: string | null;
    actorUserId?: string | null;
}

export interface TradingDiagnosisEvidence {
    id: string;
    source: 'failure-classification' | 'discrepancy' | 'eligibility' | 'account-readiness';
    severity: TradingDiagnosisEvidenceSeverity;
    title: string;
    detail: string;
    linkedRecordLabel: string;
    linkedRecordId: string | null;
    sectionKey: TradingDiagnosisSectionKey;
    href: string | null;
}

export interface TradingDiagnosisCategoryAssessment {
    category: TradingRootCauseCategory;
    label: string;
    score: number;
    confidence: TradingDiagnosisConfidence;
    severity: TradingDiagnosisEvidenceSeverity;
    summary: string;
    evidence: TradingDiagnosisEvidence[];
}

export interface TradingDiagnosisLinkedRecords {
    signalKey: string;
    backtestRunId: string | null;
    tradeRecordId: string | null;
    signalId: string | null;
    primaryIndicatorInstanceId: string | null;
    reportPath: string | null;
}

export interface TradingInvestigationDecisionContext {
    selectedCategory: TradingRootCauseCategory;
    selectedOutcome: TradingInvestigationOutcome;
    investigationKind: TradingDiscrepancySnapshot['investigationKind'];
    linkedRecords: TradingDiagnosisLinkedRecords;
    score: number;
    confidence: TradingDiagnosisConfidence;
    evidence: TradingDiagnosisEvidence[];
}

export interface TradingInvestigationOutcomeRecord {
    id: string;
    signalCode: string;
    signalVersion: number;
    rootCauseCategory: TradingRootCauseCategory;
    outcome: TradingInvestigationOutcome;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
    summary: string | null;
    decidedAt: string;
    decisionContext: TradingInvestigationDecisionContext | null;
}

export interface TradingDiagnosisSnapshot {
    signalCode: string;
    signalVersion: number;
    signalName: string | null;
    investigationKind: TradingDiscrepancySnapshot['investigationKind'];
    primaryCategory: TradingRootCauseCategory | null;
    categories: TradingDiagnosisCategoryAssessment[];
    linkedRecords: TradingDiagnosisLinkedRecords;
    latestOutcome: TradingInvestigationOutcomeRecord | null;
    history: TradingInvestigationOutcomeRecord[];
    evaluatedAt: string;
}

export interface RecordTradingInvestigationOutcomeInput extends TradingDiagnosisLookupInput {
    rootCauseCategory: TradingRootCauseCategory;
    outcome: TradingInvestigationOutcome;
    summary?: string | null;
}

type OutcomeHistoryRow = {
    id: string;
    signalCode: string;
    signalVersion: number;
    rootCause: 'DATA_QUALITY' | 'SIGNAL_LOGIC' | 'RISK_SETTINGS' | 'BROKER_EXECUTION';
    outcome: 'RESOLVED' | 'MITIGATED' | 'ESCALATED';
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
    summary: string | null;
    evidenceJson: unknown | null;
    createdAt: Date;
};

type InvestigationOutcomeStore = {
    findMany: (args: {
        where: Prisma.InputJsonValue | Record<string, unknown>;
        orderBy: { createdAt: 'desc' | 'asc' };
        take: number;
        select: Record<string, boolean>;
    }) => Promise<OutcomeHistoryRow[]>;
    create: (args: {
        data: Record<string, unknown>;
        select: Record<string, boolean>;
    }) => Promise<OutcomeHistoryRow>;
};

type CategoryBucket = {
    score: number;
    evidence: TradingDiagnosisEvidence[];
};

type DiagnosisContext = {
    discrepancy: TradingDiscrepancySnapshot;
    symbol: string | null;
    timeframe: string | null;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
};

const CATEGORY_LABELS: Record<TradingRootCauseCategory, string> = {
    'data-quality': 'Data Quality',
    'signal-logic': 'Signal Logic',
    'risk-settings': 'Risk Settings',
    'broker-execution': 'Broker Execution',
};

const CATEGORY_ORDER: TradingRootCauseCategory[] = [
    'data-quality',
    'signal-logic',
    'risk-settings',
    'broker-execution',
];

const SEVERITY_WEIGHT: Record<TradingDiagnosisEvidenceSeverity, number> = {
    critical: 3,
    warning: 2,
    info: 1,
};

const RISK_ELIGIBILITY_CODES = new Set([
    'drawdown_below_live',
    'excessive_drawdown',
    'open_positions',
]);

const SIGNAL_LOGIC_ELIGIBILITY_CODES = new Set([
    'net_negative',
    'profit_factor_too_low',
    'profit_factor_below_live',
    'sample_below_live_threshold',
    'insufficient_trades',
    'no_results',
    'backtest_incomplete',
]);

const BROKER_HINT_PATTERN = /(broker|bridge|mt5|reject|rejected|timeout|execution|order|position|ticket)/i;
const STALE_WARNING_MS = 4 * 60 * 60 * 1000;
const STALE_CRITICAL_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 6;

const severityForDomainFailure = (severity: DomainFailureItem['severity']): TradingDiagnosisEvidenceSeverity =>
    severity === 'critical'
        ? 'critical'
        : severity === 'warning'
            ? 'warning'
            : 'info';

const severityForDiscrepancy = (severity: TradingDiscrepancyInsight['severity']): TradingDiagnosisEvidenceSeverity =>
    severity === 'critical'
        ? 'critical'
        : severity === 'warning'
            ? 'warning'
            : 'info';

const weightForFailureSeverity = (severity: DomainFailureItem['severity']) =>
    severity === 'critical' ? 95 : severity === 'warning' ? 60 : 20;

const ageLabel = (ageMs: number) => `${Math.floor(ageMs / 3_600_000)}h`;

const INVESTIGATION_KINDS = new Set<TradingDiscrepancySnapshot['investigationKind']>([
    'alert-driven',
    'reported-issue',
    'mixed-context',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isCategory(value: unknown): value is TradingRootCauseCategory {
    return typeof value === 'string' && CATEGORY_ORDER.includes(value as TradingRootCauseCategory);
}

function isOutcome(value: unknown): value is TradingInvestigationOutcome {
    return value === 'resolved' || value === 'mitigated' || value === 'escalated';
}

function isConfidence(value: unknown): value is TradingDiagnosisConfidence {
    return value === 'high' || value === 'medium' || value === 'low';
}

function isInvestigationKind(value: unknown): value is TradingDiscrepancySnapshot['investigationKind'] {
    return typeof value === 'string' && INVESTIGATION_KINDS.has(value as TradingDiscrepancySnapshot['investigationKind']);
}

function sanitizeLinkedRecords(value: unknown): TradingDiagnosisLinkedRecords | null {
    if (!isRecord(value) || typeof value.signalKey !== 'string') {
        return null;
    }

    return {
        signalKey: value.signalKey,
        backtestRunId: typeof value.backtestRunId === 'string' ? value.backtestRunId : null,
        tradeRecordId: typeof value.tradeRecordId === 'string' ? value.tradeRecordId : null,
        signalId: typeof value.signalId === 'string' ? value.signalId : null,
        primaryIndicatorInstanceId: typeof value.primaryIndicatorInstanceId === 'string'
            ? value.primaryIndicatorInstanceId
            : null,
        reportPath: typeof value.reportPath === 'string' ? value.reportPath : null,
    };
}

function sanitizeEvidenceItem(value: unknown): TradingDiagnosisEvidence | null {
    if (
        !isRecord(value)
        || typeof value.id !== 'string'
        || typeof value.title !== 'string'
        || typeof value.detail !== 'string'
        || typeof value.linkedRecordLabel !== 'string'
        || typeof value.source !== 'string'
        || typeof value.severity !== 'string'
        || typeof value.sectionKey !== 'string'
    ) {
        return null;
    }

    const validSource = value.source === 'failure-classification'
        || value.source === 'discrepancy'
        || value.source === 'eligibility'
        || value.source === 'account-readiness';
    const validSeverity = value.severity === 'critical'
        || value.severity === 'warning'
        || value.severity === 'info';
    const validSectionKey = value.sectionKey === 'differences'
        || value.sectionKey === 'backtest'
        || value.sectionKey === 'live'
        || value.sectionKey === 'timeline'
        || value.sectionKey === 'account'
        || value.sectionKey === 'history';

    if (!validSource || !validSeverity || !validSectionKey) {
        return null;
    }

    return {
        id: value.id,
        source: value.source as TradingDiagnosisEvidence['source'],
        severity: value.severity as TradingDiagnosisEvidenceSeverity,
        title: value.title,
        detail: value.detail,
        linkedRecordLabel: value.linkedRecordLabel,
        linkedRecordId: typeof value.linkedRecordId === 'string' ? value.linkedRecordId : null,
        sectionKey: value.sectionKey as TradingDiagnosisSectionKey,
        href: typeof value.href === 'string' ? value.href : null,
    };
}

function sanitizeDecisionContext(value: unknown): TradingInvestigationDecisionContext | null {
    if (!isRecord(value)) {
        return null;
    }

    const linkedRecords = sanitizeLinkedRecords(value.linkedRecords);
    const evidence = Array.isArray(value.evidence)
        ? value.evidence.map((item) => sanitizeEvidenceItem(item)).filter((item): item is TradingDiagnosisEvidence => item !== null)
        : [];

    if (
        !isCategory(value.selectedCategory)
        || !isOutcome(value.selectedOutcome)
        || !isInvestigationKind(value.investigationKind)
        || !linkedRecords
        || typeof value.score !== 'number'
        || !Number.isFinite(value.score)
        || !isConfidence(value.confidence)
    ) {
        return null;
    }

    return {
        selectedCategory: value.selectedCategory,
        selectedOutcome: value.selectedOutcome,
        investigationKind: value.investigationKind,
        linkedRecords,
        score: value.score,
        confidence: value.confidence,
        evidence,
    };
}

function buildOutcomeRecord(row: OutcomeHistoryRow): TradingInvestigationOutcomeRecord {
    return {
        id: row.id,
        signalCode: row.signalCode,
        signalVersion: row.signalVersion,
        rootCauseCategory: mapPrismaRootCause(row.rootCause),
        outcome: mapPrismaOutcome(row.outcome),
        backtestRunId: row.backtestRunId,
        indicatorInstanceId: row.indicatorInstanceId,
        tradeRecordId: row.tradeRecordId,
        summary: row.summary,
        decidedAt: row.createdAt.toISOString(),
        decisionContext: sanitizeDecisionContext(row.evidenceJson),
    };
}

function mapPrismaRootCause(
    rootCause: OutcomeHistoryRow['rootCause'],
): TradingRootCauseCategory {
    switch (rootCause) {
        case 'DATA_QUALITY':
            return 'data-quality';
        case 'SIGNAL_LOGIC':
            return 'signal-logic';
        case 'RISK_SETTINGS':
            return 'risk-settings';
        case 'BROKER_EXECUTION':
        default:
            return 'broker-execution';
    }
}

function mapRootCauseToPrisma(rootCause: TradingRootCauseCategory): OutcomeHistoryRow['rootCause'] {
    switch (rootCause) {
        case 'data-quality':
            return 'DATA_QUALITY';
        case 'signal-logic':
            return 'SIGNAL_LOGIC';
        case 'risk-settings':
            return 'RISK_SETTINGS';
        case 'broker-execution':
        default:
            return 'BROKER_EXECUTION';
    }
}

function mapPrismaOutcome(
    outcome: OutcomeHistoryRow['outcome'],
): TradingInvestigationOutcome {
    switch (outcome) {
        case 'RESOLVED':
            return 'resolved';
        case 'MITIGATED':
            return 'mitigated';
        case 'ESCALATED':
        default:
            return 'escalated';
    }
}

function mapOutcomeToPrisma(outcome: TradingInvestigationOutcome): OutcomeHistoryRow['outcome'] {
    switch (outcome) {
        case 'resolved':
            return 'RESOLVED';
        case 'mitigated':
            return 'MITIGATED';
        case 'escalated':
        default:
            return 'ESCALATED';
    }
}

function createBuckets(): Record<TradingRootCauseCategory, CategoryBucket> {
    return {
        'data-quality': { score: 0, evidence: [] },
        'signal-logic': { score: 0, evidence: [] },
        'risk-settings': { score: 0, evidence: [] },
        'broker-execution': { score: 0, evidence: [] },
    };
}

export class TradingRootCauseService {
    constructor(
        private prisma: PrismaClient,
        private discrepancyService: Pick<TradingDiscrepancyService, 'getSnapshot'> = new TradingDiscrepancyService(prisma),
        private failureService: Pick<FailureClassificationService, 'classify'> = new FailureClassificationService(prisma),
        private eligibilityService: Pick<SignalLiveEligibilityService, 'listEligibility'> = new SignalLiveEligibilityService(prisma),
        private env: Record<string, string | undefined> = process.env,
        private webhookDeliveryService: Pick<TradingWebhookDeliveryService, 'deliverConfiguredOutputs'> = createTradingWebhookDeliveryService(prisma),
        private readonly tradingAccountService: Pick<TradingAccountService, 'getReadinessSnapshotForUser'> = new TradingAccountService(prisma, env),
    ) {}

    private get outcomeStore(): InvestigationOutcomeStore {
        return (this.prisma as unknown as {
            tradingInvestigationOutcomeRecord: InvestigationOutcomeStore;
        }).tradingInvestigationOutcomeRecord;
    }

    public async diagnose(input: TradingDiagnosisLookupInput): Promise<TradingDiagnosisSnapshot | null> {
        const discrepancy = await this.discrepancyService.getSnapshot(input);
        if (!discrepancy) {
            return null;
        }

        const context = this.buildContext(input, discrepancy);
        const [failureSnapshot, eligibilityItems, historyRows] = await Promise.all([
            this.failureService.classify(),
            this.eligibilityService.listEligibility(),
            this.loadHistory(context),
        ]);

        const relevantFailures = this.filterRelevantFailureItems(failureSnapshot, context);
        const eligibility = this.findEligibilityItem(eligibilityItems, context);
        const accountReadiness = await this.tradingAccountService.getReadinessSnapshotForUser(
            input.actorUserId ?? null,
        );
        const categories = this.buildAssessments(context, relevantFailures, eligibility, accountReadiness);
        const primaryCategory = this.pickPrimaryCategory(categories);
        const history = historyRows.map((row) => buildOutcomeRecord(row));

        return {
            signalCode: discrepancy.signalCode,
            signalVersion: discrepancy.signalVersion,
            signalName: discrepancy.signalName,
            investigationKind: discrepancy.investigationKind,
            primaryCategory,
            categories,
            linkedRecords: {
                signalKey: discrepancy.linkedRecords.signalKey,
                backtestRunId: context.backtestRunId,
                tradeRecordId: context.tradeRecordId,
                signalId: discrepancy.linkedRecords.signalId,
                primaryIndicatorInstanceId: context.indicatorInstanceId,
                reportPath: discrepancy.linkedRecords.reportPath,
            },
            latestOutcome: history[0] ?? null,
            history,
            evaluatedAt: new Date().toISOString(),
        };
    }

    public async recordOutcome(
        input: RecordTradingInvestigationOutcomeInput,
    ): Promise<TradingInvestigationOutcomeRecord | null> {
        const diagnosis = await this.diagnose(input);
        if (!diagnosis) {
            return null;
        }

        const selectedCategory = diagnosis.categories.find((category) => category.category === input.rootCauseCategory);
        if (!selectedCategory) {
            return null;
        }

        const row = await this.outcomeStore.create({
            data: {
                signalCode: diagnosis.signalCode,
                signalVersion: diagnosis.signalVersion,
                rootCause: mapRootCauseToPrisma(input.rootCauseCategory),
                outcome: mapOutcomeToPrisma(input.outcome),
                backtestRunId: diagnosis.linkedRecords.backtestRunId,
                indicatorInstanceId: diagnosis.linkedRecords.primaryIndicatorInstanceId,
                tradeRecordId: diagnosis.linkedRecords.tradeRecordId,
                summary: input.summary?.trim() || selectedCategory.summary,
                evidenceJson: {
                    selectedCategory: input.rootCauseCategory,
                    selectedOutcome: input.outcome,
                    investigationKind: diagnosis.investigationKind,
                    linkedRecords: diagnosis.linkedRecords,
                    score: selectedCategory.score,
                    confidence: selectedCategory.confidence,
                    evidence: selectedCategory.evidence,
                } as unknown as Prisma.InputJsonValue,
            },
            select: {
                id: true,
                signalCode: true,
                signalVersion: true,
                rootCause: true,
                outcome: true,
                backtestRunId: true,
                indicatorInstanceId: true,
                tradeRecordId: true,
                summary: true,
                evidenceJson: true,
                createdAt: true,
            },
        });

        await this.dispatchWebhookOutputs({
            backtestRunId: diagnosis.linkedRecords.backtestRunId,
            indicatorInstanceId: diagnosis.linkedRecords.primaryIndicatorInstanceId,
            deliveries: [{
                contractKind: 'investigation-outcome',
                limit: 1,
            }],
        });

        return buildOutcomeRecord(row);
    }

    private async dispatchWebhookOutputs(input: {
        backtestRunId: string | null;
        indicatorInstanceId: string | null;
        deliveries: Array<{
            contractKind: 'investigation-outcome';
            limit: number;
        }>;
    }) {
        try {
            await this.webhookDeliveryService.deliverConfiguredOutputs(input);
        } catch {
            // Delivery failures must not block investigation recording.
        }
    }

    private buildContext(
        input: TradingDiagnosisLookupInput,
        discrepancy: TradingDiscrepancySnapshot,
    ): DiagnosisContext {
        const primaryDeployment = discrepancy.live.deployments[0] ?? null;
        const backtest = discrepancy.backtest;

        return {
            discrepancy,
            symbol: backtest?.symbol ?? primaryDeployment?.symbol ?? null,
            timeframe: backtest?.timeframe ?? primaryDeployment?.timeframe ?? null,
            backtestRunId: backtest?.runId ?? input.backtestRunId ?? null,
            indicatorInstanceId: discrepancy.live.primaryIndicatorInstanceId ?? input.indicatorInstanceId ?? null,
            tradeRecordId: backtest?.tradeIssue?.recordId ?? input.tradeRecordId ?? null,
        };
    }

    private async loadHistory(context: DiagnosisContext): Promise<OutcomeHistoryRow[]> {
        const where: Record<string, unknown> = {
            signalCode: context.discrepancy.signalCode,
            signalVersion: context.discrepancy.signalVersion,
        };

        if (context.tradeRecordId) {
            where.tradeRecordId = context.tradeRecordId;
        } else if (context.indicatorInstanceId) {
            where.indicatorInstanceId = context.indicatorInstanceId;
        } else if (context.backtestRunId) {
            where.backtestRunId = context.backtestRunId;
        }

        return this.outcomeStore.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: HISTORY_LIMIT,
            select: {
                id: true,
                signalCode: true,
                signalVersion: true,
                rootCause: true,
                outcome: true,
                backtestRunId: true,
                indicatorInstanceId: true,
                tradeRecordId: true,
                summary: true,
                evidenceJson: true,
                createdAt: true,
            },
        });
    }

    private filterRelevantFailureItems(
        failureSnapshot: Awaited<ReturnType<FailureClassificationService['classify']>>,
        context: DiagnosisContext,
    ): DomainFailureItem[] {
        const items = Object.values(failureSnapshot.domains).flatMap((domainStatus) => domainStatus.items);

        return items.filter((item) => {
            const matchesSignal = item.signalCode === context.discrepancy.signalCode
                && (
                    item.signalVersion === null
                    || item.signalVersion === undefined
                    || item.signalVersion === context.discrepancy.signalVersion
                );

            const matchesBacktest = Boolean(
                context.backtestRunId
                && item.backtestRunId
                && item.backtestRunId === context.backtestRunId,
            );
            const matchesIndicator = Boolean(
                context.indicatorInstanceId
                && item.indicatorInstanceId
                && item.indicatorInstanceId === context.indicatorInstanceId,
            );
            const matchesMarket = Boolean(
                context.symbol
                && context.timeframe
                && item.symbol === context.symbol
                && item.timeframe === context.timeframe,
            );

            return matchesSignal || matchesBacktest || matchesIndicator || matchesMarket;
        });
    }

    private findEligibilityItem(
        items: SignalLiveEligibilityItem[],
        context: DiagnosisContext,
    ): SignalLiveEligibilityItem | null {
        return items.find((item) =>
            item.signalCode === context.discrepancy.signalCode
            && item.signalVersion === context.discrepancy.signalVersion
            && (
                !context.backtestRunId
                || item.backtestRunId === null
                || item.backtestRunId === context.backtestRunId
            ),
        ) ?? null;
    }

    private buildAssessments(
        context: DiagnosisContext,
        relevantFailures: DomainFailureItem[],
        eligibility: SignalLiveEligibilityItem | null,
        accountReadiness: AccountReadinessSnapshot,
    ): TradingDiagnosisCategoryAssessment[] {
        const buckets = createBuckets();

        for (const item of relevantFailures) {
            const severity = severityForDomainFailure(item.severity);
            const weight = weightForFailureSeverity(item.severity);
            const evidence: TradingDiagnosisEvidence = {
                id: `failure:${item.id}`,
                source: 'failure-classification',
                severity,
                title: item.title,
                detail: item.detail,
                linkedRecordLabel: item.indicatorInstanceId
                    ? `Deployment ${item.indicatorInstanceId}`
                    : item.backtestRunId
                        ? `Backtest ${item.backtestRunId}`
                        : item.symbol && item.timeframe
                            ? `${item.symbol} ${item.timeframe}`
                            : context.discrepancy.linkedRecords.signalKey,
                linkedRecordId: item.indicatorInstanceId ?? item.backtestRunId ?? item.id,
                sectionKey: item.domain === 'ingestion' ? 'live' : 'timeline',
                href: null,
            };

            switch (item.domain) {
                case 'ingestion':
                    this.pushEvidence(buckets['data-quality'], evidence, weight);
                    break;
                case 'signal':
                case 'alert':
                    this.pushEvidence(buckets['signal-logic'], evidence, weight);
                    break;
                case 'trading':
                default:
                    this.pushEvidence(
                        BROKER_HINT_PATTERN.test(`${item.title} ${item.detail}`)
                            ? buckets['broker-execution']
                            : buckets['signal-logic'],
                        evidence,
                        weight,
                    );
                    break;
            }
        }

        for (const insight of context.discrepancy.discrepancies) {
            this.addDiscrepancyEvidence(buckets, context, insight);
        }

        this.addFreshnessEvidence(buckets, context);
        this.addEligibilityEvidence(buckets, context, eligibility);
        this.addAccountReadinessEvidence(buckets, accountReadiness, context);

        return CATEGORY_ORDER.map((category) => this.finalizeAssessment(category, buckets[category]));
    }

    private addDiscrepancyEvidence(
        buckets: Record<TradingRootCauseCategory, CategoryBucket>,
        context: DiagnosisContext,
        insight: TradingDiscrepancyInsight,
    ) {
        const severity = severityForDiscrepancy(insight.severity);
        const evidence: TradingDiagnosisEvidence = {
            id: `discrepancy:${insight.code}`,
            source: 'discrepancy',
            severity,
            title: insight.title,
            detail: insight.detail,
            linkedRecordLabel: context.discrepancy.linkedRecords.primaryIndicatorInstanceId
                ? `Deployment ${context.discrepancy.linkedRecords.primaryIndicatorInstanceId}`
                : context.discrepancy.linkedRecords.signalKey,
            linkedRecordId: context.discrepancy.linkedRecords.primaryIndicatorInstanceId,
            sectionKey: insight.code === 'parameter-drift' || insight.code === 'execution-config-drift' || insight.code === 'market-context-drift'
                ? 'differences'
                : insight.code === 'missing-live-deployment'
                    ? 'history'
                    : 'live',
            href: context.discrepancy.linkedRecords.reportPath ?? null,
        };

        switch (insight.code) {
            case 'activity-gap':
                this.pushEvidence(buckets['data-quality'], evidence, 45);
                return;
            case 'outcome-drift':
            case 'missing-source-link':
                this.pushEvidence(buckets['signal-logic'], evidence, 65);
                return;
            case 'parameter-drift':
                this.pushEvidence(buckets['risk-settings'], evidence, 60);
                return;
            case 'execution-config-drift':
                this.pushEvidence(buckets['risk-settings'], evidence, 75);
                return;
            case 'market-context-drift':
                this.pushEvidence(buckets['risk-settings'], evidence, 50);
                return;
            case 'missing-live-deployment':
                this.pushEvidence(buckets['broker-execution'], evidence, 55);
                return;
            case 'live-status-failed':
                this.pushEvidence(
                    BROKER_HINT_PATTERN.test(`${insight.title} ${insight.detail} ${insight.liveValue ?? ''}`)
                        ? buckets['broker-execution']
                        : buckets['signal-logic'],
                    evidence,
                    severity === 'critical' ? 90 : 70,
                );
                return;
            default:
                return;
        }
    }

    private addFreshnessEvidence(
        buckets: Record<TradingRootCauseCategory, CategoryBucket>,
        context: DiagnosisContext,
    ) {
        const primaryDeployment = context.discrepancy.live.deployments[0] ?? null;
        if (!primaryDeployment?.lastProcessedCandleTime) {
            return;
        }

        const ageMs = Date.now() - new Date(primaryDeployment.lastProcessedCandleTime).getTime();
        if (ageMs <= STALE_WARNING_MS) {
            return;
        }

        const severity: TradingDiagnosisEvidenceSeverity = ageMs > STALE_CRITICAL_MS ? 'critical' : 'warning';
        this.pushEvidence(buckets['data-quality'], {
            id: `freshness:${primaryDeployment.indicatorInstanceId}`,
            source: 'discrepancy',
            severity,
            title: 'Live deployment is processing stale market context.',
            detail: `The deployment last processed a candle ${ageLabel(ageMs)} ago, which weakens confidence in live conclusions.`,
            linkedRecordLabel: `Deployment ${primaryDeployment.indicatorInstanceId}`,
            linkedRecordId: primaryDeployment.indicatorInstanceId,
            sectionKey: 'live',
            href: null,
        }, severity === 'critical' ? 85 : 55);
    }

    private addEligibilityEvidence(
        buckets: Record<TradingRootCauseCategory, CategoryBucket>,
        context: DiagnosisContext,
        eligibility: SignalLiveEligibilityItem | null,
    ) {
        if (!eligibility) {
            return;
        }

        for (const reason of eligibility.blockingReasons) {
            const evidence: TradingDiagnosisEvidence = {
                id: `eligibility:${reason.code}`,
                source: 'eligibility',
                severity: reason.code === 'excessive_drawdown' ? 'critical' : 'warning',
                title: `Validation gate: ${reason.code}`,
                detail: reason.label,
                linkedRecordLabel: eligibility.backtestRunId
                    ? `Backtest ${eligibility.backtestRunId}`
                    : context.discrepancy.linkedRecords.signalKey,
                linkedRecordId: eligibility.backtestRunId,
                sectionKey: 'backtest',
                href: context.discrepancy.linkedRecords.reportPath ?? null,
            };

            if (RISK_ELIGIBILITY_CODES.has(reason.code)) {
                this.pushEvidence(
                    buckets['risk-settings'],
                    evidence,
                    reason.code === 'excessive_drawdown' ? 80 : 55,
                );
                continue;
            }

            if (SIGNAL_LOGIC_ELIGIBILITY_CODES.has(reason.code)) {
                this.pushEvidence(buckets['signal-logic'], evidence, 45);
            }
        }
    }

    private addAccountReadinessEvidence(
        buckets: Record<TradingRootCauseCategory, CategoryBucket>,
        accountReadiness: AccountReadinessSnapshot,
        context: DiagnosisContext,
    ) {
        if (accountReadiness.state === 'ready') {
            return;
        }

        const severity: TradingDiagnosisEvidenceSeverity = accountReadiness.state === 'bridge-unreachable'
            ? 'critical'
            : 'warning';

        this.pushEvidence(buckets['broker-execution'], {
            id: `account:${accountReadiness.state}`,
            source: 'account-readiness',
            severity,
            title: 'Broker execution readiness is degraded.',
            detail: accountReadiness.blockingReasons.join(' ') || 'Broker execution prerequisites are not currently satisfied.',
            linkedRecordLabel: context.discrepancy.linkedRecords.primaryIndicatorInstanceId
                ? `Deployment ${context.discrepancy.linkedRecords.primaryIndicatorInstanceId}`
                : context.discrepancy.linkedRecords.signalKey,
            linkedRecordId: context.discrepancy.linkedRecords.primaryIndicatorInstanceId,
            sectionKey: 'account',
            href: null,
        }, severity === 'critical' ? 90 : 60);
    }

    private finalizeAssessment(
        category: TradingRootCauseCategory,
        bucket: CategoryBucket,
    ): TradingDiagnosisCategoryAssessment {
        const evidence = [...bucket.evidence].sort((left, right) => {
            const severityDiff = SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity];
            if (severityDiff !== 0) {
                return severityDiff;
            }

            return left.title.localeCompare(right.title);
        });

        const severity = evidence[0]?.severity ?? 'info';
        const confidence: TradingDiagnosisConfidence = bucket.score >= 120 || severity === 'critical'
            ? 'high'
            : bucket.score >= 60
                ? 'medium'
                : 'low';
        const summary = evidence.length === 0
            ? `No linked investigation evidence currently points to ${CATEGORY_LABELS[category]}.`
            : evidence.length === 1
                ? evidence[0].detail
                : `${evidence[0].detail} ${evidence.length - 1} additional evidence link${evidence.length - 1 === 1 ? '' : 's'} support this diagnosis.`;

        return {
            category,
            label: CATEGORY_LABELS[category],
            score: bucket.score,
            confidence,
            severity,
            summary,
            evidence,
        };
    }

    private pickPrimaryCategory(
        categories: TradingDiagnosisCategoryAssessment[],
    ): TradingRootCauseCategory | null {
        const scored = categories
            .filter((category) => category.evidence.length > 0)
            .sort((left, right) => {
                if (right.score !== left.score) {
                    return right.score - left.score;
                }

                const severityDiff = SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity];
                if (severityDiff !== 0) {
                    return severityDiff;
                }

                return right.evidence.length - left.evidence.length;
            });

        return scored[0]?.category ?? null;
    }

    private pushEvidence(
        bucket: CategoryBucket,
        evidence: TradingDiagnosisEvidence,
        weight: number,
    ) {
        if (bucket.evidence.some((item) => item.id === evidence.id)) {
            return;
        }

        bucket.evidence.push(evidence);
        bucket.score += weight;
    }
}
