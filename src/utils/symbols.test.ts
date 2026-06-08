import test from 'node:test';
import assert from 'node:assert/strict';
import {
    dedupeMarketSymbolRowsByTime,
    getMarketSymbolAliases,
    normalizeMarketSymbol,
    normalizeSymbol,
} from './symbols';
import { getTimeframeAliases } from './timeframes';

test('normalizeSymbol preserves lowercase contract suffix c', () => {
    assert.equal(normalizeSymbol('XAUUSDC'), 'XAUUSDc');
    assert.equal(normalizeSymbol(' btcusdc '), 'BTCUSDc');
});

test('normalizeMarketSymbol canonicalizes MT5 contract aliases', () => {
    assert.equal(normalizeMarketSymbol('XAUUSDc'), 'XAUUSD');
    assert.equal(normalizeMarketSymbol('XAGUSDc'), 'XAGUSD');
    assert.equal(normalizeMarketSymbol('BTCUSDc'), 'BTCUSD');
    assert.equal(normalizeMarketSymbol('XAUUSD'), 'XAUUSD');
    assert.deepEqual(getMarketSymbolAliases('XAUUSD'), ['XAUUSD', 'XAUUSDc']);
});

test('dedupeMarketSymbolRowsByTime prefers canonical rows for the same timestamp', () => {
    const timestamp = new Date('2026-03-12T00:00:00.000Z');
    const rows = [
        { symbol: 'XAUUSD', time: timestamp, close: 2900 },
        { symbol: 'XAUUSDc', time: timestamp, close: 2901 },
        { symbol: 'XAUUSD', time: new Date('2026-03-12T01:00:00.000Z'), close: 2902 },
    ];

    const deduped = dedupeMarketSymbolRowsByTime(rows, 'XAUUSD');

    assert.equal(deduped.length, 2);
    assert.equal(deduped[0].symbol, 'XAUUSD');
    assert.equal(deduped[0].close, 2900);
});

test('dedupeMarketSymbolRowsByTime prefers canonical timeframe rows when legacy aliases overlap', () => {
    const timestamp = new Date('2026-03-12T00:00:00.000Z');
    const rows = [
        { symbol: 'XAUUSDc', timeframe: 'm30', time: timestamp, close: 2900 },
        { symbol: 'XAUUSDc', timeframe: '30m', time: timestamp, close: 2901 },
    ];

    const deduped = dedupeMarketSymbolRowsByTime(rows, 'XAUUSD', {
        preferredTimeframeAliases: getTimeframeAliases('30m'),
    });

    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].timeframe, '30m');
    assert.equal(deduped[0].close, 2901);
});
