import { SignalEventType } from '@prisma/client';
import crypto from 'crypto';

import { RuntimeSignalDraft } from '../../signals/types';
import { PersistedLiveSignalEvent } from '../TradingTradeIntentService';
import { SignalEligibilityLookup } from './types';
import { ExternalActionDeliveryJobPublisher } from './ExternalActionDeliveryQueue';
import { ExternalActionStore } from './types';

export interface CaptureExternalActionableEventsInput {
    indicatorInstanceId: string;
    runtimeSignal?: RuntimeSignalDraft | null;
    persistedEvents: PersistedLiveSignalEvent[];
}

export class ExternalActionEventService {
    constructor(
        private readonly store: ExternalActionStore,
        private readonly queuePublisher: ExternalActionDeliveryJobPublisher,
        private readonly eligibilityLookup: SignalEligibilityLookup,
    ) {}

    async captureActionableEvents(input: CaptureExternalActionableEventsInput): Promise<number> {
        if (!input.runtimeSignal?.externalKey) {
            return 0;
        }

        const deployments = await this.store.findActiveDeploymentsByIndicatorInstance(input.indicatorInstanceId);
        if (deployments.length === 0) {
            return 0;
        }

        const entryEvents = input.persistedEvents.filter((item) => (
            item.savedEvent.eventType === SignalEventType.ENTRY
            && item.draftEvent.signalExternalKey === input.runtimeSignal?.externalKey
        ));
        if (entryEvents.length === 0) {
            return 0;
        }

        const eligibility = await this.eligibilityLookup.getEligibilityForSignal(
            deployments[0].signalCode,
            deployments[0].signalVersion,
        );
        const eligibilityState = eligibility?.eligibilityState ?? 'unknown';

        let createdCount = 0;
        for (const deployment of deployments) {
            for (const entryEvent of entryEvents) {
                const eventId = crypto.randomUUID();
                const emittedAt = new Date().toISOString();
                const event = await this.store.createActionableEvent({
                    eventId,
                    externalDeploymentId: deployment.id,
                    internalSignalEventId: entryEvent.savedEvent.id,
                    idempotencyKey: `${deployment.id}:${entryEvent.savedEvent.id}`,
                    signalCode: deployment.signalCode,
                    signalVersion: deployment.signalVersion,
                    indicatorInstanceId: input.indicatorInstanceId,
                    sourceBacktestRunId: deployment.sourceBacktestRunId,
                    symbol: input.runtimeSignal.symbol,
                    timeframe: input.runtimeSignal.timeframe,
                    side: input.runtimeSignal.side,
                    candleTime: entryEvent.savedEvent.candleTime.toISOString(),
                    referencePrice: entryEvent.savedEvent.price === null ? null : Number(entryEvent.savedEvent.price),
                    entryPrice: input.runtimeSignal.entryPrice,
                    stopLoss: input.runtimeSignal.stopLoss,
                    takeProfit1: input.runtimeSignal.takeProfit1 ?? null,
                    takeProfit2: input.runtimeSignal.takeProfit2 ?? null,
                    suggestedVolume: null,
                    emittedAt,
                    payload: {
                        contractKind: 'actionable-signal-event',
                        contractVersion: 1,
                        eventId,
                        emittedAt,
                        actionability: 'ACTIONABLE',
                        actionType: 'OPEN_MARKET',
                        source: {
                            signalCode: deployment.signalCode,
                            signalVersion: deployment.signalVersion,
                            indicatorInstanceId: input.indicatorInstanceId,
                            sourceBacktestRunId: deployment.sourceBacktestRunId,
                            externalDeploymentId: deployment.id,
                            eligibilityState,
                        },
                        market: {
                            symbol: input.runtimeSignal.symbol,
                            timeframe: input.runtimeSignal.timeframe,
                            side: input.runtimeSignal.side,
                            candleTime: entryEvent.savedEvent.candleTime.toISOString(),
                            referencePrice: entryEvent.savedEvent.price === null ? null : Number(entryEvent.savedEvent.price),
                        },
                        execution: {
                            entryPrice: input.runtimeSignal.entryPrice,
                            entryType: 'MARKET',
                            stopLoss: input.runtimeSignal.stopLoss,
                            takeProfit1: input.runtimeSignal.takeProfit1 ?? null,
                            takeProfit2: input.runtimeSignal.takeProfit2 ?? null,
                            suggestedVolume: null,
                        },
                        trace: {
                            internalSignalEventId: entryEvent.savedEvent.id,
                            signalKey: `${deployment.signalCode}@v${deployment.signalVersion}`,
                        },
                    },
                });

                if (!event) {
                    continue;
                }

                createdCount += 1;
                try {
                    await this.queuePublisher.enqueue({
                        externalActionEventId: event.id,
                    });
                } catch (error) {
                    await this.store.updateActionableEventStatus(
                        event.id,
                        'FAILED',
                        error instanceof Error
                            ? `Failed to enqueue Telegram delivery: ${error.message}`
                            : 'Failed to enqueue Telegram delivery.',
                    );
                }
            }
        }

        return createdCount;
    }
}
