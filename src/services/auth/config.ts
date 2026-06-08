import crypto from 'crypto';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

const PRODUCTION_NODE_ENVS = new Set(['production', 'prod']);
let generatedDevJwtSecret: string | null = null;
let warnedAboutGeneratedDevJwtSecret = false;

export const isProductionAuthRuntime = (
    env: NodeJS.ProcessEnv = process.env,
) => PRODUCTION_NODE_ENVS.has((env.NODE_ENV || '').trim().toLowerCase());

export const resolveBootstrapAdminPassword = (
    env: NodeJS.ProcessEnv = process.env,
) => {
    const password = env.AUTH_BOOTSTRAP_ADMIN_PASSWORD?.trim();
    return password && password.length > 0 ? password : null;
};

export const resolveJwtSecret = (
    env: NodeJS.ProcessEnv = process.env,
) => {
    const configured = env.JWT_SECRET?.trim();
    if (configured) {
        return configured;
    }

    if (isProductionAuthRuntime(env)) {
        throw new Error(
            'JWT_SECRET must be explicitly set before running ChronosTrade in production.',
        );
    }

    if (!generatedDevJwtSecret) {
        generatedDevJwtSecret = crypto.randomBytes(48).toString('base64url');
    }

    if (!warnedAboutGeneratedDevJwtSecret) {
        warnedAboutGeneratedDevJwtSecret = true;
        console.warn('[Auth] JWT_SECRET is not configured. Generated an ephemeral development secret for this process.');
    }

    return generatedDevJwtSecret;
};

export function assertAuthReleaseCutConfig(
    env: NodeJS.ProcessEnv = process.env,
) {
    if (!isProductionAuthRuntime(env)) {
        return;
    }

    const jwtSecret = env.JWT_SECRET?.trim();
    if (!jwtSecret) {
        throw new Error(
            'JWT_SECRET must be explicitly set before running ChronosTrade in production.',
        );
    }

    const bootstrapPassword = resolveBootstrapAdminPassword(env);
    if (!bootstrapPassword) {
        throw new Error(
            'AUTH_BOOTSTRAP_ADMIN_PASSWORD must be explicitly set before running ChronosTrade in production.',
        );
    }
}

