import {
    SignalBatchPreviewInput,
    SignalBatchPreviewTask,
    SignalPreviewRequestInput,
} from './types';
import { normalizeSymbol } from '../../utils/symbols';

const normalizeKey = (value: string) => value.trim().replace(/\s+/g, '_').toUpperCase();
const MAX_BATCH_PREVIEW_TASKS = 100;

const toDateRange = (from: string, to: string) => {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
        throw new Error('Invalid dateRange');
    }

    return { from: fromDate, to: toDate };
};

const ensureObject = (value: unknown, field: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${field} must be an object`);
    }

    return value as Record<string, unknown>;
};

const buildDefaultRequestKey = (input: {
    signalCode: string;
    signalVersion: number;
    symbol: string;
    timeframe: string;
    from: Date;
}) => `${normalizeKey(input.signalCode)}@${input.signalVersion}:${normalizeKey(input.symbol)}:${input.timeframe}:${input.from.toISOString().slice(0, 10)}`;

export class SignalBatchPlannerService {
    public expand(input: SignalBatchPreviewInput): SignalBatchPreviewTask[] {
        const tasks: SignalBatchPreviewTask[] = [];

        if (input.requests?.length) {
            input.requests.forEach((request, index) => {
                tasks.push(this.normalizeRequest(request, `REQ_${index + 1}`));
            });
        }

        if (input.matrix) {
            if (!input.matrix.assets?.length) {
                throw new Error('matrix.assets is required');
            }
            if (!input.matrix.definitions?.length) {
                throw new Error('matrix.definitions is required');
            }

            input.matrix.assets.forEach((asset) => {
                const assetDateRange = toDateRange(asset.dateRange.from, asset.dateRange.to);

                input.matrix?.definitions.forEach((definition, definitionIndex) => {
                    const dateRange = definition.dateRange
                        ? toDateRange(definition.dateRange.from, definition.dateRange.to)
                        : assetDateRange;

                    const requestKey = `${asset.assetKey || normalizeKey(asset.symbol)}::${definition.definitionKey || `${normalizeKey(definition.signalCode)}_${definitionIndex + 1}`}`;
                    tasks.push({
                        requestKey,
                        signalCode: definition.signalCode.trim().toUpperCase(),
                        signalVersion: Number(definition.signalVersion),
                        symbol: normalizeSymbol(asset.symbol),
                        timeframe: asset.timeframe.trim(),
                        from: dateRange.from,
                        to: dateRange.to,
                        parameters: ensureObject(definition.parameters, 'matrix.definitions[].parameters'),
                        initialEquity: typeof definition.initialEquity === 'number' ? definition.initialEquity : undefined,
                        riskPercent: typeof definition.riskPercent === 'number' ? definition.riskPercent : undefined,
                        executionConfig: definition.executionConfig,
                    });
                });
            });
        }

        if (tasks.length === 0) {
            throw new Error('At least one preview request is required');
        }
        if (tasks.length > MAX_BATCH_PREVIEW_TASKS) {
            throw new Error(`Preview batch expands to ${tasks.length} tasks, which exceeds the maximum of ${MAX_BATCH_PREVIEW_TASKS}.`);
        }

        return tasks;
    }

    private normalizeRequest(request: SignalPreviewRequestInput, fallbackKey: string): SignalBatchPreviewTask {
        const parameters = ensureObject(request.parameters, 'requests[].parameters');
        const signalCode = request.signalCode?.trim().toUpperCase();
        const symbol = request.symbol ? normalizeSymbol(request.symbol) : undefined;
        const timeframe = request.timeframe?.trim();

        if (!signalCode || request.signalVersion === undefined || !symbol || !timeframe) {
            throw new Error('Each preview request must include signalCode, signalVersion, symbol, and timeframe');
        }

        const dateRange = toDateRange(request.dateRange.from, request.dateRange.to);

        return {
            requestKey: request.requestKey?.trim() || buildDefaultRequestKey({
                signalCode,
                signalVersion: Number(request.signalVersion),
                symbol,
                timeframe,
                from: dateRange.from,
            }) || fallbackKey,
            signalCode,
            signalVersion: Number(request.signalVersion),
            symbol,
            timeframe,
            from: dateRange.from,
            to: dateRange.to,
            parameters,
            initialEquity: typeof request.initialEquity === 'number' ? request.initialEquity : undefined,
            riskPercent: typeof request.riskPercent === 'number' ? request.riskPercent : undefined,
            executionConfig: request.executionConfig,
        };
    }
}
