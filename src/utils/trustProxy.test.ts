import test from 'node:test';
import assert from 'node:assert/strict';
import {
    describeTrustProxySetting,
    resolveTrustProxySetting,
} from './trustProxy';

test('resolveTrustProxySetting defaults to local proxy ranges', () => {
    assert.equal(
        resolveTrustProxySetting({}),
        'loopback, linklocal, uniquelocal',
    );
});

test('resolveTrustProxySetting parses boolean and hop count values', () => {
    assert.equal(resolveTrustProxySetting({ TRUST_PROXY: 'true' }), true);
    assert.equal(resolveTrustProxySetting({ TRUST_PROXY: 'false' }), false);
    assert.equal(resolveTrustProxySetting({ TRUST_PROXY: '2' }), 2);
});

test('resolveTrustProxySetting parses comma-separated proxy lists', () => {
    assert.deepEqual(
        resolveTrustProxySetting({ TRUST_PROXY: 'loopback, 10.0.0.0/8, 172.16.0.0/12' }),
        ['loopback', '10.0.0.0/8', '172.16.0.0/12'],
    );
});

test('describeTrustProxySetting renders list settings for logs', () => {
    assert.equal(
        describeTrustProxySetting(['loopback', '10.0.0.0/8']),
        'loopback, 10.0.0.0/8',
    );
});

