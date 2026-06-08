import { ExternalActionDeliveryJobPublisher } from './ExternalActionDeliveryQueue';
import {
    assertExternalActionOwnerAccess,
    ExternalActionAccessScope,
    ExternalActionActor,
    ExternalActionError,
    ExternalActionStore,
} from './types';

export class ExternalActionReplayService {
    constructor(
        private readonly store: ExternalActionStore,
        private readonly queuePublisher: ExternalActionDeliveryJobPublisher,
    ) {}

    async replayEvent(
        externalActionEventId: string,
        actor: ExternalActionActor,
        scope: ExternalActionAccessScope = {},
    ) {
        const event = await this.store.getActionableEventWithDeployment(externalActionEventId);
        if (!event) {
            throw new ExternalActionError(
                'EXTERNAL_ACTION_EVENT_NOT_FOUND',
                404,
                `External action event ${externalActionEventId} was not found.`,
            );
        }
        assertExternalActionOwnerAccess(actor, event.deployment.ownerUserId, scope);

        const previousStatus = event.status;
        const previousStatusReason = event.statusReason;

        const replayJob = await this.store.createReplayJob({
            externalActionEventId,
            replayKind: 'MANUAL_RETRY',
            createdByUserId: actor.id,
        });

        await this.store.updateActionableEventStatus(externalActionEventId, 'READY', 'Queued for manual replay.');
        try {
            await this.queuePublisher.enqueue({
                externalActionEventId,
                replayJobId: replayJob.id,
            });
        } catch (error) {
            await this.store.updateActionableEventStatus(
                externalActionEventId,
                previousStatus,
                previousStatusReason,
            );
            await this.store.markReplayJobFailed(
                replayJob.id,
                error instanceof Error
                    ? error.message
                    : 'Failed to enqueue the external action replay job.',
            );
            throw error;
        }

        return replayJob;
    }
}
