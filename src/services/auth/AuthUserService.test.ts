import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AuthSessionService } from './AuthSessionService';
import { AuthUserService } from './AuthUserService';
import {
    AuthModuleKey,
    AuthUserRepository,
    StoredAuthUser,
} from './types';

class InMemoryAuthUserRepository implements AuthUserRepository {
    constructor(private readonly users: StoredAuthUser[]) {}

    async countUsers() {
        return this.users.length;
    }

    async countActiveAdmins() {
        return this.users.filter((user) => user.role === 'ADMIN' && user.isActive).length;
    }

    async findByIdentifier(identifier: string) {
        const normalized = identifier.trim().toLowerCase();
        return this.users.find((user) => (
            user.email === normalized || user.username === normalized
        )) ?? null;
    }

    async findById(id: string) {
        return this.users.find((user) => user.id === id) ?? null;
    }

    async listUsers() {
        return [...this.users];
    }

    async createUser(input: {
        email: string;
        username: string;
        displayName?: string | null;
        passwordHash: string;
        passwordSalt: string;
        role: 'ADMIN' | 'USER';
        isActive?: boolean;
        modules: AuthModuleKey[];
    }) {
        const user: StoredAuthUser = {
            id: `user-${this.users.length + 1}`,
            email: input.email,
            username: input.username,
            displayName: input.displayName ?? null,
            passwordHash: input.passwordHash,
            passwordSalt: input.passwordSalt,
            role: input.role,
            isActive: input.isActive ?? true,
            modules: [...input.modules],
        };
        this.users.push(user);
        return user;
    }

    async updateUser(
        id: string,
        input: {
            email?: string;
            username?: string;
            displayName?: string | null;
            passwordHash?: string;
            passwordSalt?: string;
            role?: 'ADMIN' | 'USER';
            isActive?: boolean;
            modules?: AuthModuleKey[];
        },
    ) {
        const index = this.users.findIndex((user) => user.id === id);
        if (index === -1) {
            throw Object.assign(new Error('Missing user'), { code: 'P2025' });
        }

        const current = this.users[index];
        const updated: StoredAuthUser = {
            ...current,
            ...input,
            modules: input.modules ? [...input.modules] : current.modules,
        };
        this.users[index] = updated;
        return updated;
    }
}

const createService = (users: StoredAuthUser[]) => new AuthUserService(
    new InMemoryAuthUserRepository(users),
    {} as AuthSessionService,
);

describe('AuthUserService.createUser', () => {
    it('rejects non-admin users without any module grant', async () => {
        const service = createService([{
            id: 'admin-1',
            email: 'admin@tvgit.local',
            username: 'admin',
            displayName: 'Admin',
            passwordHash: 'hash',
            passwordSalt: 'salt',
            role: 'ADMIN',
            isActive: true,
            modules: ['chart', 'signal', 'report', 'trading', 'engine'],
        }]);

        await assert.rejects(
            () => service.createUser('admin-1', {
                email: 'pilot@tvgit.local',
                username: 'pilot',
                displayName: 'Pilot User',
                password: 'pilot-pass',
                role: 'USER',
                isActive: true,
                modules: [],
            }),
            (error: any) => {
                assert.equal(error.code, 'AUTH_USER_MODULES_REQUIRED');
                return true;
            },
        );
    });

    it('rejects passwords shorter than eight characters', async () => {
        const service = createService([{
            id: 'admin-1',
            email: 'admin@tvgit.local',
            username: 'admin',
            displayName: 'Admin',
            passwordHash: 'hash',
            passwordSalt: 'salt',
            role: 'ADMIN',
            isActive: true,
            modules: ['chart', 'signal', 'report', 'trading', 'engine'],
        }]);

        await assert.rejects(
            () => service.createUser('admin-1', {
                email: 'pilot@tvgit.local',
                username: 'pilot',
                displayName: 'Pilot User',
                password: 'short',
                role: 'USER',
                isActive: true,
                modules: ['trading'],
            }),
            (error: any) => {
                assert.equal(error.code, 'AUTH_USER_PASSWORD_INVALID');
                return true;
            },
        );
    });
});

describe('AuthUserService.updateUser', () => {
    it('prevents disabling the last active admin', async () => {
        const service = createService([{
            id: 'admin-1',
            email: 'admin@tvgit.local',
            username: 'admin',
            displayName: 'Admin',
            passwordHash: 'hash',
            passwordSalt: 'salt',
            role: 'ADMIN',
            isActive: true,
            modules: ['chart', 'signal', 'report', 'trading', 'engine'],
        }]);

        await assert.rejects(
            () => service.updateUser('admin-1', 'admin-1', {
                isActive: false,
            }),
            (error: any) => {
                assert.equal(error.code, 'AUTH_LAST_ADMIN_REQUIRED');
                return true;
            },
        );
    });

    it('uses the current role when modules are updated without an explicit role', async () => {
        const service = createService([
            {
                id: 'admin-1',
                email: 'admin@tvgit.local',
                username: 'admin',
                displayName: 'Admin',
                passwordHash: 'hash',
                passwordSalt: 'salt',
                role: 'ADMIN',
                isActive: true,
                modules: ['chart', 'signal', 'report', 'trading', 'engine'],
            },
            {
                id: 'user-1',
                email: 'pilot@tvgit.local',
                username: 'pilot',
                displayName: 'Pilot User',
                passwordHash: 'hash',
                passwordSalt: 'salt',
                role: 'USER',
                isActive: true,
                modules: ['trading'],
            },
        ]);

        const updated = await service.updateUser('admin-1', 'user-1', {
            modules: ['trading', 'report'],
        });

        assert.equal(updated.role, 'USER');
        assert.deepEqual(updated.modules, ['trading', 'report']);
    });
});
