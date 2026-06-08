import crypto from 'crypto';

export interface MT5CredentialPayload {
    mt5Login: string;
    mt5Password: string;
    mt5Server: string;
}

export class MT5CredentialCipherError extends Error {
    constructor(
        public readonly code:
            | 'ENCRYPTION_KEY_REQUIRED'
            | 'INVALID_CREDENTIAL_PAYLOAD'
            | 'INVALID_CIPHERTEXT',
        message: string,
    ) {
        super(message);
        this.name = 'MT5CredentialCipherError';
    }
}

function resolveEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
    const rawKey = env.ENCRYPTION_KEY?.trim() ?? '';
    if (rawKey.length < 32) {
        throw new MT5CredentialCipherError(
            'ENCRYPTION_KEY_REQUIRED',
            'ENCRYPTION_KEY must be configured with at least 32 characters before MT5 credentials can be stored.',
        );
    }

    return crypto.createHash('sha256').update(rawKey, 'utf8').digest();
}

function normalizeCredentialValue(value: unknown, fieldName: keyof MT5CredentialPayload): string {
    if (typeof value !== 'string') {
        throw new MT5CredentialCipherError(
            'INVALID_CREDENTIAL_PAYLOAD',
            `${fieldName} is required.`,
        );
    }

    const normalized = value.trim();
    if (!normalized) {
        throw new MT5CredentialCipherError(
            'INVALID_CREDENTIAL_PAYLOAD',
            `${fieldName} is required.`,
        );
    }

    return normalized;
}

export class MT5CredentialCipher {
    constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

    encrypt(payload: MT5CredentialPayload): string {
        const normalized: MT5CredentialPayload = {
            mt5Login: normalizeCredentialValue(payload.mt5Login, 'mt5Login'),
            mt5Password: normalizeCredentialValue(payload.mt5Password, 'mt5Password'),
            mt5Server: normalizeCredentialValue(payload.mt5Server, 'mt5Server'),
        };
        const key = resolveEncryptionKey(this.env);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(normalized), 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    decrypt(ciphertext: string): MT5CredentialPayload {
        const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
        if (!ivHex || !authTagHex || !encryptedHex) {
            throw new MT5CredentialCipherError(
                'INVALID_CIPHERTEXT',
                'Stored MT5 credential is malformed and cannot be decrypted.',
            );
        }

        const key = resolveEncryptionKey(this.env);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encryptedHex, 'hex')),
            decipher.final(),
        ]);
        const parsed = JSON.parse(decrypted.toString('utf8')) as Partial<MT5CredentialPayload>;

        return {
            mt5Login: normalizeCredentialValue(parsed.mt5Login, 'mt5Login'),
            mt5Password: normalizeCredentialValue(parsed.mt5Password, 'mt5Password'),
            mt5Server: normalizeCredentialValue(parsed.mt5Server, 'mt5Server'),
        };
    }
}
