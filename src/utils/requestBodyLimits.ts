export const DEFAULT_JSON_BODY_LIMIT = '1mb';
export const SINGLE_INGEST_JSON_BODY_LIMIT = '10mb';
export const BATCH_INGEST_JSON_BODY_LIMIT = '50mb';

export function getJsonBodyLimitForPath(pathname: string): string {
    if (pathname === '/api/ohlcv/batch') {
        return BATCH_INGEST_JSON_BODY_LIMIT;
    }

    if (/^\/api\/ohlcv\/[^/]+$/.test(pathname)) {
        return SINGLE_INGEST_JSON_BODY_LIMIT;
    }

    return DEFAULT_JSON_BODY_LIMIT;
}
