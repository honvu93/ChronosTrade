import crypto from 'crypto';

const HASH_KEYLEN = 64;
const HASH_ALGORITHM = 'sha512';

const scryptAsync = (
    password: string,
    salt: string,
) => new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, HASH_KEYLEN, (error, derivedKey) => {
        if (error) {
            reject(error);
            return;
        }

        resolve(derivedKey);
    });
});

export const createPasswordSalt = () => crypto.randomBytes(16).toString('hex');

export async function hashPassword(password: string, salt = createPasswordSalt()) {
    const normalizedPassword = password.normalize('NFKC');
    const derived = await scryptAsync(normalizedPassword, salt);
    return {
        salt,
        hash: crypto.createHash(HASH_ALGORITHM).update(derived).digest('hex'),
    };
}

export async function verifyPassword(
    password: string,
    expectedHash: string,
    salt: string,
) {
    const candidate = await hashPassword(password, salt);
    const received = Buffer.from(candidate.hash, 'hex');
    const expected = Buffer.from(expectedHash, 'hex');

    if (received.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(received, expected);
}

