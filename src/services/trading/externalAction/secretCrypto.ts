import crypto from 'crypto';

import { ExternalActionError } from './types';

function resolveEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
    const rawKey = env.ENCRYPTION_KEY?.trim() ?? '';
    if (rawKey.length < 32) {
        throw new ExternalActionError(
            'EXTERNAL_ACTION_INPUT_INVALID',
            500,
            'ENCRYPTION_KEY must be configured with at least 32 characters for Telegram bot secret storage.',
        );
    }

    return crypto.createHash('sha256').update(rawKey, 'utf8').digest();
}

export function encryptSecret(value: string, env: NodeJS.ProcessEnv): string {
    const key = resolveEncryptionKey(env);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(value: string, env: NodeJS.ProcessEnv): string {
    const key = resolveEncryptionKey(env);
    const [ivHex, authTagHex, encryptedHex] = value.split(':');

    if (!ivHex || !authTagHex || !encryptedHex) {
        throw new ExternalActionError(
            'EXTERNAL_ACTION_INPUT_INVALID',
            500,
            'Stored Telegram bot secret is malformed and cannot be decrypted.',
        );
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final(),
    ]);
    return decrypted.toString('utf8');
}
