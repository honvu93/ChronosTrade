import { CandleBar, SignalRuntimeServices } from '../../types';
import {
    BlockEvaluateResult,
    ConditionDef,
    FieldSchema,
    TechIndicatorBlock,
    TechIndicatorDefinition,
} from '../TechIndicatorBlock';

// â”€â”€â”€ Params & State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface SessionParams {
    /** Start hour (0-23) in UTC */
    startHour: number;
    /** End hour (0-23) in UTC */
    endHour: number;
}

interface SessionState {
    // No specific state needed for session checks
}

// â”€â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const paramSchema: FieldSchema[] = [
    {
        id: 'startHour',
        type: 'number',
        label: 'Start Hour (UTC)',
        default: 8,
        min: 0,
        max: 23,
        step: 1,
    },
    {
        id: 'endHour',
        type: 'number',
        label: 'End Hour (UTC)',
        default: 22,
        min: 0,
        max: 23,
        step: 1,
    },
];

const conditions: ConditionDef[] = [
    {
        id: 'in_session',
        name: 'Within session window',
        description: 'Checks whether the current bar falls inside the configured UTC session window.',
        paramSchema: [],
    },
];

// â”€â”€â”€ Definition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const definition: TechIndicatorDefinition = {
    id: 'SESSION_FILTER',
    name: 'Session Filter',
    category: 'utility',
    description: 'Filters signals by trading session window (UTC).',
    paramSchema,
    conditions,
};

// â”€â”€â”€ Block Implementation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const sessionBlock: TechIndicatorBlock<SessionParams, SessionState> = {
    definition,

    initialize(_bars: CandleBar[], _params: SessionParams, _services: SignalRuntimeServices): SessionState {
        return {};
    },

    evaluate(
        bar: CandleBar,
        _prevBar: CandleBar | null,
        _allBars: CandleBar[],
        _index: number,
        state: SessionState,
        params: SessionParams,
        conditionId: string,
        _conditionParams: Record<string, unknown>,
        _services: SignalRuntimeServices,
    ): BlockEvaluateResult<SessionState> {
        let isActive = false;

        const hour = bar.time.getUTCHours();
        const start = params.startHour ?? 8;
        const end = params.endHour ?? 22;

        if (conditionId === 'in_session') {
            if (start <= end) {
                isActive = hour >= start && hour < end;
            } else {
                // Overnight session (e.g., 22 to 08)
                isActive = hour >= start || hour < end;
            }
        }

        return {
            state,
            isActive,
            values: { utcHour: hour },
        };
    },
};
