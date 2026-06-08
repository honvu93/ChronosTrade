import express from 'express';
import { PrismaClient } from '@prisma/client';
import { registerTradingExportRoutes } from './registerTradingExportRoutes';
import { registerTradingExternalActionRoutes } from './registerTradingExternalActionRoutes';
import { ExternalActionReplayService } from '../services/trading/externalAction/ExternalActionReplayService';
import { PostgresExternalActionStore } from '../services/trading/externalAction/ExternalSignalStore';
import { BullMqExternalActionDeliveryJobPublisher } from '../services/trading/externalAction/ExternalActionDeliveryQueue';

export interface TradingIntegrationDependencies {
    store: PostgresExternalActionStore;
    replayService: ExternalActionReplayService;
}

/**
 * Consolidated integration routes: exports + external actions.
 * Replaces separate registerTradingExportRoutes + registerTradingExternalActionRoutes calls.
 */
export function registerTradingIntegrationRoutes(
    app: express.Application,
    prisma: PrismaClient,
    externalActionDeps?: TradingIntegrationDependencies,
) {
    registerTradingExportRoutes(app, prisma);
    registerTradingExternalActionRoutes(app, prisma, externalActionDeps);
}
