import crypto from 'crypto';
import {
    AuthModuleKey,
    AuthRoleKey,
    AuthServiceError,
    AuthSessionSnapshot,
    AuthSessionTokenPayload,
    AuthUserRepository,
    buildFirstAllowedPath,
    RefreshTokenStore,
    StoredAuthUser,
} from './types';
import { signJwtToken } from '../../middleware/auth';
import {
    ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_SECONDS,
    resolveJwtSecret,
} from './config';

export interface IssuedAuthSession {
    accessToken: string;
    refreshToken: string;
    session: AuthSessionSnapshot;
}

const createRefreshToken = () => crypto.randomBytes(32).toString('hex');

const buildSessionUser = (user: StoredAuthUser) => ({
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    modules: user.role === 'ADMIN'
        ? (['chart', 'signal', 'report', 'trading', 'engine'] satisfies AuthModuleKey[])
        : user.modules,
});

export class AuthSessionService {
    constructor(
        private readonly refreshTokenStore: RefreshTokenStore,
        private readonly authUserRepository: Pick<AuthUserRepository, 'findById'>,
    ) {}

    private buildAccessTokenPayload(user: StoredAuthUser): AuthSessionTokenPayload {
        const issuedAt = Math.floor(Date.now() / 1000);
        return {
            sub: user.id,
            role: user.role as AuthRoleKey,
            modules: buildSessionUser(user).modules,
            iat: issuedAt,
            exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
        };
    }

    private buildSessionSnapshot(user: StoredAuthUser, payload: AuthSessionTokenPayload): AuthSessionSnapshot {
        const sessionUser = buildSessionUser(user);
        return {
            user: sessionUser,
            firstAllowedPath: buildFirstAllowedPath(sessionUser.role, sessionUser.modules),
            accessTokenExpiresAt: new Date(payload.exp * 1000).toISOString(),
        };
    }

    public buildSessionSnapshotForUser(user: StoredAuthUser) {
        return this.buildSessionSnapshot(user, this.buildAccessTokenPayload(user));
    }

    public async issueSession(user: StoredAuthUser): Promise<IssuedAuthSession> {
        const payload = this.buildAccessTokenPayload(user);
        const accessToken = signJwtToken(payload, resolveJwtSecret());
        const refreshToken = createRefreshToken();
        await this.refreshTokenStore.write(refreshToken, { userId: user.id }, REFRESH_TOKEN_TTL_SECONDS);

        return {
            accessToken,
            refreshToken,
            session: this.buildSessionSnapshot(user, payload),
        };
    }

    public async refreshSession(refreshToken: string): Promise<IssuedAuthSession> {
        const record = await this.refreshTokenStore.read(refreshToken);
        if (!record) {
            throw new AuthServiceError(
                401,
                'AUTH_REFRESH_INVALID',
                'The refresh token is missing or expired. Sign in again to continue.',
            );
        }

        const user = await this.authUserRepository.findById(record.userId);
        if (!user || !user.isActive) {
            await this.refreshTokenStore.delete(refreshToken);
            throw new AuthServiceError(
                401,
                'AUTH_REFRESH_INVALID',
                'The refresh token is no longer valid for an active account.',
            );
        }

        await this.refreshTokenStore.delete(refreshToken);
        return this.issueSession(user);
    }

    public async revokeSession(refreshToken: string) {
        await this.refreshTokenStore.delete(refreshToken);
    }
}
