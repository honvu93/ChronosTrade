import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    hydrateAuthorizedUserUnlessIngestion,
    isIngestionTokenRequest,
    requireAppAuthenticationOrIngestion,
} from './auth';

describe('ingestion auth helpers', () => {
    it('recognizes requests signed with the ingestion token', () => {
        const request = {
            headers: {
                authorization: 'Bearer ingestion-secret',
            },
        };

        assert.equal(
            isIngestionTokenRequest(request as never, { INGESTION_TOKEN: 'ingestion-secret' }),
            true,
        );
        assert.equal(
            isIngestionTokenRequest(request as never, { INGESTION_TOKEN: 'different-secret' }),
            false,
        );
    });

    it('allows ingestion-token requests without requiring a user session', () => {
        const middleware = requireAppAuthenticationOrIngestion({ INGESTION_TOKEN: 'ingestion-secret' });
        const request = {
            headers: {
                authorization: 'Bearer ingestion-secret',
            },
        };
        const response = {
            locals: {},
        };

        let nextCalled = false;
        middleware(request as never, response as never, (() => {
            nextCalled = true;
        }) as never);

        assert.equal(nextCalled, true);
        assert.deepEqual(response.locals, {
            internalServiceAuth: {
                kind: 'ingestion-token',
            },
        });
    });

    it('skips user hydration when the request already authenticated as an internal service', async () => {
        const middleware = hydrateAuthorizedUserUnlessIngestion({} as never);
        const response = {
            locals: {
                internalServiceAuth: {
                    kind: 'ingestion-token' as const,
                },
            },
        };

        let nextCalled = false;
        await middleware({} as never, response as never, (() => {
            nextCalled = true;
        }) as never);

        assert.equal(nextCalled, true);
    });
});
