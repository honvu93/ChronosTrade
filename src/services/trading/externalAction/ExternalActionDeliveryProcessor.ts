import {
    ExternalActionDeliveryAttemptContext,
    ExternalActionDeliveryJobPayload,
} from './ExternalActionDeliveryQueue';
import { TelegramExternalActionDeliveryService } from './TelegramExternalActionDeliveryService';
import { ExternalActionStore } from './types';

export class ExternalActionDeliveryProcessor {
    constructor(
        private readonly store: ExternalActionStore,
        private readonly telegramDeliveryService: TelegramExternalActionDeliveryService,
    ) {}

    async process(
        payload: ExternalActionDeliveryJobPayload,
        context: ExternalActionDeliveryAttemptContext,
    ): Promise<void> {
        if (payload.replayJobId) {
            await this.store.markReplayJobStarted(payload.replayJobId);
        }

        const event = await this.store.getActionableEventWithDeployment(payload.externalActionEventId);
        if (!event) {
            if (payload.replayJobId) {
                await this.store.markReplayJobFailed(
                    payload.replayJobId,
                    `External action event ${payload.externalActionEventId} was not found.`,
                );
            }
            return;
        }

        if (event.deployment.status !== 'ACTIVE') {
            await this.store.updateActionableEventStatus(
                event.id,
                'CANCELED',
                `External deployment ${event.deployment.id} is ${event.deployment.status}.`,
            );
            if (payload.replayJobId) {
                await this.store.markReplayJobFailed(
                    payload.replayJobId,
                    `External deployment ${event.deployment.id} is ${event.deployment.status}.`,
                );
            }
            return;
        }

        const attempt = await this.store.createDeliveryAttempt({
            externalActionEventId: event.id,
            externalDeploymentId: event.externalDeploymentId,
            channelKind: 'TELEGRAM',
        });

        try {
            const result = await this.telegramDeliveryService.deliver(event);
            await this.store.completeDeliveryAttempt({
                deliveryId: attempt.id,
                status: 'SENT',
                providerMessageId: result.providerMessageId,
                providerChatId: result.providerChatId,
                requestFingerprint: result.requestFingerprint,
                requestJson: result.requestJson,
                responseJson: result.responseJson,
            });
            await this.store.updateActionableEventStatus(event.id, 'SENT', null);
            if (payload.replayJobId) {
                await this.store.markReplayJobCompleted(payload.replayJobId);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Telegram delivery failed.';
            await this.store.completeDeliveryAttempt({
                deliveryId: attempt.id,
                status: 'FAILED',
                errorCode: 'TELEGRAM_DELIVERY_FAILED',
                errorMessage: message,
            });

            if (context.attemptNumber >= context.maxAttempts) {
                await this.store.updateActionableEventStatus(event.id, 'FAILED', message);
                if (payload.replayJobId) {
                    await this.store.markReplayJobFailed(payload.replayJobId, message);
                }
            }

            throw error;
        }
    }
}
