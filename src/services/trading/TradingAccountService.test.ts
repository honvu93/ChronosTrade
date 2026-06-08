import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
    TradingAccountService,
    TradingAccountServiceError,
} from './TradingAccountService';
import {
    assertRequiredDatabaseSchema,
    buildRequiredDatabaseSchemaMessage,
    getDatabaseSchemaMismatchMessage,
} from '../../database/requiredDatabaseSchema';

type UserRow = {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    activeTradingAccountId: string | null;
};

type AccountRow = {
    id: string;
    ownerUserId: string;
    label: string;
    accountMode?: 'LIVE' | 'PAPER';
    status?: string;
    createdAt: Date;
    updatedAt: Date;
    ownerUser: Omit<UserRow, 'activeTradingAccountId'>;
    credential: {
        ciphertext: string;
    } | null;
};

function compareOrderBy<T extends Record<string, unknown>>(
    left: T,
    right: T,
    orderBy: Array<Record<string, 'asc' | 'desc'>>,
) {
    for (const rule of orderBy) {
        const [key, direction] = Object.entries(rule)[0] as [keyof T, 'asc' | 'desc'];
        if (left[key] === right[key]) {
            continue;
        }

        const leftValue = left[key] as string | number | Date;
        const rightValue = right[key] as string | number | Date;
        const comparison = leftValue instanceof Date && rightValue instanceof Date
            ? leftValue.getTime() - rightValue.getTime()
            : leftValue > rightValue
                ? 1
                : -1;

        return direction === 'asc' ? comparison : comparison * -1;
    }

    return 0;
}

function createPrismaMock(initialUsers: UserRow[], initialAccounts: AccountRow[] = []) {
    const users = initialUsers.map((user) => ({ ...user }));
    const accounts = initialAccounts.map((account) => ({ ...account }));
    let sequence = accounts.length + 1;

    const prismaLike = {
        user: {
            findUnique: async (args: {
                where: { id: string };
                select?: { id?: boolean; activeTradingAccountId?: boolean };
            }) => {
                const user = users.find((candidate) => candidate.id === args.where.id) ?? null;
                if (!user) {
                    return null;
                }

                if (args.select?.id || args.select?.activeTradingAccountId) {
                    return {
                        ...(args.select?.id ? { id: user.id } : {}),
                        ...(args.select?.activeTradingAccountId ? { activeTradingAccountId: user.activeTradingAccountId } : {}),
                    };
                }

                return user;
            },
            findMany: async (args: {
                where?: { id?: { in?: string[] } };
                select?: { id?: boolean; activeTradingAccountId?: boolean };
            }) => users
                .filter((user) => !args.where?.id?.in || args.where.id.in.includes(user.id))
                .map((user) => ({
                    ...(args.select?.id ? { id: user.id } : {}),
                    ...(args.select?.activeTradingAccountId ? { activeTradingAccountId: user.activeTradingAccountId } : {}),
                })),
            update: async (args: {
                where: { id: string };
                data: { activeTradingAccountId: string | null };
            }) => {
                const user = users.find((candidate) => candidate.id === args.where.id)!;
                user.activeTradingAccountId = args.data.activeTradingAccountId;
                return { ...user };
            },
        },
        tradingAccount: {
            findMany: async (args: {
                where?: { ownerUserId?: string | null };
                orderBy?: Array<Record<string, 'asc' | 'desc'>>;
            }) => {
                const filtered = args.where?.ownerUserId
                    ? accounts.filter((account) => account.ownerUserId === args.where?.ownerUserId)
                    : [...accounts];

                if (args.orderBy) {
                    filtered.sort((left, right) => compareOrderBy(left, right, args.orderBy!));
                }

                return filtered;
            },
            findUnique: async (args: { where: { id: string } }) => (
                accounts.find((account) => account.id === args.where.id) ?? null
            ),
            findFirst: async (args: {
                where?: { id?: string | { not?: string }; ownerUserId?: string };
                orderBy?: Array<Record<string, 'asc' | 'desc'>>;
                select?: { id?: boolean };
            }) => {
                const filtered = accounts.filter((account) => (
                    (args.where?.id === undefined
                        || (typeof args.where.id === 'string'
                            ? account.id === args.where.id
                            : args.where.id.not === undefined || account.id !== args.where.id.not))
                    && (args.where?.ownerUserId === undefined || account.ownerUserId === args.where.ownerUserId)
                ));

                if (args.orderBy) {
                    filtered.sort((left, right) => compareOrderBy(left, right, args.orderBy!));
                }

                const row = filtered[0] ?? null;
                if (!row || !args.select) {
                    return row;
                }

                return {
                    ...(args.select.id ? { id: row.id } : {}),
                };
            },
            create: async (args: {
                data: {
                    ownerUserId: string;
                    label: string;
                    accountMode?: 'LIVE' | 'PAPER';
                    credential: {
                        create: {
                            ciphertext: string;
                        };
                    };
                };
            }) => {
                const owner = users.find((candidate) => candidate.id === args.data.ownerUserId)!;
                const timestamp = new Date(`2026-03-11T1${sequence}:00:00.000Z`);
                const row: AccountRow = {
                    id: `acct-${sequence++}`,
                    ownerUserId: args.data.ownerUserId,
                    label: args.data.label,
                    accountMode: args.data.accountMode ?? 'LIVE',
                    status: 'PENDING',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    ownerUser: {
                        id: owner.id,
                        email: owner.email,
                        username: owner.username,
                        displayName: owner.displayName,
                    },
                    credential: {
                        ciphertext: args.data.credential.create.ciphertext,
                    },
                };
                accounts.push(row);
                return row;
            },
            update: async (args: {
                where: { id: string };
                data: {
                    label: string;
                    accountMode?: 'LIVE' | 'PAPER';
                    credential: {
                        upsert: {
                            update: { ciphertext: string };
                            create: { ciphertext: string };
                        };
                    };
                };
            }) => {
                const row = accounts.find((candidate) => candidate.id === args.where.id)!;
                row.label = args.data.label;
                row.accountMode = args.data.accountMode ?? row.accountMode ?? 'LIVE';
                row.updatedAt = new Date(`2026-03-11T1${sequence++}:30:00.000Z`);
                row.credential = {
                    ciphertext: row.credential
                        ? args.data.credential.upsert.update.ciphertext
                        : args.data.credential.upsert.create.ciphertext,
                };
                return row;
            },
            delete: async (args: { where: { id: string } }) => {
                const index = accounts.findIndex((candidate) => candidate.id === args.where.id);
                const [deleted] = accounts.splice(index, 1);
                for (const user of users) {
                    if (user.activeTradingAccountId === deleted?.id) {
                        user.activeTradingAccountId = null;
                    }
                }
                return deleted;
            },
        },
        $transaction: async (input: unknown[] | ((tx: unknown) => Promise<unknown>)) => {
            if (typeof input === 'function') {
                return input(prismaLike);
            }

            return Promise.all(input);
        },
    };

    return prismaLike as unknown as PrismaClient;
}

const env = {
    ENCRYPTION_KEY: '12345678901234567890123456789012',
};

describe('TradingAccountService', () => {
    it('creates multiple user-scoped MT5 accounts and keeps the first saved account active until changed', async () => {
        const prisma = createPrismaMock([{
            id: 'user-1',
            email: 'pilot@example.com',
            username: 'pilot',
            displayName: 'Pilot User',
            activeTradingAccountId: null,
        }]);
        const service = new TradingAccountService(prisma, env);

        const first = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Primary MT5',
                mt5Login: '10001',
                mt5Password: 'secret-1',
                mt5Server: 'Demo-Server-A',
                accountMode: 'PAPER',
            },
        );
        const second = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Secondary MT5',
                mt5Login: '20002',
                mt5Password: 'secret-2',
                mt5Server: 'Demo-Server-B',
                accountMode: 'LIVE',
            },
        );
        const listed = await service.listAccounts({ id: 'user-1', role: 'USER' });

        assert.equal(first.isActive, true);
        assert.equal(first.accountMode, 'PAPER');
        assert.equal(second.accountMode, 'LIVE');
        assert.equal(second.isActive, false);
        assert.equal(listed.accounts.length, 2);
        assert.equal(listed.activeAccountId, first.id);
        assert.equal(listed.accounts.some((account) => account.id === second.id), true);
    });

    it('switches the active account and uses the selected account for readiness snapshots', async () => {
        const prisma = createPrismaMock([{
            id: 'user-1',
            email: 'pilot@example.com',
            username: 'pilot',
            displayName: 'Pilot User',
            activeTradingAccountId: null,
        }]);
        const service = new TradingAccountService(prisma, env);

        const first = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Primary MT5',
                mt5Login: '10001',
                mt5Password: 'secret-1',
                mt5Server: 'Demo-Server-A',
                accountMode: 'LIVE',
            },
        );
        const second = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Secondary MT5',
                mt5Login: '20002',
                mt5Password: 'secret-2',
                mt5Server: 'Demo-Server-B',
                accountMode: 'PAPER',
            },
        );

        const selection = await service.selectActiveAccount(
            { id: 'user-1', role: 'USER' },
            second.id,
        );
        const readiness = await service.getReadinessSnapshotForUser('user-1');

        assert.equal(selection.activeAccountId, second.id);
        assert.equal(selection.account.isActive, true);
        assert.equal(selection.account.accountMode, 'PAPER');
        assert.equal(readiness.accountId, second.id);
        assert.equal(readiness.accountMode, 'PAPER');
        assert.equal(readiness.mt5Login, '20002');
        assert.notEqual(readiness.accountId, first.id);
    });

    it('allows admins to inspect readiness for an explicitly selected account owned by another user', async () => {
        const prisma = createPrismaMock([
            {
                id: 'admin-1',
                email: 'admin@example.com',
                username: 'admin',
                displayName: 'Admin User',
                activeTradingAccountId: null,
            },
            {
                id: 'user-1',
                email: 'pilot@example.com',
                username: 'pilot',
                displayName: 'Pilot User',
                activeTradingAccountId: null,
            },
        ]);
        const service = new TradingAccountService(prisma, env);

        const account = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Pilot MT5',
                mt5Login: '30003',
                mt5Password: 'secret-3',
                mt5Server: 'Demo-Server-C',
                accountMode: 'PAPER',
            },
        );

        const readiness = await service.getReadinessSnapshotForActor(
            { id: 'admin-1', role: 'ADMIN' },
            {
                accountId: account.id,
                ownerUserId: 'user-1',
            },
        );

        assert.equal(readiness.accountId, account.id);
        assert.equal(readiness.accountLabel, 'Pilot MT5');
        assert.equal(readiness.accountMode, 'PAPER');
        assert.equal(readiness.mt5Login, '30003');
        assert.equal(readiness.mt5Server, 'Demo-Server-C');
        assert.equal(readiness.state, 'ready');
    });

    it('defaults admin account listings to the admin owner scope', async () => {
        const prisma = createPrismaMock([
            {
                id: 'admin-1',
                email: 'admin@example.com',
                username: 'admin',
                displayName: 'Admin User',
                activeTradingAccountId: null,
            },
            {
                id: 'user-1',
                email: 'pilot@example.com',
                username: 'pilot',
                displayName: 'Pilot User',
                activeTradingAccountId: null,
            },
        ]);
        const service = new TradingAccountService(prisma, env);

        const adminAccount = await service.createAccount(
            { id: 'admin-1', role: 'ADMIN' },
            {
                label: 'Admin MT5',
                mt5Login: '90001',
                mt5Password: 'secret-admin',
                mt5Server: 'Admin-Demo',
                accountMode: 'PAPER',
            },
        );
        await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Pilot MT5',
                mt5Login: '30003',
                mt5Password: 'secret-3',
                mt5Server: 'Demo-Server-C',
                accountMode: 'PAPER',
            },
        );

        const listed = await service.listAccounts({ id: 'admin-1', role: 'ADMIN' });

        assert.equal(listed.accounts.length, 1);
        assert.equal(listed.accounts[0].id, adminAccount.id);
        assert.equal(listed.accounts[0].ownerUserId, 'admin-1');
        assert.equal(listed.activeAccountId, adminAccount.id);
    });

    it('allows admins to explicitly list MT5 accounts owned by another user', async () => {
        const prisma = createPrismaMock([
            {
                id: 'admin-1',
                email: 'admin@example.com',
                username: 'admin',
                displayName: 'Admin User',
                activeTradingAccountId: null,
            },
            {
                id: 'user-1',
                email: 'pilot@example.com',
                username: 'pilot',
                displayName: 'Pilot User',
                activeTradingAccountId: null,
            },
        ]);
        const service = new TradingAccountService(prisma, env);

        await service.createAccount(
            { id: 'admin-1', role: 'ADMIN' },
            {
                label: 'Admin MT5',
                mt5Login: '90001',
                mt5Password: 'secret-admin',
                mt5Server: 'Admin-Demo',
                accountMode: 'PAPER',
            },
        );
        const pilotAccount = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Pilot MT5',
                mt5Login: '30003',
                mt5Password: 'secret-3',
                mt5Server: 'Demo-Server-C',
                accountMode: 'PAPER',
            },
        );

        const listed = await service.listAccounts(
            { id: 'admin-1', role: 'ADMIN' },
            { ownerUserId: 'user-1' },
        );

        assert.equal(listed.accounts.length, 1);
        assert.equal(listed.accounts[0].id, pilotAccount.id);
        assert.equal(listed.accounts[0].ownerUserId, 'user-1');
        assert.equal(listed.activeAccountId, pilotAccount.id);
    });

    it('requires an explicit owner scope before admins manage another user account by id', async () => {
        const prisma = createPrismaMock([
            {
                id: 'admin-1',
                email: 'admin@example.com',
                username: 'admin',
                displayName: 'Admin User',
                activeTradingAccountId: null,
            },
            {
                id: 'user-1',
                email: 'pilot@example.com',
                username: 'pilot',
                displayName: 'Pilot User',
                activeTradingAccountId: null,
            },
        ]);
        const service = new TradingAccountService(prisma, env);

        const pilotAccount = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Pilot MT5',
                mt5Login: '30003',
                mt5Password: 'secret-3',
                mt5Server: 'Demo-Server-C',
                accountMode: 'PAPER',
            },
        );

        await assert.rejects(
            () => service.selectActiveAccount(
                { id: 'admin-1', role: 'ADMIN' },
                pilotAccount.id,
            ),
            (error: unknown) => error instanceof TradingAccountServiceError
                && error.code === 'TRADING_ACCOUNT_FORBIDDEN'
                && error.message === 'Admin access to another user\'s MT5 connection requires an explicit owner scope.',
        );

        const selection = await service.selectActiveAccount(
            { id: 'admin-1', role: 'ADMIN' },
            pilotAccount.id,
            { ownerUserId: 'user-1' },
        );

        assert.equal(selection.account.id, pilotAccount.id);
        assert.equal(selection.activeAccountId, pilotAccount.id);
    });

    it('promotes the most recently updated remaining account when deleting the active account', async () => {
        const prisma = createPrismaMock([{
            id: 'user-1',
            email: 'pilot@example.com',
            username: 'pilot',
            displayName: 'Pilot User',
            activeTradingAccountId: null,
        }]);
        const service = new TradingAccountService(prisma, env);

        const first = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Primary MT5',
                mt5Login: '10001',
                mt5Password: 'secret-1',
                mt5Server: 'Demo-Server-A',
                accountMode: 'LIVE',
            },
        );
        const second = await service.createAccount(
            { id: 'user-1', role: 'USER' },
            {
                label: 'Secondary MT5',
                mt5Login: '20002',
                mt5Password: 'secret-2',
                mt5Server: 'Demo-Server-B',
                accountMode: 'PAPER',
            },
        );
        await service.updateAccount(
            { id: 'user-1', role: 'USER' },
            first.id,
            { label: 'Primary MT5 Updated' },
        );
        await service.selectActiveAccount(
            { id: 'user-1', role: 'USER' },
            second.id,
        );

        const deletion = await service.deleteAccount(
            { id: 'user-1', role: 'USER' },
            second.id,
        );
        const listed = await service.listAccounts({ id: 'user-1', role: 'USER' });

        assert.equal(deletion.activeAccountId, first.id);
        assert.equal(listed.activeAccountId, first.id);
        assert.equal(listed.accounts.length, 1);
        assert.equal(listed.accounts[0].label, 'Primary MT5 Updated');
        assert.equal(listed.accounts[0].isActive, true);
    });

    it('blocks non-admin users from creating an account for another user', async () => {
        const prisma = createPrismaMock([
            {
                id: 'user-1',
                email: 'pilot@example.com',
                username: 'pilot',
                displayName: 'Pilot User',
                activeTradingAccountId: null,
            },
            {
                id: 'user-2',
                email: 'other@example.com',
                username: 'other',
                displayName: 'Other User',
                activeTradingAccountId: null,
            },
        ]);
        const service = new TradingAccountService(prisma, env);

        await assert.rejects(
            () => service.createAccount(
                { id: 'user-1', role: 'USER' },
                {
                    ownerUserId: 'user-2',
                    label: 'Other MT5',
                    mt5Login: '10002',
                    mt5Password: 'secret',
                    mt5Server: 'Demo-Server',
                    accountMode: 'PAPER',
                },
            ),
            (error: unknown) => error instanceof TradingAccountServiceError && error.code === 'TRADING_ACCOUNT_FORBIDDEN',
        );
    });

    it('maps missing trading_accounts.account_mode persistence errors to a clear schema mismatch', async () => {
        const prisma = createPrismaMock([{
            id: 'user-1',
            email: 'pilot@example.com',
            username: 'pilot',
            displayName: 'Pilot User',
            activeTradingAccountId: null,
        }]);
        (prisma as unknown as {
            tradingAccount: {
                create: () => Promise<never>;
            };
        }).tradingAccount.create = async () => {
            const error = new Error('The column `public.trading_accounts.account_mode` does not exist.');
            Object.assign(error, {
                code: 'P2022',
                meta: {
                    column: 'public.trading_accounts.account_mode',
                },
            });
            throw error;
        };
        const service = new TradingAccountService(prisma, env);

        await assert.rejects(
            () => service.createAccount(
                { id: 'user-1', role: 'USER' },
                {
                    label: 'Paper MT5',
                    mt5Login: '30003',
                    mt5Password: 'secret-3',
                    mt5Server: 'Demo-Server-C',
                    accountMode: 'PAPER',
                },
            ),
            (error: unknown) => error instanceof TradingAccountServiceError
                && error.code === 'TRADING_ACCOUNT_SCHEMA_MISMATCH'
                && error.message.includes('trading_accounts.account_mode'),
        );
    });
});

describe('requiredDatabaseSchema', () => {
    const indicatorCatalogSchemaRows = [
        { table_name: 'tech_indicator_definitions', column_name: 'runtime_binding_key' },
        { table_name: 'tech_indicator_definitions', column_name: 'draft_name' },
        { table_name: 'tech_indicator_definitions', column_name: 'draft_category' },
        { table_name: 'tech_indicator_definitions', column_name: 'draft_description' },
        { table_name: 'tech_indicator_definitions', column_name: 'draft_param_schema' },
        { table_name: 'tech_indicator_definitions', column_name: 'draft_conditions' },
        { table_name: 'tech_indicator_definitions', column_name: 'draft_runtime_binding_key' },
        { table_name: 'tech_indicator_definitions', column_name: 'catalog_status' },
        { table_name: 'tech_indicator_definitions', column_name: 'created_by' },
        { table_name: 'tech_indicator_definitions', column_name: 'updated_at' },
        { table_name: 'tech_indicator_definitions', column_name: 'updated_by' },
        { table_name: 'tech_indicator_definitions', column_name: 'draft_updated_at' },
        { table_name: 'tech_indicator_definitions', column_name: 'draft_updated_by' },
        { table_name: 'tech_indicator_definitions', column_name: 'published_at' },
        { table_name: 'tech_indicator_definitions', column_name: 'published_by' },
        { table_name: 'tech_indicator_definitions', column_name: 'retired_at' },
        { table_name: 'tech_indicator_definitions', column_name: 'retired_by' },
    ];

    it('fails when required indicator runtime schema columns are missing', async () => {
        const prisma = {
            $queryRaw: async () => [
                {
                    table_name: 'price_candles',
                    column_name: 'time',
                },
                {
                    table_name: 'users',
                    column_name: 'active_trading_account_id',
                },
                {
                    table_name: 'trading_accounts',
                    column_name: 'account_mode',
                },
                {
                    table_name: 'trading_trade_intents',
                    column_name: 'id',
                },
                {
                    table_name: 'trading_execution_commands',
                    column_name: 'trade_intent_id',
                },
                ...indicatorCatalogSchemaRows,
            ],
        } as Pick<PrismaClient, '$queryRaw'>;

        await assert.rejects(
            () => assertRequiredDatabaseSchema(prisma),
            (error: unknown) => error instanceof Error
                && error.message === buildRequiredDatabaseSchemaMessage([
                    {
                        tableName: 'signal_definitions',
                        columnName: 'composed_blocks',
                        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
                    },
                    {
                        tableName: 'signal_definitions',
                        columnName: 'is_composed',
                        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
                    },
                    {
                        tableName: 'signal_definitions',
                        columnName: 'created_by',
                        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
                    },
                    {
                        tableName: 'signal_events',
                        columnName: 'indicator_instance_id',
                        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
                    },
                    {
                        tableName: 'signal_logic_traces',
                        columnName: 'indicator_instance_id',
                        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
                    },
                    {
                        tableName: 'indicator_instances',
                        columnName: 'id',
                        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
                    },
                    {
                        tableName: 'indicator_alerts',
                        columnName: 'id',
                        migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
                    },
                ]),
        );
    });

    it('fails when required trading schema columns are missing', async () => {
        const prisma = {
            $queryRaw: async () => [
                {
                    table_name: 'price_candles',
                    column_name: 'time',
                },
                {
                    table_name: 'signal_definitions',
                    column_name: 'composed_blocks',
                },
                {
                    table_name: 'signal_definitions',
                    column_name: 'is_composed',
                },
                {
                    table_name: 'signal_definitions',
                    column_name: 'created_by',
                },
                {
                    table_name: 'signal_events',
                    column_name: 'indicator_instance_id',
                },
                {
                    table_name: 'signal_logic_traces',
                    column_name: 'indicator_instance_id',
                },
                {
                    table_name: 'indicator_instances',
                    column_name: 'id',
                },
                {
                    table_name: 'indicator_alerts',
                    column_name: 'id',
                },
                {
                    table_name: 'users',
                    column_name: 'active_trading_account_id',
                },
                ...indicatorCatalogSchemaRows,
            ],
        } as Pick<PrismaClient, '$queryRaw'>;

        await assert.rejects(
            () => assertRequiredDatabaseSchema(prisma),
            (error: unknown) => error instanceof Error
                && error.message === buildRequiredDatabaseSchemaMessage([
                    {
                        tableName: 'trading_accounts',
                        columnName: 'account_mode',
                        migrationPath: 'prisma/migrations/20260312220000_add_trading_account_mode_for_paper_trading/migration.sql',
                    },
                    {
                        tableName: 'trading_trade_intents',
                        columnName: 'id',
                        migrationPath: 'prisma/migrations/20260312233000_add_trading_trade_intents_for_auto_execution_worker/migration.sql',
                    },
                    {
                        tableName: 'trading_execution_commands',
                        columnName: 'trade_intent_id',
                        migrationPath: 'prisma/migrations/20260312233000_add_trading_trade_intents_for_auto_execution_worker/migration.sql',
                    },
                ]),
        );
    });

    it('fails when the candle ingestion foundation table is missing', async () => {
        const prisma = {
            $queryRaw: async () => [
                {
                    table_name: 'signal_definitions',
                    column_name: 'composed_blocks',
                },
                {
                    table_name: 'signal_definitions',
                    column_name: 'is_composed',
                },
                {
                    table_name: 'signal_definitions',
                    column_name: 'created_by',
                },
                {
                    table_name: 'signal_events',
                    column_name: 'indicator_instance_id',
                },
                {
                    table_name: 'signal_logic_traces',
                    column_name: 'indicator_instance_id',
                },
                {
                    table_name: 'indicator_instances',
                    column_name: 'id',
                },
                {
                    table_name: 'indicator_alerts',
                    column_name: 'id',
                },
                {
                    table_name: 'users',
                    column_name: 'active_trading_account_id',
                },
                {
                    table_name: 'trading_accounts',
                    column_name: 'account_mode',
                },
                {
                    table_name: 'trading_trade_intents',
                    column_name: 'id',
                },
                {
                    table_name: 'trading_execution_commands',
                    column_name: 'trade_intent_id',
                },
                ...indicatorCatalogSchemaRows,
            ],
        } as Pick<PrismaClient, '$queryRaw'>;

        await assert.rejects(
            () => assertRequiredDatabaseSchema(prisma),
            (error: unknown) => error instanceof Error
                && error.message === buildRequiredDatabaseSchemaMessage([{
                    tableName: 'price_candles',
                    columnName: 'time',
                    migrationPath: 'prisma/migrations/20260312234500_add_price_candles_foundation/migration.sql',
                }]),
        );
    });

    it('extracts a clear schema mismatch message from Prisma column errors', () => {
        const error = new Error('The column `public.trading_accounts.account_mode` does not exist.');
        Object.assign(error, {
            code: 'P2022',
            meta: {
                column: 'public.trading_accounts.account_mode',
            },
        });

        assert.equal(
            getDatabaseSchemaMismatchMessage(error),
            buildRequiredDatabaseSchemaMessage([{
                tableName: 'trading_accounts',
                columnName: 'account_mode',
                migrationPath: 'prisma/migrations/20260312220000_add_trading_account_mode_for_paper_trading/migration.sql',
            }]),
        );
    });

    it('extracts the corrective migration hint from missing-table Prisma errors', () => {
        const error = new Error('The table `public.price_candles` does not exist in the current database.');
        Object.assign(error, {
            code: 'P2021',
            meta: {
                table: 'public.price_candles',
            },
        });

        assert.equal(
            getDatabaseSchemaMismatchMessage(error),
            buildRequiredDatabaseSchemaMessage([{
                tableName: 'price_candles',
                columnName: 'time',
                migrationPath: 'prisma/migrations/20260312234500_add_price_candles_foundation/migration.sql',
            }]),
        );
    });

    it('extracts the corrective migration hint from indicator runtime column errors', () => {
        const error = new Error('The column `public.signal_definitions.composed_blocks` does not exist.');
        Object.assign(error, {
            code: 'P2022',
            meta: {
                column: 'public.signal_definitions.composed_blocks',
            },
        });

        assert.equal(
            getDatabaseSchemaMismatchMessage(error),
            buildRequiredDatabaseSchemaMessage([{
                tableName: 'signal_definitions',
                columnName: 'composed_blocks',
                migrationPath: 'prisma/migrations/20260311220000_add_indicator_runtime_foundation/migration.sql',
            }]),
        );
    });
});
