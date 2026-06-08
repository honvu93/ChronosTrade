import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getTimeframeAliases,
    normalizeTimeframe,
} from './timeframes';

test('normalizeTimeframe canonicalizes MT5 and legacy timeframe spellings', () => {
    assert.equal(normalizeTimeframe('M30'), '30m');
    assert.equal(normalizeTimeframe('m30'), '30m');
    assert.equal(normalizeTimeframe('H2'), '2h');
    assert.equal(normalizeTimeframe('h3'), '3h');
    assert.equal(normalizeTimeframe('H12'), '12h');
    assert.equal(normalizeTimeframe('D3'), '3d');
    assert.equal(normalizeTimeframe('MN1'), '1M');
});

test('normalizeTimeframe keeps minute and month distinct', () => {
    assert.equal(normalizeTimeframe('M1'), '1m');
    assert.equal(normalizeTimeframe('1m'), '1m');
    assert.equal(normalizeTimeframe('1M'), '1M');
});

test('getTimeframeAliases includes legacy stored keys without changing canonical order', () => {
    assert.deepEqual(getTimeframeAliases('30m'), ['30m', 'm30', 'M30']);
    assert.deepEqual(getTimeframeAliases('H2'), ['2h', 'h2', 'H2']);
});
