import crypto from 'crypto';

import { decryptSecret } from './secretCrypto';
import {
    ExternalActionError,
    ExternalActionEventWithDeployment,
} from './types';

type TelegramFetchResponse = {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
};

export type TelegramFetchLike = (
    url: string,
    init: {
        method: 'POST';
        headers: Record<string, string>;
        body: string;
        signal: AbortSignal;
    },
) => Promise<TelegramFetchResponse>;

export interface TelegramDeliveryResult {
    providerMessageId: string | null;
    providerChatId: string | null;
    requestFingerprint: string;
    requestJson: Record<string, unknown>;
    responseJson: Record<string, unknown> | null;
}

export class TelegramExternalActionDeliveryService {
    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        private readonly fetchImpl: TelegramFetchLike = fetch as TelegramFetchLike,
    ) {}

    async deliver(event: ExternalActionEventWithDeployment): Promise<TelegramDeliveryResult> {
        const token = decryptSecret(event.deployment.telegramBotTokenCiphertext, this.env);
        const apiBaseUrl = (this.env.TELEGRAM_API_BASE_URL?.trim() || 'https://api.telegram.org').replace(/\/+$/, '');
        const url = `${apiBaseUrl}/bot${token}/sendMessage`;
        const requestJson = {
            chat_id: event.deployment.telegramChatId,
            text: this.renderMessage(event),
            disable_web_page_preview: true,
        };
        const body = JSON.stringify(requestJson);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        timeout.unref?.();

        try {
            const response = await this.fetchImpl(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body,
                signal: controller.signal,
            });

            const responseText = await response.text();
            let responseJson: Record<string, unknown> | null = null;
            try {
                const parsed = responseText.length > 0 ? JSON.parse(responseText) : null;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    responseJson = parsed as Record<string, unknown>;
                }
            } catch {
                responseJson = {
                    raw: responseText,
                };
            }

            if (!response.ok || responseJson?.ok === false) {
                throw new ExternalActionError(
                    'EXTERNAL_ACTION_TELEGRAM_FAILED',
                    502,
                    typeof responseJson?.description === 'string'
                        ? responseJson.description
                        : `Telegram delivery failed with HTTP ${response.status}.`,
                );
            }

            const result = responseJson?.result;
            const providerMessageId = result && typeof result === 'object' && !Array.isArray(result)
                && typeof (result as { message_id?: unknown }).message_id !== 'undefined'
                ? String((result as { message_id: unknown }).message_id)
                : null;
            const providerChatId = result && typeof result === 'object' && !Array.isArray(result)
                && typeof (result as { chat?: { id?: unknown } }).chat?.id !== 'undefined'
                ? String((result as { chat: { id: unknown } }).chat.id)
                : String(event.deployment.telegramChatId);

            return {
                providerMessageId,
                providerChatId,
                requestFingerprint: crypto.createHash('sha256').update(body, 'utf8').digest('hex'),
                requestJson,
                responseJson,
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    renderMessage(event: ExternalActionEventWithDeployment): string {
        const payload = event.payload;
        const sideIcon = payload.market.side === 'LONG' ? '🟢' : '🔴';
        const lines = [
            '🚨 Signal Alert',
            `🧠 ${payload.source.signalCode}@v${payload.source.signalVersion}`,
            `${sideIcon} ${payload.market.symbol} ${payload.market.timeframe} ${payload.market.side}`,
            '',
            `💰 Entry: ${this.formatNumber(payload.execution.entryPrice)}`,
            `🛑 Stop Loss: ${this.formatNumber(payload.execution.stopLoss)}`,
            `🎯 TP1: ${this.formatNumber(payload.execution.takeProfit1)}`,
            `🎯 TP2: ${this.formatNumber(payload.execution.takeProfit2)}`,
            '',
            `🕒 Emitted: ${payload.emittedAt}`,
            `🧷 Deployment: ${event.deployment.id}`,
            '⚠️ Signal only. Not guaranteed execution.',
        ];

        return lines.join('\n');
    }

    private formatNumber(value: number | null) {
        return value === null ? 'n/a' : value.toString();
    }
}
