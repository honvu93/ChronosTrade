export const AUTH_MODULE_KEYS = [
    "chart",
    "signal",
    "report",
    "trading",
    "engine",
] as const;

export type AuthModuleKey = (typeof AUTH_MODULE_KEYS)[number];

export const AUTH_ROLE_KEYS = ["ADMIN", "USER"] as const;

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

export interface AuthSessionResponseEnvelope {
    success: true;
    data: {
        session: AuthSessionSnapshot;
    };
}

export interface AuthUsersResponseEnvelope {
    success: true;
    data: {
        users: AuthSessionUser[];
    };
}

export interface AuthUserResponseEnvelope {
    success: true;
    data: {
        user: AuthSessionUser;
    };
}

export interface AuthErrorResponseEnvelope {
    success: false;
    error: {
        code: string;
        message: string;
        domain: string;
        meta?: Record<string, unknown>;
    };
}

export interface AuthUserUpsertInput {
    email?: string;
    username?: string;
    displayName?: string | null;
    password?: string;
    role?: AuthRoleKey;
    isActive?: boolean;
    modules?: AuthModuleKey[];
}
