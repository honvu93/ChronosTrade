import express from 'express';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import {
    extractAccessToken,
    hydrateAuthorizedUser,
    requireAdminAccess,
    requireAppAuthentication,
} from '../middleware/auth';
import { AuthSessionService } from '../services/auth/AuthSessionService';
import { PrismaAuthUserRepository, AuthUserService } from '../services/auth/AuthUserService';
import {
    AuthModuleKey,
    AUTH_MODULE_KEYS,
    AuthServiceError,
    RefreshTokenStore,
} from '../services/auth/types';
import { ACCESS_TOKEN_TTL_SECONDS } from '../services/auth/config';

const ACCESS_COOKIE_NAME = 'tvgit.accessToken';
const REFRESH_COOKIE_NAME = 'tvgit.refreshToken';
const accessCookieMaxAgeMs = ACCESS_TOKEN_TTL_SECONDS * 1000;
const refreshCookieMaxAgeMs = 1000 * 60 * 60 * 24 * 7;
const secureCookies = process.env.NODE_ENV === 'production';

const accessCookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookies,
    path: '/',
    maxAge: accessCookieMaxAgeMs,
};

const accessCookieClearOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookies,
    path: '/',
};

const refreshCookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: secureCookies,
    path: '/',
    maxAge: refreshCookieMaxAgeMs,
};

const refreshCookieClearOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: secureCookies,
    path: '/',
};

class RedisRefreshTokenStore implements RefreshTokenStore {
    constructor(private readonly redis: IORedis) { }

    async read(token: string) {
        const payload = await this.redis.get(`auth:refresh:${token}`);
        if (!payload) {
            return null;
        }

        try {
            return JSON.parse(payload) as { userId: string };
        } catch {
            await this.delete(token);
            return null;
        }
    }

    async write(token: string, record: { userId: string }, ttlSeconds: number) {
        await this.redis.set(`auth:refresh:${token}`, JSON.stringify(record), 'EX', ttlSeconds);
    }

    async delete(token: string) {
        await this.redis.del(`auth:refresh:${token}`);
    }
}

const readRefreshTokenCookie = (req: express.Request) => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return null;
    }

    return cookieHeader
        .split(';')
        .map((segment) => segment.trim())
        .find((segment) => segment.startsWith(`${REFRESH_COOKIE_NAME}=`))
        ?.slice(`${REFRESH_COOKIE_NAME}=`.length)
        ?? null;
};

const writeRefreshCookie = (res: express.Response, refreshToken: string) => {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
};

const writeAccessCookie = (res: express.Response, accessToken: string) => {
    res.cookie(ACCESS_COOKIE_NAME, accessToken, accessCookieOptions);
};

const clearRefreshCookie = (res: express.Response) => {
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClearOptions);
};

const clearAccessCookie = (res: express.Response) => {
    res.clearCookie(ACCESS_COOKIE_NAME, accessCookieClearOptions);
};

const parseModules = (value: unknown): AuthModuleKey[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    return Array.from(new Set(
        value
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry): entry is AuthModuleKey => AUTH_MODULE_KEYS.includes(entry as AuthModuleKey)),
    ));
};

const parseBoolean = (value: unknown) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }

    return false;
};

const createErrorResponse = (
    res: express.Response,
    error: AuthServiceError | Error,
) => {
    if (error instanceof AuthServiceError) {
        return res.status(error.statusCode).json({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                domain: error.domain,
            },
        });
    }

    console.error('[AuthRoutes] Unexpected auth error:', error);
    return res.status(500).json({
        success: false,
        error: {
            code: 'AUTH_INTERNAL_ERROR',
            message: 'Unexpected authentication failure',
            domain: 'auth.session',
        },
    });
};

const writeNoStore = (res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
};

const respondWithSession = (
    res: express.Response,
    session: Awaited<ReturnType<AuthUserService['getSession']>>,
) => {
    writeNoStore(res);
    res.json({
        success: true,
        data: {
            session,
        },
    });
};

export const createAuthRouteHandlers = (
    authUserService: AuthUserService,
) => ({
    login: async (req: express.Request, res: express.Response) => {
        try {
            const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
            const password = typeof req.body?.password === 'string' ? req.body.password : '';
            if (!identifier || !password) {
                throw new AuthServiceError(
                    400,
                    'AUTH_LOGIN_INVALID',
                    'Identifier and password are required before sign-in can continue.',
                );
            }

            const issued = await authUserService.login(identifier, password);
            writeAccessCookie(res, issued.accessToken);
            writeRefreshCookie(res, issued.refreshToken);

            console.log(`[AUDIT] User login successful: ${identifier} (IP: ${req.ip})`);

            respondWithSession(res, issued.session);
        } catch (error) {
            createErrorResponse(res, error as AuthServiceError | Error);
        }
    },

    refresh: async (req: express.Request, res: express.Response) => {
        try {
            const refreshToken = readRefreshTokenCookie(req);
            if (!refreshToken) {
                throw new AuthServiceError(
                    401,
                    'AUTH_REFRESH_INVALID',
                    'The refresh token is missing or expired. Sign in again to continue.',
                );
            }

            const issued = await authUserService.refresh(refreshToken);
            writeAccessCookie(res, issued.accessToken);
            writeRefreshCookie(res, issued.refreshToken);
            respondWithSession(res, issued.session);
        } catch (error) {
            clearAccessCookie(res);
            clearRefreshCookie(res);
            createErrorResponse(res, error as AuthServiceError | Error);
        }
    },

    logout: async (req: express.Request, res: express.Response) => {
        try {
            const refreshToken = readRefreshTokenCookie(req);
            if (refreshToken) {
                await authUserService.logout(refreshToken);
            }
            clearAccessCookie(res);
            clearRefreshCookie(res);
            res.json({
                success: true,
                data: {
                    loggedOut: true,
                },
            });
        } catch (error) {
            clearAccessCookie(res);
            clearRefreshCookie(res);
            createErrorResponse(res, error as AuthServiceError | Error);
        }
    },

    session: async (req: express.Request, res: express.Response) => {
        try {
            const locals = res.locals as {
                auth?: { subject: string | null };
                authorizedUser?: {
                    id: string;
                    email: string;
                    username: string;
                    displayName: string | null;
                    role: 'ADMIN' | 'USER';
                    isActive: boolean;
                    modules: AuthModuleKey[];
                    firstAllowedPath: string | null;
                };
            };

            const user = locals.authorizedUser;
            if (!user) {
                throw new AuthServiceError(
                    401,
                    'AUTH_REQUIRED',
                    'Authentication is required before this protected workspace can load.',
                );
            }

            const accessToken = extractAccessToken(req);
            if (!accessToken) {
                throw new AuthServiceError(
                    401,
                    'AUTH_REQUIRED',
                    'Authentication is required before this protected workspace can load.',
                );
            }

            const session = await authUserService.getSession(user.id);
            writeAccessCookie(res, accessToken);
            respondWithSession(res, session);
        } catch (error) {
            clearAccessCookie(res);
            createErrorResponse(res, error as AuthServiceError | Error);
        }
    },

    listUsers: async (_req: express.Request, res: express.Response) => {
        try {
            const locals = res.locals as { authorizedUser?: { id: string } };
            const users = await authUserService.listUsers(locals.authorizedUser!.id);
            res.json({
                success: true,
                data: {
                    users,
                },
            });
        } catch (error) {
            createErrorResponse(res, error as AuthServiceError | Error);
        }
    },

    createUser: async (req: express.Request, res: express.Response) => {
        try {
            const locals = res.locals as { authorizedUser?: { id: string } };
            const user = await authUserService.createUser(locals.authorizedUser!.id, {
                email: String(req.body?.email || ''),
                username: String(req.body?.username || ''),
                displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : null,
                password: String(req.body?.password || ''),
                role: req.body?.role === 'ADMIN' ? 'ADMIN' : 'USER',
                isActive: req.body?.isActive === undefined ? true : parseBoolean(req.body.isActive),
                modules: parseModules(req.body?.modules),
            });

            res.status(201).json({
                success: true,
                data: {
                    user,
                },
            });

            console.log(`[AUDIT] User created: ${user.email} (Role: ${user.role}) by admin ${locals.authorizedUser!.id}`);
        } catch (error) {
            createErrorResponse(res, error as AuthServiceError | Error);
        }
    },

    updateUser: async (req: express.Request, res: express.Response) => {
        try {
            const locals = res.locals as { authorizedUser?: { id: string } };
            const userId = String(req.params.id ?? '');
            const user = await authUserService.updateUser(locals.authorizedUser!.id, userId, {
                ...(req.body?.email !== undefined ? { email: String(req.body.email) } : {}),
                ...(req.body?.username !== undefined ? { username: String(req.body.username) } : {}),
                ...(req.body?.displayName !== undefined ? { displayName: req.body.displayName === null ? null : String(req.body.displayName) } : {}),
                ...(req.body?.password !== undefined ? { password: String(req.body.password) } : {}),
                ...(req.body?.role !== undefined ? { role: req.body.role === 'ADMIN' ? 'ADMIN' : 'USER' } : {}),
                ...(req.body?.isActive !== undefined ? { isActive: parseBoolean(req.body.isActive) } : {}),
                ...(req.body?.modules !== undefined ? { modules: parseModules(req.body.modules) ?? [] } : {}),
            });

            res.json({
                success: true,
                data: {
                    user,
                },
            });
        } catch (error) {
            createErrorResponse(res, error as AuthServiceError | Error);
        }
    },
});

export function registerAuthRoutes(app: express.Application, prisma: PrismaClient, redis: IORedis) {
    const repository = new PrismaAuthUserRepository(prisma);
    const authUserService = new AuthUserService(
        repository,
        new AuthSessionService(
            new RedisRefreshTokenStore(redis),
            repository,
        ),
    );
    const handlers = createAuthRouteHandlers(authUserService);
    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: {
                code: 'AUTH_RATE_LIMITED',
                message: 'Too many sign-in attempts. Try again later.',
                domain: 'auth.session',
            },
        },
    });
    const refreshLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: {
                code: 'AUTH_RATE_LIMITED',
                message: 'Too many session refresh attempts. Try again later.',
                domain: 'auth.session',
            },
        },
    });

    app.post('/api/auth/login', loginLimiter, handlers.login);
    app.post('/api/auth/refresh', refreshLimiter, handlers.refresh);
    app.post('/api/auth/logout', handlers.logout);
    app.get('/api/auth/session', requireAppAuthentication, hydrateAuthorizedUser(prisma), handlers.session);

    app.use('/api/auth/users', requireAppAuthentication, hydrateAuthorizedUser(prisma), requireAdminAccess(prisma));
    app.get('/api/auth/users', handlers.listUsers);
    app.post('/api/auth/users', handlers.createUser);
    app.patch('/api/auth/users/:id', handlers.updateUser);
}
