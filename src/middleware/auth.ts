import crypto from 'crypto';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import {
    AuthModuleKey,
    AuthRoleKey,
    AuthSessionTokenPayload,
    AuthServiceError,
    buildFirstAllowedPath,
    normalizeAuthModuleKey,
} from '../services/auth/types';
import { resolveJwtSecret } from '../services/auth/config';

type JwtClaims = Record<string, unknown> & {
    sub?: string;
    exp?: number;
    nbf?: number;
    role?: AuthRoleKey;
    modules?: AuthModuleKey[];
};

export interface AuthenticatedRequestContext {
    token: string;
    subject: string | null;
    claims: JwtClaims | null;
    mode: 'jwt' | 'session-token';
}

export interface AuthorizedUserContext {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    role: AuthRoleKey;
    isActive: boolean;
    modules: AuthModuleKey[];
    firstAllowedPath: string | null;
}

export interface InternalServiceAuthContext {
    kind: 'ingestion-token';
}

type IngestionEnvSource = {
    INGESTION_TOKEN?: string;
};

const decodeBase64Url = (value: string): Buffer => {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    return Buffer.from(`${normalized}${'='.repeat(padding)}`, 'base64');
};

const parseJsonSegment = (value: string): Record<string, unknown> => {
    const decoded = decodeBase64Url(value).toString('utf8');
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JWT segment must decode to an object');
    }
    return parsed;
};

const encodeBase64Url = (value: Buffer) => value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const createAuthErrorResponse = (
    res: express.Response,
    status: number,
    code: string,
    message: string,
    domain = 'trading.auth',
    meta?: Record<string, unknown>,
) => res.status(status).json({
    success: false,
    error: {
        code,
        message,
        domain,
        ...(meta ? { meta } : {}),
    },
});

export const parseCookieHeader = (cookieHeader: string | undefined): Record<string, string> => {
    if (!cookieHeader) {
        return {};
    }

    return cookieHeader.split(';').reduce<Record<string, string>>((result, segment) => {
        const [rawKey, ...valueParts] = segment.split('=');
        const key = rawKey?.trim();
        if (!key) {
            return result;
        }

        result[key] = decodeURIComponent(valueParts.join('=').trim());
        return result;
    }, {});
};

export const extractCookieTokenFromHeader = (
    cookieHeader: string | undefined,
    cookieName: string,
) => {
    const cookies = parseCookieHeader(cookieHeader);
    const token = cookies[cookieName];
    return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
};

const extractCookieToken = (req: express.Request, cookieName: string) => (
    extractCookieTokenFromHeader(req.headers.cookie, cookieName)
);

const isJwtLike = (token: string) => token.split('.').length === 3;

export function extractBearerToken(req: express.Request): string | null {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    return token.length > 0 ? token : null;
}

export function extractAccessToken(req: express.Request): string | null {
    return extractBearerToken(req) || extractCookieToken(req, 'tvgit.accessToken');
}

export function isIngestionTokenRequest(
    req: Pick<express.Request, 'headers'>,
    env: IngestionEnvSource = process.env,
): boolean {
    const token = extractBearerToken(req as express.Request);
    const validToken = env.INGESTION_TOKEN?.trim();
    return Boolean(validToken && token === validToken);
}

export function verifyJwtToken(token: string, secret: string): JwtClaims {
    const segments = token.split('.');
    if (segments.length !== 3) {
        throw new Error('JWT must contain header, payload, and signature');
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments;
    const header = parseJsonSegment(headerSegment);
    const payload = parseJsonSegment(payloadSegment) as JwtClaims;

    if (header.alg !== 'HS256') {
        throw new Error('Only HS256 JWT tokens are supported');
    }

    const expectedSignature = encodeBase64Url(
        crypto.createHmac('sha256', secret)
            .update(`${headerSegment}.${payloadSegment}`)
            .digest(),
    );

    const received = Buffer.from(signatureSegment);
    const expected = Buffer.from(expectedSignature);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
        throw new Error('JWT signature mismatch');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
        throw new Error('JWT not active yet');
    }
    if (typeof payload.exp === 'number' && payload.exp <= nowSeconds) {
        throw new Error('JWT expired');
    }

    return payload;
}

export function signJwtToken(payload: AuthSessionTokenPayload, secret: string) {
    const headerSegment = encodeBase64Url(Buffer.from(JSON.stringify({
        alg: 'HS256',
        typ: 'JWT',
    }), 'utf8'));
    const payloadSegment = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
    const signatureSegment = encodeBase64Url(
        crypto.createHmac('sha256', secret)
            .update(`${headerSegment}.${payloadSegment}`)
            .digest(),
    );

    return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
}

export const requireAuthenticatedRequest: express.RequestHandler = (req, res, next) => {
    const token = extractAccessToken(req);
    if (!token) {
        return createAuthErrorResponse(
            res,
            401,
            'TRADING_AUTH_REQUIRED',
            'Trading access requires an authenticated session token before runtime capability checks can run.',
        );
    }

    if (isJwtLike(token)) {
        try {
            const claims = verifyJwtToken(token, resolveJwtSecret());
            (res.locals as { auth?: AuthenticatedRequestContext }).auth = {
                token,
                subject: typeof claims.sub === 'string' ? claims.sub : null,
                claims,
                mode: 'jwt',
            };
            return next();
        } catch (error) {
            return createAuthErrorResponse(
                res,
                401,
                'TRADING_AUTH_INVALID',
                error instanceof Error ? error.message : 'Invalid trading session token',
            );
        }
    }

    // Brownfield fallback for pre-auth-story trading work: non-JWT bearer tokens remain
    // readable only inside the legacy trading capability bridge.
    (res.locals as { auth?: AuthenticatedRequestContext }).auth = {
        token,
        subject: null,
        claims: null,
        mode: 'session-token',
    };
    return next();
};

export const requireAppAuthentication: express.RequestHandler = (req, res, next) => {
    const token = extractAccessToken(req);
    if (!token) {
        return createAuthErrorResponse(
            res,
            401,
            'AUTH_REQUIRED',
            'Authentication is required before this protected workspace can load.',
            'auth.session',
        );
    }

    if (!isJwtLike(token)) {
        return createAuthErrorResponse(
            res,
            401,
            'AUTH_INVALID',
            'A valid session token is required before this protected workspace can load.',
            'auth.session',
        );
    }

    try {
        const claims = verifyJwtToken(token, resolveJwtSecret());
        (res.locals as { auth?: AuthenticatedRequestContext }).auth = {
            token,
            subject: typeof claims.sub === 'string' ? claims.sub : null,
            claims,
            mode: 'jwt',
        };
        return next();
    } catch (error) {
        return createAuthErrorResponse(
            res,
            401,
            'AUTH_INVALID',
            error instanceof Error ? error.message : 'Invalid session token',
            'auth.session',
        );
    }
};

export const requireAppAuthenticationOrIngestion = (
    env: IngestionEnvSource = process.env,
): express.RequestHandler => (req, res, next) => {
    if (isIngestionTokenRequest(req, env)) {
        (res.locals as { internalServiceAuth?: InternalServiceAuthContext }).internalServiceAuth = {
            kind: 'ingestion-token',
        };
        return next();
    }

    return requireAppAuthentication(req, res, next);
};

export const hydrateAuthorizedUserUnlessIngestion = (
    prisma: PrismaClient,
): express.RequestHandler => {
    const hydrate = hydrateAuthorizedUser(prisma);
    return (req, res, next) => {
        if ((res.locals as { internalServiceAuth?: InternalServiceAuthContext }).internalServiceAuth?.kind === 'ingestion-token') {
            return next();
        }

        return hydrate(req, res, next);
    };
};

const loadAuthorizedUser = async (
    prisma: PrismaClient,
    req: express.Request,
    res: express.Response,
) => {
    const locals = res.locals as { auth?: AuthenticatedRequestContext; authorizedUser?: AuthorizedUserContext };
    if (locals.authorizedUser) {
        return locals.authorizedUser;
    }

    const auth = locals.auth;
    if (!auth?.subject) {
        throw new AuthServiceError(
            401,
            'AUTH_REQUIRED',
            'Authentication is required before this protected workspace can load.',
        );
    }

    const user = await prisma.user.findUnique({
        where: { id: auth.subject },
        include: {
            permissions: {
                orderBy: { module: 'asc' },
            },
        },
    });

    if (!user) {
        throw new AuthServiceError(
            401,
            'AUTH_INVALID',
            'The current session is not linked to an active user account.',
        );
    }

    if (!user.isActive) {
        throw new AuthServiceError(
            403,
            'AUTH_USER_DISABLED',
            'This account is disabled. Contact an admin to restore access.',
            'auth.access',
        );
    }

    const modules = user.role === 'ADMIN'
        ? ['chart', 'signal', 'report', 'trading', 'engine'] satisfies AuthModuleKey[]
        : user.permissions
            .map((permission: { module: string }) => normalizeAuthModuleKey(permission.module))
            .filter((value: AuthModuleKey | null): value is AuthModuleKey => value !== null);

    const authorizedUser: AuthorizedUserContext = {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role as AuthRoleKey,
        isActive: user.isActive,
        modules,
        firstAllowedPath: buildFirstAllowedPath(user.role as AuthRoleKey, modules),
    };

    locals.authorizedUser = authorizedUser;
    return authorizedUser;
};

export const hydrateAuthorizedUser = (
    prisma: PrismaClient,
): express.RequestHandler => async (req, res, next) => {
    try {
        await loadAuthorizedUser(prisma, req, res);
        return next();
    } catch (error) {
        if (error instanceof AuthServiceError) {
            return createAuthErrorResponse(
                res,
                error.statusCode,
                error.code,
                error.message,
                error.domain,
            );
        }

        return createAuthErrorResponse(
            res,
            500,
            'AUTH_CHECK_FAILED',
            'The platform could not verify the current authenticated user.',
            'auth.access',
        );
    }
};

export const requireModuleAccess = (
    prisma: PrismaClient,
    allowedModules: AuthModuleKey[],
): express.RequestHandler => async (req, res, next) => {
    try {
        const user = await loadAuthorizedUser(prisma, req, res);
        if (user.role === 'ADMIN' || user.modules.some((moduleKey) => allowedModules.includes(moduleKey))) {
            return next();
        }

        return createAuthErrorResponse(
            res,
            403,
            'AUTH_FORBIDDEN',
            `This account does not have access to the ${allowedModules.join(' or ')} module flow.`,
            'auth.access',
            {
                requiredModules: allowedModules,
                grantedModules: user.modules,
                firstAllowedPath: user.firstAllowedPath,
            },
        );
    } catch (error) {
        if (error instanceof AuthServiceError) {
            return createAuthErrorResponse(
                res,
                error.statusCode,
                error.code,
                error.message,
                error.domain,
            );
        }

        return createAuthErrorResponse(
            res,
            500,
            'AUTH_CHECK_FAILED',
            'The platform could not verify module access for this request.',
            'auth.access',
        );
    }
};

export const requireAdminAccess = (
    prisma: PrismaClient,
): express.RequestHandler => async (req, res, next) => {
    try {
        const user = await loadAuthorizedUser(prisma, req, res);
        if (user.role === 'ADMIN') {
            return next();
        }

        return createAuthErrorResponse(
            res,
            403,
            'AUTH_ADMIN_REQUIRED',
            'Only admins can manage users and permissions.',
            'auth.access',
        );
    } catch (error) {
        if (error instanceof AuthServiceError) {
            return createAuthErrorResponse(
                res,
                error.statusCode,
                error.code,
                error.message,
                error.domain,
            );
        }

        return createAuthErrorResponse(
            res,
            500,
            'AUTH_CHECK_FAILED',
            'The platform could not verify admin access for this request.',
            'auth.access',
        );
    }
};
