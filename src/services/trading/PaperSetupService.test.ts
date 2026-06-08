import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PaperSetupService, PaperSetupServiceError } from './PaperSetupService';

const ACTOR = { id: 'user-1', role: 'USER' as const };

const ELIGIBLE_RESULTS = Array.from({ length: 12 }, (_, i) => ({
    backtestRunId: 'run-1',
    isOpen: false,
    win: i < 9, // 9 wins, 3 losses → WR=75%, PF>1.5
    rMultiple: i < 9 ? 1.0 : -0.5,
    maxDrawdownPct: -4.0,
}));

function makePrisma({
    accountMode = 'PAPER' as 'PAPER' | 'LIVE',
    ownerUserId = 'user-1',
    hasSignalDef = true,
    hasCompletedRun = true,
    tradeResults = ELIGIBLE_RESULTS,
}: {
    accountMode?: 'PAPER' | 'LIVE';
    ownerUserId?: string;
    hasSignalDef?: boolean;
    hasCompletedRun?: boolean;
    tradeResults?: typeof ELIGIBLE_RESULTS;
} = {}) {
    let instanceIdCounter = 0;
    let bindingIdCounter = 0;
    const createdInstances: unknown[] = [];
    const createdBindings: unknown[] = [];

    const prisma = {
        tradingAccount: {
            findUnique: async () => (
                ownerUserId !== 'nonexistent'
                    ? { id: 'acct-1', ownerUserId, accountMode, status: 'ACTIVE' }
                    : null
            ),
        },
        signalDefinition: {
            findUnique: async () => (
                hasSignalDef ? { code: 'SIG_TEST', version: 1, name: 'Test Signal' } : null
            ),
        },
        backtestRun: {
            findFirst: async () => (
                hasCompletedRun
                    ? { id: 'run-1', status: 'COMPLETED', signalCode: 'SIG_TEST', signalVersion: 1 }
                    : null
            ),
        },
        backtestTradeResult: {
            findMany: async () => tradeResults,
        },
        indicatorInstance: {
            create: async (args: { data: Record<string, unknown> }) => {
                const id = `instance-${++instanceIdCounter}`;
                createdInstances.push({ id, ...args.data });
                return { id, ...args.data };
            },
        },
        tradingAutomationBinding: {
            create: async (args: { data: Record<string, unknown> }) => {
                const id = `binding-${++bindingIdCounter}`;
                createdBindings.push({ id, ...args.data });
                return { id, ...args.data };
            },
        },
        __spy: { createdInstances, createdBindings },
    } as unknown as PrismaClient & { __spy: { createdInstances: unknown[]; createdBindings: unknown[] } };

    return prisma;
}

describe('PaperSetupService', () => {
    it('creates IndicatorInstance + PENDING_APPROVAL binding for a live-eligible signal', async () => {
        const prisma = makePrisma();
        const service = new PaperSetupService(prisma);

        const result = await service.setup(ACTOR, 'acct-1', {
            signalCode: 'SIG_TEST',
            signalVersion: 1,
            riskPercent: 0.5,
            symbol: 'XAUUSD',
            timeframe: 'H1',
        });

        assert.ok(result.instanceId, 'should return instanceId');
        assert.ok(result.bindingId, 'should return bindingId');
        assert.equal(result.signalCode, 'SIG_TEST');

        const spy = (prisma as unknown as ReturnType<typeof makePrisma> & { __spy: { createdInstances: unknown[]; createdBindings: unknown[] } }).__spy;
        const binding = spy.createdBindings[0] as Record<string, unknown>;
        assert.equal(binding.status, 'PENDING_APPROVAL', 'binding must start as PENDING_APPROVAL, not ACTIVE');
        assert.equal(binding.mode, 'AUTO_EXECUTE');
        const riskConfig = binding.riskConfigJson as Record<string, unknown>;
        assert.equal(riskConfig.riskPercent, 0.5);
    });

    it('rejects when the account does not belong to the actor', async () => {
        const prisma = makePrisma({ ownerUserId: 'other-user' });
        const service = new PaperSetupService(prisma);

        await assert.rejects(
            () => service.setup(ACTOR, 'acct-1', {
                signalCode: 'SIG_TEST', signalVersion: 1, riskPercent: 0.5, symbol: 'XAUUSD', timeframe: 'H1',
            }),
            (err: PaperSetupServiceError) => {
                assert.equal(err.statusCode, 404);
                return true;
            },
        );
    });

    it('rejects with 409 when the account is not PAPER mode', async () => {
        const prisma = makePrisma({ accountMode: 'LIVE' });
        const service = new PaperSetupService(prisma);

        await assert.rejects(
            () => service.setup(ACTOR, 'acct-1', {
                signalCode: 'SIG_TEST', signalVersion: 1, riskPercent: 0.5, symbol: 'XAUUSD', timeframe: 'H1',
            }),
            (err: PaperSetupServiceError) => {
                assert.equal(err.statusCode, 409);
                assert.equal(err.code, 'ACCOUNT_NOT_PAPER');
                return true;
            },
        );
    });

    it('rejects with 400 when the signal has no completed backtest', async () => {
        const prisma = makePrisma({ hasCompletedRun: false });
        const service = new PaperSetupService(prisma);

        await assert.rejects(
            () => service.setup(ACTOR, 'acct-1', {
                signalCode: 'SIG_TEST', signalVersion: 1, riskPercent: 0.5, symbol: 'XAUUSD', timeframe: 'H1',
            }),
            (err: PaperSetupServiceError) => {
                assert.equal(err.statusCode, 400);
                assert.equal(err.code, 'SIGNAL_NOT_ELIGIBLE');
                return true;
            },
        );
    });

    it('rejects with 400 when the signal is validated but not live-eligible', async () => {
        // 3 closed trades — not enough for live-eligible (needs >= 10)
        const thinResults = [
            { backtestRunId: 'run-1', isOpen: false, win: true, rMultiple: 2.0, maxDrawdownPct: -3.0 },
            { backtestRunId: 'run-1', isOpen: false, win: true, rMultiple: 2.0, maxDrawdownPct: -3.0 },
            { backtestRunId: 'run-1', isOpen: false, win: false, rMultiple: -0.5, maxDrawdownPct: -3.0 },
        ];
        const prisma = makePrisma({ tradeResults: thinResults });
        const service = new PaperSetupService(prisma);

        await assert.rejects(
            () => service.setup(ACTOR, 'acct-1', {
                signalCode: 'SIG_TEST', signalVersion: 1, riskPercent: 0.5, symbol: 'XAUUSD', timeframe: 'H1',
            }),
            (err: PaperSetupServiceError) => {
                assert.equal(err.statusCode, 400);
                assert.ok(err.message.toLowerCase().includes('not live-eligible') || err.code === 'SIGNAL_NOT_ELIGIBLE');
                return true;
            },
        );
    });

    it('auto-calculates guardrails from riskPercent (maxDailyLossPct = 3x risk)', async () => {
        const prisma = makePrisma();
        const service = new PaperSetupService(prisma);

        await service.setup(ACTOR, 'acct-1', {
            signalCode: 'SIG_TEST',
            signalVersion: 1,
            riskPercent: 1.5,
            symbol: 'XAUUSD',
            timeframe: 'H1',
        });

        const spy = (prisma as unknown as ReturnType<typeof makePrisma> & { __spy: { createdInstances: unknown[]; createdBindings: unknown[] } }).__spy;
        const binding = spy.createdBindings[0] as Record<string, unknown>;
        const guardrails = binding.guardrailsJson as Record<string, unknown>;
        assert.equal(guardrails.maxDailyLossPct, 4.5, 'maxDailyLossPct should be 3 × riskPercent');
        assert.equal(guardrails.killSwitchDrawdownPct, 15, 'killSwitch default is 15%');
    });
});
