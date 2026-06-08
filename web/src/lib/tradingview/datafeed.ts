import { io, Socket } from 'socket.io-client';
import { resolveSocketUrl } from '@/lib/socketUrl';


const RESOLUTION_MAP: Record<string, string> = {
    '1': '1m',
    '5': '5m',
    '15': '15m',
    '30': '30m',
    '60': '1h',
    '240': '4h',
    '720': '12h',
    '1D': '1d',
    '3D': '3d',
    '1W': '1w',
    '1M': '1M',
};

export class MarketDatafeed {
    private _subs = new Map<string, Socket>();
    private _apiBase: string;

    constructor(apiBase = '/udf') {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
        this._apiBase = baseUrl + apiBase;
    }

    onReady(callback: (config: any) => void) {
        fetch(`${this._apiBase}/config`)
            .then(r => r.json())
            .then(config => setTimeout(() => callback(config), 0))
            .catch(err => console.error('[Datafeed] onReady error:', err));
    }

    searchSymbols(userInput: string, exchange: string, symbolType: string, onResultReadyCallback: any) {
        fetch(`${this._apiBase}/search?query=${userInput}&exchange=${exchange}&type=${symbolType}&limit=10`)
            .then(r => r.json())
            .then(onResultReadyCallback)
            .catch(err => console.error('[Datafeed] searchSymbols error:', err));
    }

    resolveSymbol(symbolName: string, onSymbolResolvedCallback: any, onResolveErrorCallback: any) {
        fetch(`${this._apiBase}/symbols?symbol=${encodeURIComponent(symbolName)}`)
            .then(r => r.json())
            .then(info => setTimeout(() => onSymbolResolvedCallback(info), 0))
            .catch(err => {
                console.error('[Datafeed] resolveSymbol error:', err);
                onResolveErrorCallback('Symbol not found');
            });
    }

    getBars(symbolInfo: any, resolution: string, periodParams: any, onHistoryCallback: any, onErrorCallback: any) {
        const { from, to, countBack, firstDataRequest } = periodParams;
        const params = new URLSearchParams({
            symbol: symbolInfo.full_name,
            resolution,
            from: String(from),
            to: String(to),
            countback: String(countBack),
        });

        fetch(`${this._apiBase}/history?${params}`)
            .then(r => r.json())
            .then(data => {
                if (data.s === 'no_data') {
                    onHistoryCallback([], { noData: true, nextTime: data.nextTime });
                    return;
                }

                if (data.s === 'error') {
                    onErrorCallback(data.errmsg);
                    return;
                }

                const bars = data.t.map((t: number, i: number) => ({
                    time: t * 1000,
                    open: data.o[i],
                    high: data.h[i],
                    low: data.l[i],
                    close: data.c[i],
                    volume: data.v[i],
                }));

                onHistoryCallback(bars, { noData: false });
            })
            .catch(err => {
                console.error('[Datafeed] getBars error:', err);
                onErrorCallback(err);
            });
    }

    subscribeBars(symbolInfo: any, resolution: string, onRealtimeCallback: any, subscriberUID: string) {
        const timeframe = RESOLUTION_MAP[resolution] || '1h';
        const socketUrl = resolveSocketUrl();
        const socket = io(socketUrl, {
            withCredentials: true,
        });

        socket.emit('subscribe', { symbol: symbolInfo.name, timeframe });

        socket.on('tick', (tick: any) => {
            // tick should be in the format { time, open, high, low, close, volume }
            // time is in seconds
            onRealtimeCallback({
                time: tick.time * 1000,
                open: tick.open,
                high: tick.high,
                low: tick.low,
                close: tick.close,
                volume: tick.volume,
            });
        });

        this._subs.set(subscriberUID, socket);
    }

    unsubscribeBars(subscriberUID: string) {
        const socket = this._subs.get(subscriberUID);
        if (socket) {
            socket.disconnect();
            this._subs.delete(subscriberUID);
        }
    }
}
