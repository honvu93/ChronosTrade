import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    isValidContractKind,
    TradingOutputContractService,
} from './TradingOutputContractService';

describe('TradingOutputContractService', () => {
    const service = new TradingOutputContractService();

    describe('listContracts', () => {
        it('returns all four contract definitions', () => {
            const contracts = service.listContracts();

            assert.equal(contracts.length, 4);
            const kinds = contracts.map((c) => c.kind);
            assert.deepEqual(kinds, [
                'signal-event',
                'execution-event',
                'trade-outcome',
                'investigation-outcome',
            ]);
        });

        it('includes version, label, description, and fields for each contract', () => {
            const contracts = service.listContracts();

            for (const contract of contracts) {
                assert.equal(typeof contract.version, 'number');
                assert.ok(contract.version >= 1);
                assert.equal(typeof contract.label, 'string');
                assert.ok(contract.label.length > 0);
                assert.equal(typeof contract.description, 'string');
                assert.ok(contract.description.length > 0);
                assert.ok(Array.isArray(contract.fields));
                assert.ok(contract.fields.length > 0);
            }
        });

        it('documents the shared output envelope fields for every contract', () => {
            const contracts = service.listContracts();
            const requiredEnvelopeFields = [
                'contractKind',
                'contractVersion',
                'recordId',
                'signalKey',
                'emittedAt',
                'payload',
            ];

            for (const contract of contracts) {
                for (const fieldName of requiredEnvelopeFields) {
                    const field = contract.fields.find((item) => item.name === fieldName);
                    assert.ok(field, `${contract.kind} missing ${fieldName}`);
                    assert.equal(field.required, true);
                }
            }
        });

        it('every field has name, type, required, and description', () => {
            const contracts = service.listContracts();

            for (const contract of contracts) {
                for (const field of contract.fields) {
                    assert.equal(typeof field.name, 'string');
                    assert.equal(typeof field.type, 'string');
                    assert.equal(typeof field.required, 'boolean');
                    assert.equal(typeof field.description, 'string');
                }
            }
        });

        it('all contracts include payload.signalCode and payload.signalVersion as required fields', () => {
            const contracts = service.listContracts();

            for (const contract of contracts) {
                const signalCode = contract.fields.find((f) => f.name === 'payload.signalCode');
                const signalVersion = contract.fields.find((f) => f.name === 'payload.signalVersion');
                assert.ok(signalCode, `${contract.kind} missing payload.signalCode field`);
                assert.ok(signalVersion, `${contract.kind} missing payload.signalVersion field`);
                assert.equal(signalCode.required, true);
                assert.equal(signalVersion.required, true);
            }
        });

        it('returns cloned contract definitions so callers cannot mutate the source schema', () => {
            const firstRead = service.listContracts();
            firstRead[0].label = 'Mutated';
            firstRead[0].fields[0].description = 'Mutated';

            const secondRead = service.listContracts();

            assert.equal(secondRead[0].label, 'Signal Event');
            assert.notEqual(secondRead[0].fields[0].description, 'Mutated');
        });
    });

    describe('getContract', () => {
        it('returns the contract for a valid kind', () => {
            const contract = service.getContract('signal-event');

            assert.ok(contract);
            assert.equal(contract.kind, 'signal-event');
            assert.equal(contract.label, 'Signal Event');
        });

        it('returns a cloned contract definition', () => {
            const firstRead = service.getContract('signal-event');
            assert.ok(firstRead);
            firstRead.label = 'Mutated';

            const secondRead = service.getContract('signal-event');

            assert.ok(secondRead);
            assert.equal(secondRead.label, 'Signal Event');
        });

        it('returns null for an unknown kind', () => {
            const contract = service.getContract('unknown' as never);

            assert.equal(contract, null);
        });
    });

    describe('isValidContractKind', () => {
        it('accepts valid contract kinds', () => {
            assert.equal(isValidContractKind('signal-event'), true);
            assert.equal(isValidContractKind('execution-event'), true);
            assert.equal(isValidContractKind('trade-outcome'), true);
            assert.equal(isValidContractKind('investigation-outcome'), true);
        });

        it('rejects invalid values', () => {
            assert.equal(isValidContractKind('unknown'), false);
            assert.equal(isValidContractKind(''), false);
            assert.equal(isValidContractKind(42), false);
            assert.equal(isValidContractKind(null), false);
            assert.equal(isValidContractKind(undefined), false);
        });
    });

    describe('shapeSignalEventEnvelope', () => {
        it('wraps a signal event payload in a stable envelope', () => {
            const envelope = service.shapeSignalEventEnvelope(
                'evt-1',
                'songTrap@v3',
                {
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    signalId: 'signal-1',
                    symbol: 'XAUUSD',
                    timeframe: 'H1',
                    side: 'LONG',
                    session: 'LONDON',
                    eventType: 'ENTRY_CONFIRMED',
                    occurredAt: '2026-03-11T08:00:00.000Z',
                    backtestRunId: 'run-1',
                    indicatorInstanceId: null,
                },
            );

            assert.equal(envelope.contractKind, 'signal-event');
            assert.equal(envelope.contractVersion, 1);
            assert.equal(envelope.recordId, 'evt-1');
            assert.equal(envelope.signalKey, 'songTrap@v3');
            assert.equal(typeof envelope.emittedAt, 'string');
            assert.equal(envelope.payload.signalCode, 'songTrap');
            assert.equal(envelope.payload.signalVersion, 3);
            assert.equal(envelope.payload.symbol, 'XAUUSD');
            assert.equal(envelope.payload.backtestRunId, 'run-1');
        });

        it('strips undocumented fields from signal payloads', () => {
            const payload = {
                signalCode: 'songTrap',
                signalVersion: 3,
                signalId: 'signal-1',
                symbol: 'XAUUSD',
                timeframe: 'H1',
                side: 'LONG',
                session: 'LONDON',
                eventType: 'ENTRY_CONFIRMED',
                occurredAt: '2026-03-11T08:00:00.000Z',
                backtestRunId: 'run-1',
                indicatorInstanceId: null,
                internalOnly: 'should-not-leak',
            };

            const envelope = service.shapeSignalEventEnvelope(
                'evt-1',
                'songTrap@v3',
                payload as never,
            );

            assert.equal('internalOnly' in envelope.payload, false);
            assert.equal('internalOnly' in payload, true);
        });
    });

    describe('shapeExecutionEventEnvelope', () => {
        it('wraps an execution event payload with traceability', () => {
            const envelope = service.shapeExecutionEventEnvelope(
                'trace-1',
                'songTrap@v3',
                {
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    eventType: 'ENTRY_CONFIRMED',
                    kind: 'decision',
                    occurredAt: '2026-03-11T08:00:00.000Z',
                    label: 'Rule matched',
                    stateBefore: 'WAITING',
                    stateAfter: 'ENTERED',
                    backtestRunId: 'run-1',
                    indicatorInstanceId: 'inst-1',
                    tradeRecordId: 'trade-1',
                },
            );

            assert.equal(envelope.contractKind, 'execution-event');
            assert.equal(envelope.contractVersion, 1);
            assert.equal(envelope.recordId, 'trace-1');
            assert.equal(envelope.payload.kind, 'decision');
            assert.equal(envelope.payload.tradeRecordId, 'trade-1');
        });
    });

    describe('shapeTradeOutcomeEnvelope', () => {
        it('wraps a trade outcome with P&L and traceability', () => {
            const envelope = service.shapeTradeOutcomeEnvelope(
                'result-1',
                'songTrap@v3',
                {
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    symbol: 'XAUUSD',
                    timeframe: 'H1',
                    side: 'LONG',
                    result: 'WIN',
                    exitReason: 'TAKE_PROFIT_1',
                    rMultiple: 1.4,
                    pnlUsd: 320,
                    entryTime: '2026-03-11T08:00:00.000Z',
                    exitTime: '2026-03-11T09:00:00.000Z',
                    backtestRunId: 'run-1',
                    tradeRecordId: 'result-1',
                },
            );

            assert.equal(envelope.contractKind, 'trade-outcome');
            assert.equal(envelope.contractVersion, 1);
            assert.equal(envelope.payload.result, 'WIN');
            assert.equal(envelope.payload.pnlUsd, 320);
            assert.equal(envelope.payload.backtestRunId, 'run-1');
            assert.equal(envelope.payload.tradeRecordId, 'result-1');
        });
    });

    describe('shapeInvestigationOutcomeEnvelope', () => {
        it('wraps an investigation outcome with diagnosis traceability', () => {
            const envelope = service.shapeInvestigationOutcomeEnvelope(
                'diag-1',
                'songTrap@v3',
                {
                    signalCode: 'songTrap',
                    signalVersion: 3,
                    rootCauseCategory: 'broker-execution',
                    outcome: 'escalated',
                    summary: 'Broker rejected the stop update.',
                    decidedAt: '2026-03-11T09:00:00.000Z',
                    backtestRunId: 'run-1',
                    indicatorInstanceId: 'inst-1',
                    tradeRecordId: 'trade-1',
                },
            );

            assert.equal(envelope.contractKind, 'investigation-outcome');
            assert.equal(envelope.contractVersion, 1);
            assert.equal(envelope.payload.rootCauseCategory, 'broker-execution');
            assert.equal(envelope.payload.outcome, 'escalated');
            assert.equal(envelope.payload.tradeRecordId, 'trade-1');
        });
    });
});
