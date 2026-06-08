export const AUTH_MODULE_KEYS = [
    'chart',
    'signal',
    'report',
    'trading',
    'engine',
] as const;

export type AuthModuleKey = (typeof AUTH_MODULE_KEYS)[number];

export const AUTH_ROLE_KEYS = ['ADMIN', 'USER'] as const;

export type AuthRoleKey = (typeof AUTH_ROLE_KEYS)[number];

export interface AuthSessionUser {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    role: AuthRoleKey;
    isActive: boolean;
    modules: AuthModuleKey[];
}

export interface AuthSessionSnapshot {
    user: AuthSessionUser;
    firstAllowedPath: string | null;
    accessTokenExpiresAt: string;
}

export interface AuthSessionTokenPayload {
    sub: string;
    role: AuthRoleKey;
    modules: AuthModuleKey[];
    iat: number;
    exp: number;
}

export interface StoredAuthUser {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    passwordHash: string;
    passwordSalt: string;
    role: AuthRoleKey;
    isActive: boolean;
    modules: AuthModuleKey[];
}

export interface CreateAuthUserInput {
    email: string;
    username: string;
    displayName?: string | null;
    passwordHash: string;
    passwordSalt: string;
    role: AuthRoleKey;
    isActive?: boolean;
    modules: AuthModuleKey[];
}

export interface UpdateAuthUserInput {
    email?: string;
    username?: string;
    displayName?: string | null;
    passwordHash?: string;
    passwordSalt?: string;
    role?: AuthRoleKey;
    isActive?: boolean;
    modules?: AuthModuleKey[];
}

export interface AuthUserRepository {
    countUsers(): Promise<number>;
    countActiveAdmins(): Promise<number>;
    findByIdentifier(identifier: string): Promise<StoredAuthUser | null>;
    findById(id: string): Promise<StoredAuthUser | null>;
    listUsers(): Promise<StoredAuthUser[]>;
    createUser(input: CreateAuthUserInput): Promise<StoredAuthUser>;
    updateUser(id: string, input: UpdateAuthUserInput): Promise<StoredAuthUser>;
}

export interface RefreshTokenStoreRecord {
    userId: string;
}

export interface RefreshTokenStore {
    read(token: string): Promise<RefreshTokenStoreRecord | null>;
    write(token: string, record: RefreshTokenStoreRecord, ttlSeconds: number): Promise<void>;
    delete(token: string): Promise<void>;
}

export class AuthServiceError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly domain: string;

    constructor(
        statusCode: number,
        code: string,
        message: string,
        domain = 'auth.session',
    ) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.domain = domain;
    }
}

export const normalizeAuthModuleKey = (value: string): AuthModuleKey | null => {
    const normalized = value.trim().toLowerCase();
    return AUTH_MODULE_KEYS.includes(normalized as AuthModuleKey)
        ? normalized as AuthModuleKey
        : null;
};

export const buildFirstAllowedPath = (
    role: AuthRoleKey,
    modules: AuthModuleKey[],
): string | null => {
    if (role === 'ADMIN') {
        return '/';
    }

    const orderedModules: AuthModuleKey[] = ['chart', 'signal', 'report', 'trading', 'engine'];
    for (const moduleKey of orderedModules) {
        if (!modules.includes(moduleKey)) {
            continue;
        }

        switch (moduleKey) {
            case 'chart':
                return '/';
            case 'signal':
                return '/signals';
            case 'report':
                return '/reports';
            case 'trading':
                return '/trading';
            case 'engine':
                return '/engine';
            default:
                break;
        }
    }

    return null;
};

