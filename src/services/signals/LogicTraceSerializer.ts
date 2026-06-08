import { Prisma, SignalLogicTrace } from '@prisma/client';
import { RuntimeLogicTraceDraft } from './types';

export class LogicTraceSerializer {
    public toCreateManyInput(
        backtestRunId: string,
        signalIdByExternalKey: Map<string, string>,
        drafts: RuntimeLogicTraceDraft[],
    ): Prisma.SignalLogicTraceCreateManyInput[] {
        return drafts.map((draft) => {
            const signalId = signalIdByExternalKey.get(draft.signalExternalKey);

            return {
                signalId: signalId ?? null,
                backtestRunId,
                eventType: draft.eventType,
                candleTime: draft.candleTime,
                stateBefore: draft.stateBefore ?? null,
                stateAfter: draft.stateAfter ?? null,
                ruleId: draft.ruleId ?? null,
                indicatorJson: draft.indicatorJson ? draft.indicatorJson as Prisma.InputJsonValue : undefined,
                thresholdJson: draft.thresholdJson ? draft.thresholdJson as Prisma.InputJsonValue : undefined,
                priceJson: draft.priceJson ? draft.priceJson as Prisma.InputJsonValue : undefined,
                notes: draft.notes ?? null,
            };
        });
    }

    public toApi(trace: SignalLogicTrace) {
        return {
            id: trace.id,
            signalId: trace.signalId,
            signalEventId: trace.signalEventId,
            backtestRunId: trace.backtestRunId,
            eventType: trace.eventType,
            candleTime: trace.candleTime,
            stateBefore: trace.stateBefore,
            stateAfter: trace.stateAfter,
            ruleId: trace.ruleId,
            indicatorJson: trace.indicatorJson,
            thresholdJson: trace.thresholdJson,
            priceJson: trace.priceJson,
            notes: trace.notes,
            createdAt: trace.createdAt,
        };
    }
}
