const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';

export type TrustProxySetting = boolean | number | string | string[];

export function resolveTrustProxySetting(
    env: NodeJS.ProcessEnv = process.env,
): TrustProxySetting {
    const raw = env.TRUST_PROXY?.trim();
    if (!raw) {
        return DEFAULT_TRUST_PROXY;
    }

    const normalized = raw.toLowerCase();
    if (normalized === 'true') {
        return true;
    }
    if (normalized === 'false') {
        return false;
    }
    if (/^\d+$/.test(raw)) {
        return Number(raw);
    }
    if (raw.includes(',')) {
        return raw
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
    }

    return raw;
}

export function describeTrustProxySetting(setting: TrustProxySetting): string {
    if (Array.isArray(setting)) {
        return setting.join(', ');
    }

    return String(setting);
}

