import { PrismaClient } from '@prisma/client';
import { getMarketSymbolAliases } from '../../utils/symbols';
import { getTimeframeAliases } from '../../utils/timeframes';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;        // check moi 5 phut
const STALE_THRESHOLD_MS = 15 * 60 * 1000;       // alert neu data > 15 phut
const COOLDOWN_MS = 30 * 60 * 1000;              // khong gui lai trong 30 phut

const WATCHED_PAIRS = [
    { symbol: 'XAUUSD', timeframe: '5m' },
    { symbol: 'XAGUSD', timeframe: '5m' },
    { symbol: 'BTCUSD', timeframe: '5m' },
];

interface StaleInfo {
    symbol: string;
    timeframe: string;
    lastSync: Date | null;
    staleMinutes: number;
}

export class SyncAlertService {
    private timer: ReturnType<typeof setInterval> | null = null;
    private lastAlertAt = 0;
    private wasStale = false;

    constructor(private prisma: PrismaClient) {}

    start(): void {
        if (!process.env.ALERT_TELEGRAM_BOT_TOKEN || !process.env.ALERT_TELEGRAM_CHAT_ID) {
            console.log('[SyncAlert] Disabled — set ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID in .env to enable');
            return;
        }
        console.log('[SyncAlert] Started — checking every 5m, alert if data stale > 15m');
        this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
        // first check after 2 minutes (give startup sync time to finish)
        setTimeout(() => this.check(), 2 * 60 * 1000);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async check(): Promise<void> {
        try {
            const now = new Date();
            const isWeekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;

            const staleItems: StaleInfo[] = [];

            for (const { symbol, timeframe } of WATCHED_PAIRS) {
                // skip metals on weekend
                if (isWeekend && symbol !== 'BTCUSD') continue;

                const symbolAliases = getMarketSymbolAliases(symbol);
                const timeframeAliases = getTimeframeAliases(timeframe);

                const agg = await this.prisma.candle.aggregate({
                    where: {
                        symbol: symbolAliases.length === 1 ? symbolAliases[0] : { in: symbolAliases },
                        timeframe: timeframeAliases.length === 1 ? timeframeAliases[0] : { in: timeframeAliases },
                    },
                    _max: { time: true },
                });

                const lastSync = agg._max.time;
                const staleMs = lastSync ? now.getTime() - lastSync.getTime() : Infinity;

                if (staleMs > STALE_THRESHOLD_MS) {
                    staleItems.push({
                        symbol,
                        timeframe,
                        lastSync,
                        staleMinutes: Math.round(staleMs / 60_000),
                    });
                }
            }

            if (staleItems.length > 0) {
                // cooldown: don't spam
                if (now.getTime() - this.lastAlertAt < COOLDOWN_MS) return;

                this.wasStale = true;
                this.lastAlertAt = now.getTime();
                await this.sendAlert(staleItems);
            } else if (this.wasStale) {
                // recovered — send one recovery message
                this.wasStale = false;
                await this.sendRecovery();
            }
        } catch (err) {
            console.error('[SyncAlert] Check failed:', err);
        }
    }

    private async sendAlert(items: StaleInfo[]): Promise<void> {
        const lines = items.map((item) => {
            const ago = item.lastSync
                ? `${item.staleMinutes}m ago`
                : 'no data';
            return `  ⚠ ${item.symbol}/${item.timeframe} — last sync: ${ago}`;
        });

        const text = [
            '🔴 Data sync stopped',
            '',
            ...lines,
            '',
            'Check: Windows MT5 script running?',
        ].join('\n');

        console.warn(`[SyncAlert] ${items.length} stale pair(s) — sending Telegram alert`);
        await this.sendTelegram(text);
    }

    private async sendRecovery(): Promise<void> {
        const text = '🟢 Data sync recovered — all symbols receiving data again';
        console.log('[SyncAlert] Sync recovered — sending Telegram notification');
        await this.sendTelegram(text);
    }

    private async sendTelegram(text: string): Promise<void> {
        const token = process.env.ALERT_TELEGRAM_BOT_TOKEN;
        const chatId = process.env.ALERT_TELEGRAM_CHAT_ID;
        if (!token || !chatId) return;

        try {
            const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text,
                    parse_mode: 'HTML',
                }),
                signal: AbortSignal.timeout(10_000),
            });

            if (!resp.ok) {
                const body = await resp.text();
                console.error(`[SyncAlert] Telegram error ${resp.status}: ${body}`);
            }
        } catch (err) {
            console.error('[SyncAlert] Telegram send failed:', err);
        }
    }
}
