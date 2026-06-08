import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
    TradingAutomationBindingService,
    TradingAutomationBindingServiceError,
} from './TradingAutomationBindingService';

function createPrismaMock() {
    const binding = {
        id: 'binding-1',
        accountId: 'acct-1',
        indicatorInstanceId: 'inst-1',
        name: 'Paper Auto',
        status: 'PENDING_APPROVAL',
        mode: 'AUTO_EXECUTE',
        approvalRequired: false,
        killSwitchActive: false,
        createdByUserId: 'user-1',
        approvedByUserId: null,
        approvedAt: null,
        lastTriggeredAt: null,
        statusReason: null,
        filtersJson: null,
        riskConfigJson: null,
        guardrailsJson: null,
        createdAt: new Date('2026-03-12T09:00:00.000Z'),
        updatedAt: new Date('2026-03-12T09:00:00.000Z'),
        indicatorInstance: {
            id: 'inst-1',
            name: 'Indicator 1',
            status: 'ACTIVE',
            signalCode: 'songTrap',
            signalVersion: 3,
            symbol: 'XAUUSD',
            timeframe: 'H1',
        },
    };

    return {
        tradingAutomationBinding: {
            findMany: async () => [binding],
            create: async (args: { data: Record<string, unknown> }) => ({
                ...binding,
                ...args.data,
                indicatorInstance: binding.indicatorInstance,
            }),
            findFirst: async () => binding,
            update: async (args: { data: Record<string, unknown> }) => ({
                ...binding,
                ...args.data,
                indicatorInstance: binding.indicatorInstance,
            }),
        },
        indicatorInstance: {
            findMany: async () => [{
                id: 'inst-1',
                name: 'Indicator 1',
                status: 'ACTIVE',
                signalCode: 'songTrap',
                signalVersion: 3,
                symbol: 'XAUUSD',
                timeframe: 'H1',
                sourceBacktestRunId: 'run-1',
                updatedAt: new Date('2026-03-12T09:00:00.000Z'),
            }],
            findUnique: async () => binding.indicatorInstance,
        },
    } as unknown as PrismaClient;
}

describe('TradingAutomationBindingService', () => {
    it('unlocks auto-execute in the snapshot for paper accounts', async () => {
        const service = new TradingAutomationBindingService(
            createPrismaMock(),
            {
                getBrokerContext: async () => ({
                    id: 'acct-1',
                    ownerUserId: 'user-1',
                    label: 'Paper Account',
                    brokerKind: 'MT5',
                    accountMode: 'PAPER',
                    status: 'ACTIVE',
                    baseCurrency: 'USD',
                    leverage: 500,
                    lastSeenAt: null,
                    lastSuccessfulSyncAt: null,
                    metadataJson: null,
                    credential: null,
                }),
            },
        );

        const snapshot = await service.listBindings({ id: 'user-1', role: 'USER' }, 'acct-1');

        assert.equal(snapshot.autoExecuteLocked, false);
    });

    it('keeps auto-execute locked for live accounts on binding creation', async () => {
        const service = new TradingAutomationBindingService(
            createPrismaMock(),
            {
                getBrokerContext: async () => ({
                    id: 'acct-1',
                    ownerUserId: 'user-1',
                    label: 'Live Account',
                    brokerKind: 'MT5',
                    accountMode: 'LIVE',
                    status: 'ACTIVE',
                    baseCurrency: 'USD',
                    leverage: 500,
                    lastSeenAt: null,
                    lastSuccessfulSyncAt: null,
                    metadataJson: null,
                    credential: null,
                }),
            },
        );

        await assert.rejects(
            () => service.createBinding(
                { id: 'user-1', role: 'USER' },
                'acct-1',
                {
                    indicatorInstanceId: 'inst-1',
                    name: 'Live Auto',
                    mode: 'AUTO_EXECUTE',
                    approvalRequired: false,
                },
            ),
            (error: unknown) => error instanceof TradingAutomationBindingServiceError
                && error.code === 'TRADING_AUTOMATION_LOCKED',
        );
    });

    it('allows paper accounts to create auto-execute bindings', async () => {
        const service = new TradingAutomationBindingService(
            createPrismaMock(),
            {
                getBrokerContext: async () => ({
                    id: 'acct-1',
                    ownerUserId: 'user-1',
                    label: 'Paper Account',
                    brokerKind: 'MT5',
                    accountMode: 'PAPER',
                    status: 'ACTIVE',
                    baseCurrency: 'USD',
                    leverage: 500,
                    lastSeenAt: null,
                    lastSuccessfulSyncAt: null,
                    metadataJson: null,
                    credential: null,
                }),
            },
        );

        const binding = await service.createBinding(
            { id: 'user-1', role: 'USER' },
            'acct-1',
            {
                indicatorInstanceId: 'inst-1',
                name: 'Paper Auto',
                mode: 'AUTO_EXECUTE',
                approvalRequired: false,
            },
        );

        assert.equal(binding.mode, 'AUTO_EXECUTE');
    });
});
