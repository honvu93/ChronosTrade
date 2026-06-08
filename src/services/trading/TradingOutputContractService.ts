export type TradingOutputContractKind =
    | 'signal-event'
    | 'execution-event'
    | 'trade-outcome'
    | 'investigation-outcome';

export type TradingExecutionEventKind = 'command' | 'decision';
export type TradingTradeOutcomeResult = 'ACTIVE' | 'WIN' | 'LOSS' | 'BE';
export type TradingInvestigationRootCauseCategory =
    | 'data-quality'
    | 'signal-logic'
    | 'risk-settings'
    | 'broker-execution';
export type TradingInvestigationOutcome = 'resolved' | 'mitigated' | 'escalated';

export interface TradingOutputEnvelope<T = unknown> {
    contractKind: TradingOutputContractKind;
    contractVersion: number;
    recordId: string;
    signalKey: string;
    emittedAt: string;
    payload: T;
}

export interface TradingOutputContractField {
    name: string;
    type: string;
    required: boolean;
    description: string;
}

export interface TradingOutputContractDefinition {
    kind: TradingOutputContractKind;
    version: number;
    label: string;
    description: string;
    fields: TradingOutputContractField[];
}

export interface TradingSignalEventPayload {
    signalCode: string;
    signalVersion: number;
    signalId: string;
    symbol: string;
    timeframe: string;
    side: string;
    session: string;
    eventType: string;
    occurredAt: string;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
}

export interface TradingExecutionEventPayload {
    signalCode: string;
    signalVersion: number;
    eventType: string;
    kind: TradingExecutionEventKind;
    occurredAt: string;
    label: string | null;
    stateBefore: string | null;
    stateAfter: string | null;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
}

export interface TradingTradeOutcomePayload {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    side: string;
    result: TradingTradeOutcomeResult;
    exitReason: string;
    rMultiple: number;
    pnlUsd: number;
    entryTime: string;
    exitTime: string | null;
    backtestRunId: string;
    tradeRecordId: string;
}

export interface TradingInvestigationOutcomePayload {
    signalCode: string;
    signalVersion: number;
    rootCauseCategory: TradingInvestigationRootCauseCategory;
    outcome: TradingInvestigationOutcome;
    summary: string | null;
    decidedAt: string;
    backtestRunId: string | null;
    indicatorInstanceId: string | null;
    tradeRecordId: string | null;
}

const CONTRACT_VERSION = 1;

const CONTRACT_KINDS: TradingOutputContractKind[] = [
    'signal-event',
    'execution-event',
    'trade-outcome',
    'investigation-outcome',
];

const CONTRACT_KIND_SET = new Set<string>(CONTRACT_KINDS);
const EXECUTION_EVENT_KIND_SET = new Set<TradingExecutionEventKind>(['command', 'decision']);
const TRADE_OUTCOME_RESULT_SET = new Set<TradingTradeOutcomeResult>(['ACTIVE', 'WIN', 'LOSS', 'BE']);
const ROOT_CAUSE_CATEGORY_SET = new Set<TradingInvestigationRootCauseCategory>([
    'data-quality',
    'signal-logic',
    'risk-settings',
    'broker-execution',
]);
const INVESTIGATION_OUTCOME_SET = new Set<TradingInvestigationOutcome>([
    'resolved',
    'mitigated',
    'escalated',
]);

const ENVELOPE_FIELDS: TradingOutputContractField[] = [
    { name: 'contractKind', type: 'string', required: true, description: 'Discriminator for the output contract type.' },
    { name: 'contractVersion', type: 'number', required: true, description: 'Version number for the published contract shape.' },
    { name: 'recordId', type: 'string', required: true, description: 'Stable identifier for the emitted record.' },
    { name: 'signalKey', type: 'string', required: true, description: 'Stable signal identity, typically <code>@v<version>.' },
    { name: 'emittedAt', type: 'string', required: true, description: 'ISO 8601 timestamp when the envelope was emitted.' },
    { name: 'payload', type: 'object', required: true, description: 'Contract-specific payload containing documented fields only.' },
];

const SIGNAL_EVENT_FIELDS: TradingOutputContractField[] = [
    { name: 'payload.signalCode', type: 'string', required: true, description: 'Signal definition code.' },
    { name: 'payload.signalVersion', type: 'number', required: true, description: 'Signal definition version.' },
    { name: 'payload.signalId', type: 'string', required: true, description: 'Unique signal instance identifier.' },
    { name: 'payload.symbol', type: 'string', required: true, description: 'Trading instrument symbol.' },
    { name: 'payload.timeframe', type: 'string', required: true, description: 'Chart timeframe.' },
    { name: 'payload.side', type: 'string', required: true, description: 'Trade direction (LONG or SHORT).' },
    { name: 'payload.session', type: 'string', required: true, description: 'Trading session context.' },
    { name: 'payload.eventType', type: 'string', required: true, description: 'Signal event type.' },
    { name: 'payload.occurredAt', type: 'string', required: true, description: 'ISO 8601 timestamp of the event.' },
    { name: 'payload.backtestRunId', type: 'string | null', required: false, description: 'Originating backtest run identifier.' },
    { name: 'payload.indicatorInstanceId', type: 'string | null', required: false, description: 'Live deployment instance identifier.' },
];

const EXECUTION_EVENT_FIELDS: TradingOutputContractField[] = [
    { name: 'payload.signalCode', type: 'string', required: true, description: 'Signal definition code.' },
    { name: 'payload.signalVersion', type: 'number', required: true, description: 'Signal definition version.' },
    { name: 'payload.eventType', type: 'string', required: true, description: 'Execution event type.' },
    { name: 'payload.kind', type: 'string', required: true, description: 'Event kind: command or decision.' },
    { name: 'payload.occurredAt', type: 'string', required: true, description: 'ISO 8601 timestamp of the event.' },
    { name: 'payload.label', type: 'string | null', required: false, description: 'Human-readable event label.' },
    { name: 'payload.stateBefore', type: 'string | null', required: false, description: 'State before the event.' },
    { name: 'payload.stateAfter', type: 'string | null', required: false, description: 'State after the event.' },
    { name: 'payload.backtestRunId', type: 'string | null', required: false, description: 'Originating backtest run identifier.' },
    { name: 'payload.indicatorInstanceId', type: 'string | null', required: false, description: 'Live deployment instance identifier.' },
    { name: 'payload.tradeRecordId', type: 'string | null', required: false, description: 'Associated trade history record identifier.' },
];

const TRADE_OUTCOME_FIELDS: TradingOutputContractField[] = [
    { name: 'payload.signalCode', type: 'string', required: true, description: 'Signal definition code.' },
    { name: 'payload.signalVersion', type: 'number', required: true, description: 'Signal definition version.' },
    { name: 'payload.symbol', type: 'string', required: true, description: 'Trading instrument symbol.' },
    { name: 'payload.timeframe', type: 'string', required: true, description: 'Chart timeframe.' },
    { name: 'payload.side', type: 'string', required: true, description: 'Trade direction.' },
    { name: 'payload.result', type: 'string', required: true, description: 'Trade result: WIN, LOSS, BE, or ACTIVE.' },
    { name: 'payload.exitReason', type: 'string', required: true, description: 'Exit rule or reason code.' },
    { name: 'payload.rMultiple', type: 'number', required: true, description: 'Risk-reward multiple achieved.' },
    { name: 'payload.pnlUsd', type: 'number', required: true, description: 'Profit or loss in USD.' },
    { name: 'payload.entryTime', type: 'string', required: true, description: 'ISO 8601 entry timestamp.' },
    { name: 'payload.exitTime', type: 'string | null', required: false, description: 'ISO 8601 exit timestamp.' },
    { name: 'payload.backtestRunId', type: 'string', required: true, description: 'Originating backtest run identifier.' },
    { name: 'payload.tradeRecordId', type: 'string', required: true, description: 'Trade history record identifier.' },
];

const INVESTIGATION_OUTCOME_FIELDS: TradingOutputContractField[] = [
    { name: 'payload.signalCode', type: 'string', required: true, description: 'Signal definition code.' },
    { name: 'payload.signalVersion', type: 'number', required: true, description: 'Signal definition version.' },
    { name: 'payload.rootCauseCategory', type: 'string', required: true, description: 'Root cause category: data-quality, signal-logic, risk-settings, or broker-execution.' },
    { name: 'payload.outcome', type: 'string', required: true, description: 'Investigation outcome: resolved, mitigated, or escalated.' },
    { name: 'payload.summary', type: 'string | null', required: false, description: 'Operator summary note.' },
    { name: 'payload.decidedAt', type: 'string', required: true, description: 'ISO 8601 decision timestamp.' },
    { name: 'payload.backtestRunId', type: 'string | null', required: false, description: 'Originating backtest run identifier.' },
    { name: 'payload.indicatorInstanceId', type: 'string | null', required: false, description: 'Live deployment instance identifier.' },
    { name: 'payload.tradeRecordId', type: 'string | null', required: false, description: 'Associated trade history record identifier.' },
];

const CONTRACT_DEFINITIONS: TradingOutputContractDefinition[] = [
    {
        kind: 'signal-event',
        version: CONTRACT_VERSION,
        label: 'Signal Event',
        description: 'A signal-generated entry, exit, or update event from the signal engine.',
        fields: [...ENVELOPE_FIELDS, ...SIGNAL_EVENT_FIELDS],
    },
    {
        kind: 'execution-event',
        version: CONTRACT_VERSION,
        label: 'Execution Event',
        description: 'A command or decision event from the execution timeline.',
        fields: [...ENVELOPE_FIELDS, ...EXECUTION_EVENT_FIELDS],
    },
    {
        kind: 'trade-outcome',
        version: CONTRACT_VERSION,
        label: 'Trade Outcome',
        description: 'A closed trade result with entry, exit, and P&L details.',
        fields: [...ENVELOPE_FIELDS, ...TRADE_OUTCOME_FIELDS],
    },
    {
        kind: 'investigation-outcome',
        version: CONTRACT_VERSION,
        label: 'Investigation Outcome',
        description: 'A recorded root-cause diagnosis decision from incident investigation.',
        fields: [...ENVELOPE_FIELDS, ...INVESTIGATION_OUTCOME_FIELDS],
    },
];

function cloneField(field: TradingOutputContractField): TradingOutputContractField {
    return {
        name: field.name,
        type: field.type,
        required: field.required,
        description: field.description,
    };
}

function cloneDefinition(definition: TradingOutputContractDefinition): TradingOutputContractDefinition {
    return {
        kind: definition.kind,
        version: definition.version,
        label: definition.label,
        description: definition.description,
        fields: definition.fields.map((field) => cloneField(field)),
    };
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${fieldName} must be a string.`);
    }

    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${fieldName} is required.`);
    }

    return normalized;
}

function optionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
}

function requirePositiveSafeInteger(value: unknown, fieldName: string): number {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
        throw new Error(`${fieldName} must be a positive integer.`);
    }

    return Number(value);
}

function requireFiniteNumber(value: unknown, fieldName: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${fieldName} must be a finite number.`);
    }

    return value;
}

function requireIsoTimestamp(value: unknown, fieldName: string): string {
    const normalized = requireNonEmptyString(value, fieldName);
    const timestamp = Date.parse(normalized);
    if (Number.isNaN(timestamp)) {
        throw new Error(`${fieldName} must be a valid ISO timestamp.`);
    }

    return new Date(timestamp).toISOString();
}

function optionalIsoTimestamp(value: unknown): string | null {
    const normalized = optionalString(value);
    if (!normalized) {
        return null;
    }

    const timestamp = Date.parse(normalized);
    if (Number.isNaN(timestamp)) {
        throw new Error('Optional timestamp must be a valid ISO timestamp when supplied.');
    }

    return new Date(timestamp).toISOString();
}

function requireExecutionEventKind(value: unknown): TradingExecutionEventKind {
    if (typeof value !== 'string' || !EXECUTION_EVENT_KIND_SET.has(value as TradingExecutionEventKind)) {
        throw new Error('payload.kind must be command or decision.');
    }

    return value as TradingExecutionEventKind;
}

function requireTradeOutcomeResult(value: unknown): TradingTradeOutcomeResult {
    if (typeof value !== 'string' || !TRADE_OUTCOME_RESULT_SET.has(value as TradingTradeOutcomeResult)) {
        throw new Error('payload.result must be ACTIVE, WIN, LOSS, or BE.');
    }

    return value as TradingTradeOutcomeResult;
}

function requireRootCauseCategory(value: unknown): TradingInvestigationRootCauseCategory {
    if (typeof value !== 'string' || !ROOT_CAUSE_CATEGORY_SET.has(value as TradingInvestigationRootCauseCategory)) {
        throw new Error('payload.rootCauseCategory is invalid.');
    }

    return value as TradingInvestigationRootCauseCategory;
}

function requireInvestigationOutcome(value: unknown): TradingInvestigationOutcome {
    if (typeof value !== 'string' || !INVESTIGATION_OUTCOME_SET.has(value as TradingInvestigationOutcome)) {
        throw new Error('payload.outcome is invalid.');
    }

    return value as TradingInvestigationOutcome;
}

function buildEnvelope<T>(
    contractKind: TradingOutputContractKind,
    recordId: unknown,
    signalKey: unknown,
    payload: T,
): TradingOutputEnvelope<T> {
    return {
        contractKind,
        contractVersion: CONTRACT_VERSION,
        recordId: requireNonEmptyString(recordId, 'recordId'),
        signalKey: requireNonEmptyString(signalKey, 'signalKey'),
        emittedAt: new Date().toISOString(),
        payload,
    };
}

function sanitizeSignalEventPayload(payload: TradingSignalEventPayload): TradingSignalEventPayload {
    return {
        signalCode: requireNonEmptyString(payload.signalCode, 'payload.signalCode'),
        signalVersion: requirePositiveSafeInteger(payload.signalVersion, 'payload.signalVersion'),
        signalId: requireNonEmptyString(payload.signalId, 'payload.signalId'),
        symbol: requireNonEmptyString(payload.symbol, 'payload.symbol'),
        timeframe: requireNonEmptyString(payload.timeframe, 'payload.timeframe'),
        side: requireNonEmptyString(payload.side, 'payload.side'),
        session: requireNonEmptyString(payload.session, 'payload.session'),
        eventType: requireNonEmptyString(payload.eventType, 'payload.eventType'),
        occurredAt: requireIsoTimestamp(payload.occurredAt, 'payload.occurredAt'),
        backtestRunId: optionalString(payload.backtestRunId),
        indicatorInstanceId: optionalString(payload.indicatorInstanceId),
    };
}

function sanitizeExecutionEventPayload(payload: TradingExecutionEventPayload): TradingExecutionEventPayload {
    return {
        signalCode: requireNonEmptyString(payload.signalCode, 'payload.signalCode'),
        signalVersion: requirePositiveSafeInteger(payload.signalVersion, 'payload.signalVersion'),
        eventType: requireNonEmptyString(payload.eventType, 'payload.eventType'),
        kind: requireExecutionEventKind(payload.kind),
        occurredAt: requireIsoTimestamp(payload.occurredAt, 'payload.occurredAt'),
        label: optionalString(payload.label),
        stateBefore: optionalString(payload.stateBefore),
        stateAfter: optionalString(payload.stateAfter),
        backtestRunId: optionalString(payload.backtestRunId),
        indicatorInstanceId: optionalString(payload.indicatorInstanceId),
        tradeRecordId: optionalString(payload.tradeRecordId),
    };
}

function sanitizeTradeOutcomePayload(payload: TradingTradeOutcomePayload): TradingTradeOutcomePayload {
    return {
        signalCode: requireNonEmptyString(payload.signalCode, 'payload.signalCode'),
        signalVersion: requirePositiveSafeInteger(payload.signalVersion, 'payload.signalVersion'),
        symbol: requireNonEmptyString(payload.symbol, 'payload.symbol'),
        timeframe: requireNonEmptyString(payload.timeframe, 'payload.timeframe'),
        side: requireNonEmptyString(payload.side, 'payload.side'),
        result: requireTradeOutcomeResult(payload.result),
        exitReason: requireNonEmptyString(payload.exitReason, 'payload.exitReason'),
        rMultiple: requireFiniteNumber(payload.rMultiple, 'payload.rMultiple'),
        pnlUsd: requireFiniteNumber(payload.pnlUsd, 'payload.pnlUsd'),
        entryTime: requireIsoTimestamp(payload.entryTime, 'payload.entryTime'),
        exitTime: optionalIsoTimestamp(payload.exitTime),
        backtestRunId: requireNonEmptyString(payload.backtestRunId, 'payload.backtestRunId'),
        tradeRecordId: requireNonEmptyString(payload.tradeRecordId, 'payload.tradeRecordId'),
    };
}

function sanitizeInvestigationOutcomePayload(
    payload: TradingInvestigationOutcomePayload,
): TradingInvestigationOutcomePayload {
    return {
        signalCode: requireNonEmptyString(payload.signalCode, 'payload.signalCode'),
        signalVersion: requirePositiveSafeInteger(payload.signalVersion, 'payload.signalVersion'),
        rootCauseCategory: requireRootCauseCategory(payload.rootCauseCategory),
        outcome: requireInvestigationOutcome(payload.outcome),
        summary: optionalString(payload.summary),
        decidedAt: requireIsoTimestamp(payload.decidedAt, 'payload.decidedAt'),
        backtestRunId: optionalString(payload.backtestRunId),
        indicatorInstanceId: optionalString(payload.indicatorInstanceId),
        tradeRecordId: optionalString(payload.tradeRecordId),
    };
}

export function isValidContractKind(value: unknown): value is TradingOutputContractKind {
    return typeof value === 'string' && CONTRACT_KIND_SET.has(value);
}

export class TradingOutputContractService {
    listContracts(): TradingOutputContractDefinition[] {
        return CONTRACT_DEFINITIONS.map((definition) => cloneDefinition(definition));
    }

    getContract(kind: TradingOutputContractKind): TradingOutputContractDefinition | null {
        const definition = CONTRACT_DEFINITIONS.find((contract) => contract.kind === kind);
        return definition ? cloneDefinition(definition) : null;
    }

    shapeSignalEventEnvelope(
        recordId: string,
        signalKey: string,
        payload: TradingSignalEventPayload,
    ): TradingOutputEnvelope<TradingSignalEventPayload> {
        return buildEnvelope('signal-event', recordId, signalKey, sanitizeSignalEventPayload(payload));
    }

    shapeExecutionEventEnvelope(
        recordId: string,
        signalKey: string,
        payload: TradingExecutionEventPayload,
    ): TradingOutputEnvelope<TradingExecutionEventPayload> {
        return buildEnvelope('execution-event', recordId, signalKey, sanitizeExecutionEventPayload(payload));
    }

    shapeTradeOutcomeEnvelope(
        recordId: string,
        signalKey: string,
        payload: TradingTradeOutcomePayload,
    ): TradingOutputEnvelope<TradingTradeOutcomePayload> {
        return buildEnvelope('trade-outcome', recordId, signalKey, sanitizeTradeOutcomePayload(payload));
    }

    shapeInvestigationOutcomeEnvelope(
        recordId: string,
        signalKey: string,
        payload: TradingInvestigationOutcomePayload,
    ): TradingOutputEnvelope<TradingInvestigationOutcomePayload> {
        return buildEnvelope(
            'investigation-outcome',
            recordId,
            signalKey,
            sanitizeInvestigationOutcomePayload(payload),
        );
    }
}
