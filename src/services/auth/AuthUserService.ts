import { PrismaClient } from '@prisma/client';
import {
    AUTH_MODULE_KEYS,
    AuthModuleKey,
    AuthServiceError,
    AuthSessionSnapshot,
    AuthUserRepository,
    CreateAuthUserInput,
    StoredAuthUser,
    UpdateAuthUserInput,
} from './types';
import { hashPassword, verifyPassword } from './passwords';
import { AuthSessionService, IssuedAuthSession } from './AuthSessionService';
import { resolveBootstrapAdminPassword } from './config';

export interface AuthUserSummary {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    role: 'ADMIN' | 'USER';
    isActive: boolean;
    modules: AuthModuleKey[];
}

export interface AuthUserManagementInput {
    email: string;
    username: string;
    displayName?: string | null;
    password: string;
    role: 'ADMIN' | 'USER';
    isActive?: boolean;
    modules?: AuthModuleKey[];
}

export interface AuthUserUpdateInput {
    email?: string;
    username?: string;
    displayName?: string | null;
    password?: string;
    role?: 'ADMIN' | 'USER';
    isActive?: boolean;
    modules?: AuthModuleKey[];
}

const fullAccessModules = [...AUTH_MODULE_KEYS];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,60}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_DISPLAY_NAME_LENGTH = 120;

const normalizeManagedModules = (
    role: 'ADMIN' | 'USER',
    modules: AuthModuleKey[] | undefined,
) => role === 'ADMIN'
    ? [...fullAccessModules]
    : Array.from(new Set((modules ?? []).filter((value) => AUTH_MODULE_KEYS.includes(value))));

const normalizeSummary = (user: StoredAuthUser): AuthUserSummary => ({
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    modules: user.role === 'ADMIN' ? [...fullAccessModules] : [...user.modules],
});

const normalizeIdentifier = (value: string) => value.trim().toLowerCase();

const validateManagedEmail = (email: string) => {
    const normalized = normalizeIdentifier(email);
    if (!normalized || !EMAIL_PATTERN.test(normalized)) {
        throw new AuthServiceError(
            400,
            'AUTH_USER_EMAIL_INVALID',
            'A valid email address is required before the account can be saved.',
            'auth.access',
        );
    }

    return normalized;
};

const validateManagedUsername = (username: string) => {
    const normalized = normalizeIdentifier(username);
    if (!normalized || !USERNAME_PATTERN.test(normalized)) {
        throw new AuthServiceError(
            400,
            'AUTH_USER_USERNAME_INVALID',
            'Username must be 3-60 characters and use only letters, numbers, dots, underscores, or hyphens.',
            'auth.access',
        );
    }

    return normalized;
};

const normalizeManagedDisplayName = (
    displayName: string | null | undefined,
) => {
    if (displayName === undefined) {
        return undefined;
    }

    if (displayName === null) {
        return null;
    }

    const normalized = displayName.trim();
    if (!normalized) {
        return null;
    }

    if (normalized.length > MAX_DISPLAY_NAME_LENGTH) {
        throw new AuthServiceError(
            400,
            'AUTH_USER_DISPLAY_NAME_INVALID',
            `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`,
            'auth.access',
        );
    }

    return normalized;
};

const validateManagedPassword = (
    password: string,
) => {
    const normalized = password.normalize('NFKC');
    if (!normalized.trim()) {
        throw new AuthServiceError(
            400,
            'AUTH_USER_PASSWORD_INVALID',
            'Password is required before the account can be saved.',
            'auth.access',
        );
    }

    if (normalized.length < MIN_PASSWORD_LENGTH) {
        throw new AuthServiceError(
            400,
            'AUTH_USER_PASSWORD_INVALID',
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
            'auth.access',
        );
    }

    return normalized;
};

const validateManagedModules = (
    role: 'ADMIN' | 'USER',
    modules: AuthModuleKey[] | undefined,
) => {
    const normalized = normalizeManagedModules(role, modules);
    if (role === 'USER' && normalized.length === 0) {
        throw new AuthServiceError(
            400,
            'AUTH_USER_MODULES_REQUIRED',
            'At least one module grant is required for a non-admin user.',
            'auth.access',
        );
    }

    return normalized;
};

type RepositoryPersistenceError = Error & {
    code?: string;
    meta?: {
        target?: unknown;
    };
};

const mapPersistenceError = (error: unknown): AuthServiceError | Error => {
    const candidate = error as RepositoryPersistenceError;
    const code = typeof candidate?.code === 'string' ? candidate.code : null;

    if (code === 'P2002') {
        const targets = Array.isArray(candidate.meta?.target)
            ? candidate.meta.target.map((target) => String(target).toLowerCase())
            : [];

        if (targets.some((target) => target.includes('email'))) {
            return new AuthServiceError(
                409,
                'AUTH_USER_EMAIL_CONFLICT',
                'Another account already uses this email address.',
                'auth.access',
            );
        }

        if (targets.some((target) => target.includes('username'))) {
            return new AuthServiceError(
                409,
                'AUTH_USER_USERNAME_CONFLICT',
                'Another account already uses this username.',
                'auth.access',
            );
        }

        return new AuthServiceError(
            409,
            'AUTH_USER_CONFLICT',
            'The account could not be saved because one of its unique fields is already in use.',
            'auth.access',
        );
    }

    if (code === 'P2025') {
        return new AuthServiceError(
            404,
            'AUTH_USER_NOT_FOUND',
            'The requested user account could not be found.',
            'auth.access',
        );
    }

    return error instanceof Error
        ? error
        : new Error('Unexpected auth persistence error');
};

export class PrismaAuthUserRepository implements AuthUserRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async countUsers() {
        return this.prisma.user.count();
    }

    async countActiveAdmins() {
        return this.prisma.user.count({
            where: {
                role: 'ADMIN',
                isActive: true,
            },
        });
    }

    async findByIdentifier(identifier: string) {
        const normalized = normalizeIdentifier(identifier);
        const user = await this.prisma.user.findFirst({
            where: {
                OR: [
                    { email: normalized },
                    { username: normalized },
                ],
            },
            include: {
                permissions: {
                    orderBy: { module: 'asc' },
                },
            },
        });

        return user
            ? {
                id: user.id,
                email: user.email,
                username: user.username,
                displayName: user.displayName,
                passwordHash: user.passwordHash,
                passwordSalt: user.passwordSalt,
                role: user.role,
                isActive: user.isActive,
                modules: user.permissions.map((permission) => permission.module.toLowerCase() as AuthModuleKey),
            }
            : null;
    }

    async findById(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            include: {
                permissions: {
                    orderBy: { module: 'asc' },
                },
            },
        });

        return user
            ? {
                id: user.id,
                email: user.email,
                username: user.username,
                displayName: user.displayName,
                passwordHash: user.passwordHash,
                passwordSalt: user.passwordSalt,
                role: user.role,
                isActive: user.isActive,
                modules: user.permissions.map((permission) => permission.module.toLowerCase() as AuthModuleKey),
            }
            : null;
    }

    async listUsers() {
        const users = await this.prisma.user.findMany({
            orderBy: { createdAt: 'asc' },
            include: {
                permissions: {
                    orderBy: { module: 'asc' },
                },
            },
        });

        return users.map((user) => ({
            id: user.id,
            email: user.email,
            username: user.username,
            displayName: user.displayName,
            passwordHash: user.passwordHash,
            passwordSalt: user.passwordSalt,
            role: user.role,
            isActive: user.isActive,
            modules: user.permissions.map((permission) => permission.module.toLowerCase() as AuthModuleKey),
        }));
    }

    async createUser(input: CreateAuthUserInput) {
        const created = await this.prisma.user.create({
            data: {
                email: normalizeIdentifier(input.email),
                username: normalizeIdentifier(input.username),
                displayName: input.displayName ?? null,
                passwordHash: input.passwordHash,
                passwordSalt: input.passwordSalt,
                role: input.role,
                isActive: input.isActive ?? true,
                permissions: {
                    create: normalizeManagedModules(input.role, input.modules).map((moduleKey) => ({
                        module: moduleKey.toUpperCase() as 'CHART' | 'SIGNAL' | 'REPORT' | 'TRADING' | 'ENGINE',
                    })),
                },
            },
            include: {
                permissions: {
                    orderBy: { module: 'asc' },
                },
            },
        });

        return {
            id: created.id,
            email: created.email,
            username: created.username,
            displayName: created.displayName,
            passwordHash: created.passwordHash,
            passwordSalt: created.passwordSalt,
            role: created.role,
            isActive: created.isActive,
            modules: created.permissions.map((permission) => permission.module.toLowerCase() as AuthModuleKey),
        };
    }

    async updateUser(id: string, input: UpdateAuthUserInput) {
        const role = input.role;
        const modules = role ? normalizeManagedModules(role, input.modules) : input.modules;
        const updated = await this.prisma.user.update({
            where: { id },
            data: {
                ...(input.email !== undefined ? { email: normalizeIdentifier(input.email) } : {}),
                ...(input.username !== undefined ? { username: normalizeIdentifier(input.username) } : {}),
                ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
                ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
                ...(input.passwordSalt !== undefined ? { passwordSalt: input.passwordSalt } : {}),
                ...(role !== undefined ? { role } : {}),
                ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
                ...(modules !== undefined ? {
                    permissions: {
                        deleteMany: {},
                        create: normalizeManagedModules(role ?? 'USER', modules).map((moduleKey) => ({
                            module: moduleKey.toUpperCase() as 'CHART' | 'SIGNAL' | 'REPORT' | 'TRADING' | 'ENGINE',
                        })),
                    },
                } : {}),
            },
            include: {
                permissions: {
                    orderBy: { module: 'asc' },
                },
            },
        });

        return {
            id: updated.id,
            email: updated.email,
            username: updated.username,
            displayName: updated.displayName,
            passwordHash: updated.passwordHash,
            passwordSalt: updated.passwordSalt,
            role: updated.role,
            isActive: updated.isActive,
            modules: updated.permissions.map((permission) => permission.module.toLowerCase() as AuthModuleKey),
        };
    }
}

const bootstrapConfig = () => ({
    email: normalizeIdentifier(process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL || 'admin@tvgit.local'),
    username: normalizeIdentifier(process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME || 'admin'),
    displayName: process.env.AUTH_BOOTSTRAP_ADMIN_DISPLAY_NAME || 'Bootstrap Admin',
    password: resolveBootstrapAdminPassword(),
});

export class AuthUserService {
    constructor(
        private readonly authUserRepository: AuthUserRepository,
        private readonly authSessionService: AuthSessionService,
    ) {}

    private async ensureBootstrapAdmin() {
        if (await this.authUserRepository.countUsers()) {
            return;
        }

        const bootstrap = bootstrapConfig();
        if (!bootstrap.password) {
            throw new AuthServiceError(
                503,
                'AUTH_BOOTSTRAP_REQUIRED',
                'The user store is empty. Set AUTH_BOOTSTRAP_ADMIN_PASSWORD before signing in so the initial admin account can be created safely.',
            );
        }
        const password = await hashPassword(bootstrap.password);
        await this.authUserRepository.createUser({
            email: bootstrap.email,
            username: bootstrap.username,
            displayName: bootstrap.displayName,
            passwordHash: password.hash,
            passwordSalt: password.salt,
            role: 'ADMIN',
            isActive: true,
            modules: [...fullAccessModules],
        });
    }

    private async requireAdmin(actorUserId: string) {
        const actor = await this.authUserRepository.findById(actorUserId);
        if (!actor || !actor.isActive || actor.role !== 'ADMIN') {
            throw new AuthServiceError(
                403,
                'AUTH_ADMIN_REQUIRED',
                'Only admins can manage users and permissions.',
                'auth.access',
            );
        }

        return actor;
    }

    private async getManagedUserOrThrow(userId: string) {
        const user = await this.authUserRepository.findById(userId);
        if (!user) {
            throw new AuthServiceError(
                404,
                'AUTH_USER_NOT_FOUND',
                'The requested user account could not be found.',
                'auth.access',
            );
        }

        return user;
    }

    private async assertLastActiveAdminPreserved(
        currentUser: StoredAuthUser,
        nextRole: 'ADMIN' | 'USER',
        nextIsActive: boolean,
    ) {
        const remainsActiveAdmin = currentUser.role === 'ADMIN'
            && currentUser.isActive
            && nextRole === 'ADMIN'
            && nextIsActive;

        if (remainsActiveAdmin || currentUser.role !== 'ADMIN' || !currentUser.isActive) {
            return;
        }

        const activeAdminCount = await this.authUserRepository.countActiveAdmins();
        if (activeAdminCount <= 1) {
            throw new AuthServiceError(
                409,
                'AUTH_LAST_ADMIN_REQUIRED',
                'At least one active admin must remain so the platform can continue managing user access.',
                'auth.access',
            );
        }
    }

    private async getActiveUserOrThrow(userId: string) {
        const user = await this.authUserRepository.findById(userId);
        if (!user || !user.isActive) {
            throw new AuthServiceError(
                401,
                'AUTH_INVALID',
                'The current session is not linked to an active user account.',
            );
        }

        return user;
    }

    public async login(identifier: string, password: string): Promise<IssuedAuthSession> {
        await this.ensureBootstrapAdmin();

        const user = await this.authUserRepository.findByIdentifier(identifier);
        if (!user || !user.isActive) {
            throw new AuthServiceError(
                401,
                'AUTH_LOGIN_FAILED',
                'The provided credentials are invalid or the account is disabled.',
            );
        }

        const isValidPassword = await verifyPassword(password, user.passwordHash, user.passwordSalt);
        if (!isValidPassword) {
            throw new AuthServiceError(
                401,
                'AUTH_LOGIN_FAILED',
                'The provided credentials are invalid or the account is disabled.',
            );
        }

        return this.authSessionService.issueSession(user);
    }

    public async refresh(refreshToken: string) {
        return this.authSessionService.refreshSession(refreshToken);
    }

    public async logout(refreshToken: string) {
        return this.authSessionService.revokeSession(refreshToken);
    }

    public async getSession(userId: string): Promise<AuthSessionSnapshot> {
        const user = await this.getActiveUserOrThrow(userId);
        return this.authSessionService.buildSessionSnapshotForUser(user);
    }

    public async listUsers(actorUserId: string) {
        await this.requireAdmin(actorUserId);
        const users = await this.authUserRepository.listUsers();
        return users.map(normalizeSummary);
    }

    public async createUser(actorUserId: string, input: AuthUserManagementInput) {
        await this.requireAdmin(actorUserId);

        const password = await hashPassword(validateManagedPassword(input.password));

        try {
            const created = await this.authUserRepository.createUser({
                email: validateManagedEmail(input.email),
                username: validateManagedUsername(input.username),
                displayName: normalizeManagedDisplayName(input.displayName ?? null) ?? null,
                passwordHash: password.hash,
                passwordSalt: password.salt,
                role: input.role,
                isActive: input.isActive ?? true,
                modules: validateManagedModules(input.role, input.modules),
            });

            return normalizeSummary(created);
        } catch (error) {
            throw mapPersistenceError(error);
        }
    }

    public async updateUser(actorUserId: string, userId: string, input: AuthUserUpdateInput) {
        await this.requireAdmin(actorUserId);
        const currentUser = await this.getManagedUserOrThrow(userId);
        const nextRole = input.role ?? currentUser.role;
        const nextIsActive = input.isActive ?? currentUser.isActive;
        await this.assertLastActiveAdminPreserved(currentUser, nextRole, nextIsActive);

        const password = input.password
            ? await hashPassword(validateManagedPassword(input.password))
            : null;

        const nextModules = input.modules !== undefined || input.role !== undefined
            ? validateManagedModules(nextRole, input.modules ?? currentUser.modules)
            : undefined;

        try {
            const updated = await this.authUserRepository.updateUser(userId, {
                ...(input.email !== undefined ? { email: validateManagedEmail(input.email) } : {}),
                ...(input.username !== undefined ? { username: validateManagedUsername(input.username) } : {}),
                ...(input.displayName !== undefined ? { displayName: normalizeManagedDisplayName(input.displayName) } : {}),
                ...(password ? {
                    passwordHash: password.hash,
                    passwordSalt: password.salt,
                } : {}),
                ...(input.role !== undefined || input.modules !== undefined ? { role: nextRole } : {}),
                ...(input.isActive !== undefined ? { isActive: nextIsActive } : {}),
                ...(nextModules !== undefined ? { modules: nextModules } : {}),
            });

            return normalizeSummary(updated);
        } catch (error) {
            throw mapPersistenceError(error);
        }
    }
}
