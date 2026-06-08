import { Prisma, SignalEvent } from '@prisma/client';
import { RuntimeSignalEventDraft } from './types';

const round = (value: Prisma.Decimal | number | string | null | undefined, digits = 4) => {
    if (value === null || value === undefined) return null;
    return Number(Number(value).toFixed(digits));
};

export class SignalAnnotationSerializer {
    public toCreateManyInput(
        backtestRunId: string,
        signalIdByExternalKey: Map<string, string>,
        drafts: RuntimeSignalEventDraft[],
    ): Prisma.SignalEventCreateManyInput[] {
        return drafts.map((draft) => {
            const signalId = signalIdByExternalKey.get(draft.signalExternalKey);

            return {
                signalId: signalId ?? null,
                backtestRunId,
                eventType: draft.eventType,
                candleTime: draft.candleTime,
                price: draft.price ?? null,
                label: draft.label ?? null,
                metaJson: draft.metaJson ? draft.metaJson as Prisma.InputJsonValue : undefined,
            };
        });
    }

    public toApi(event: SignalEvent) {
        return {
            id: event.id,
            signalId: event.signalId,
            backtestRunId: event.backtestRunId,
            eventType: event.eventType,
            candleTime: event.candleTime,
            price: round(event.price),
            label: event.label,
            metaJson: event.metaJson,
            createdAt: event.createdAt,
        };
    }
}
