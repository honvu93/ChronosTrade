import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    BATCH_INGEST_JSON_BODY_LIMIT,
    DEFAULT_JSON_BODY_LIMIT,
    getJsonBodyLimitForPath,
    SINGLE_INGEST_JSON_BODY_LIMIT,
} from './requestBodyLimits';

describe('getJsonBodyLimitForPath', () => {
    it('uses the batch limit for the batch ingestion endpoint', () => {
        assert.equal(getJsonBodyLimitForPath('/api/ohlcv/batch'), BATCH_INGEST_JSON_BODY_LIMIT);
    });

    it('uses the single-symbol ingest limit for direct ohlcv ingestion', () => {
        assert.equal(getJsonBodyLimitForPath('/api/ohlcv/BTCUSD'), SINGLE_INGEST_JSON_BODY_LIMIT);
    });

    it('keeps the default limit for non-ingestion api routes', () => {
        assert.equal(getJsonBodyLimitForPath('/api/trading/accounts'), DEFAULT_JSON_BODY_LIMIT);
    });

    it('keeps the default limit for nested non-matching ohlcv paths', () => {
        assert.equal(getJsonBodyLimitForPath('/api/ohlcv/batch/history'), DEFAULT_JSON_BODY_LIMIT);
    });
});
