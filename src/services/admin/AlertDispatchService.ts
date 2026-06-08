import IORedis from 'ioredis';

const CHANNEL = 'system:alerts';

interface SystemAlert {
    source?: string;
    event?: string;
    instanceId?: string;
    message?: string;
    timestamp?: string;
    [key: string]: unknown;
}

/**
 * AlertDispatchService
 *
 * Subscribes to the `system:alerts` Redis pub/sub channel and forwards
 * critical alerts to the admin Telegram chat.
 *
 * Requires separate Redis subscriber instance (IORedis cannot be used
 * for both pub/sub and regular commands on the same connection).
 *
 * Env vars: ALERT_TELEGRAM_BOT_TOKEN, ALERT_TELEGRAM_CHAT_ID
 */
export class AlertDispatchService {
    private subscriber: IORedis | null = null;

    constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

    start(redisUrl: string): void {
        if (!this.env.ALERT_TELEGRAM_BOT_TOKEN || !this.env.ALERT_TELEGRAM_CHAT_ID) {
            console.log('[AlertDispatch] Disabled — set ALERT_TELEGRAM_BOT_TOKEN and ALERT_TELEGRAM_CHAT_ID to enable.');
            return;
        }

        this.subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

        this.subscriber.on('error', (err) => {
            console.error('[AlertDispatch] Redis subscriber error:', err.message);
        });

        this.subscriber.subscribe(CHANNEL, (err) => {
            if (err) {
                console.error(`[AlertDispatch] Failed to subscribe to ${CHANNEL}:`, err.message);
            } else {
                console.log(`[AlertDispatch] Subscribed to ${CHANNEL}. Forwarding alerts to Telegram.`);
            }
        });

        this.subscriber.on('message', (channel, message) => {
            if (channel !== CHANNEL) return;
            void this.handleAlert(message);
        });
    }

    stop(): void {
        if (this.subscriber) {
            this.subscriber.disconnect();
            this.subscriber = null;
        }
    }

    private async handleAlert(raw: string): Promise<void> {
        let alert: SystemAlert;
        try {
            alert = JSON.parse(raw) as SystemAlert;
        } catch {
            alert = { message: raw };
        }

        const source = alert.source ?? 'unknown';
        const event = alert.event ?? 'alert';
        const message = alert.message ?? raw;
        const ts = alert.timestamp ? new Date(alert.timestamp).toUTCString() : new Date().toUTCString();

        const text = `🔴 <b>System Alert</b>\n`
            + `<b>Source:</b> ${escapeHtml(source)}\n`
            + `<b>Event:</b> ${escapeHtml(event)}\n`
            + `<b>Message:</b> ${escapeHtml(message)}\n`
            + `<b>At:</b> ${ts}`;

        await this.sendTelegram(text);
    }

    private async sendTelegram(text: string): Promise<void> {
        const token = this.env.ALERT_TELEGRAM_BOT_TOKEN;
        const chatId = this.env.ALERT_TELEGRAM_CHAT_ID;
        if (!token || !chatId) return;

        try {
            const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
                signal: AbortSignal.timeout(10_000),
            });

            if (!resp.ok) {
                const body = await resp.text();
                console.error(`[AlertDispatch] Telegram error ${resp.status}: ${body}`);
            }
        } catch (err) {
            console.error('[AlertDispatch] Telegram send failed:', err instanceof Error ? err.message : err);
        }
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
