import axios from 'axios';
import { io } from 'socket.io-client';

async function verifyPhase3() {
    const symbol = 'BTCUSD';
    console.log('--- Phase 3 Verification Tool ---');

    try {
        console.log('[Test] Fetching symbols...');
        const symbolsRes = await axios.get('http://localhost:3001/api/symbols');
        console.log('[OK] Symbols API:', symbolsRes.data);

        console.log(`[Test] Fetching ${symbol} 1h candles...`);
        const candlesRes = await axios.get(`http://localhost:3001/api/ohlcv/${symbol}?timeframe=1h&limit=5`);
        const candles = candlesRes.data as any[];
        console.log('[OK] OHLCV API count:', candles.length);
        if (candles.length > 0) {
            console.log('Sample candle:', candles[0]);
        }
    } catch (error: any) {
        console.error('[FAIL] REST API test:', error.message);
    }

    console.log('[Test] Connecting to Socket.io...');
    const socket = io('http://localhost:3001');

    socket.on('connect', () => {
        console.log('[OK] Socket.io connected');
        socket.emit('subscribe', { symbol, timeframe: '1m' });
    });

    socket.on('tick', (data) => {
        console.log('[OK] Live tick:', data.symbol || symbol, 'Price:', data.close);
        socket.disconnect();
        console.log('--- Phase 3 Verification Finished ---');
        process.exit(0);
    });

    socket.on('connect_error', (error) => {
        console.error('[FAIL] Socket.io connection:', error.message);
        process.exit(1);
    });

    setTimeout(() => {
        console.error('[FAIL] Timeout: no tick received from Socket.io');
        process.exit(1);
    }, 15000);
}

verifyPhase3();
