import { Prisma, PrismaClient } from '@prisma/client';
import {
    AccountReadinessSnapshot,
    evaluateAccountReadiness,
    evaluateFullAccountReadiness,
    evaluateStoredAccountReadiness,
    evaluateFullStoredAccountReadiness,
} from './TradingAccountReadinessService';
import {
    MT5CredentialCipher,
    MT5CredentialCipherError,
    MT5CredentialPayload,
} from './MT5CredentialCipher';
import { getDatabaseSchemaMismatchMessage } from '../../database/requiredDatabaseSchema';

export type TradingAccountModeValue = 'LIVE' | 'PAPER';

export interface TradingAccountActor {
    id: string;
    role: 'ADMIN' | 'USER';
}

export interface TradingAccountListQuery {
    ownerUserId?: string | null;
}

export interface TradingAccountReadinessQuery {
    accountId?: string | null;
    ownerUserId?: string | null;
}

export interface TradingAccountAccessScope {
    ownerUserId?: string | null;
}

export interface TradingAccountCreateInput {
    ownerUserId?: string | null;
    label: string;
    accountMode?: TradingAccountModeValue | null;
    mt5Login: string;
    mt5Password: string;
    mt5Server: string;
}

export interface TradingAccountUpdateInput {
    label?: string;
    accountMode?: TradingAccountModeValue | null;
    mt5Login?: string;
    mt5Password?: string | null;
    mt5Server?: string;
}

export interface TradingAccountSummary {
    id: string;
    ownerUserId: string;
    ownerEmail: string;
    ownerUsername: string;
    ownerDisplayName: string | null;
    label: string;
    brokerKind: 'MT5';
    accountMode: TradingAccountModeValue;
    status: string;
    baseCurrency: string | null;
    leverage: number | null;
    lastSeenAt: string | null;
    lastSuccessfulSyncAt: string | null;
    mt5Login: string | null;
    mt5Server: string | null;
    hasStoredCredential: boolean;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface TradingAccountListResult {
    accounts: TradingAccountSummary[];
    activeAccountId: string | null;
}

export interface TradingAccountSelectionResult {
    account: TradingAccountSummary;
    activeAccountId: string;
}

export interface TradingAccountDeleteResult {
    id: string;
    activeAccountId: string | null;
}

export interface TradingAccountBrokerContext {
    id: string;
    ownerUserId: string;
    label: string;
    brokerKind: 'MT5';
    accountMode: TradingAccountModeValue;
    status: string;
    baseCurrency: string | null;
    leverage: number | null;
    lastSeenAt: string | null;
    lastSuccessfulSyncAt: string | null;
    metadataJson: Prisma.JsonValue | null;
    credential: MT5CredentialPayload | null;
}

type TradingAccountRow = {
    id: string;
    ownerUserId: string;
    label: string;
    brokerKind?: 'MT5';
    accountMode?: TradingAccountModeValue;
    status?: string;
    baseCurrency?: string | null;
    leverage?: number | null;
    lastSeenAt?: Date | null;
    lastSuccessfulSyncAt?: Date | null;
    metadataJson?: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    ownerUser: {
        id: string;
        email: string;
        username: string;
        displayName: string | null;
    };
    credential: {
        ciphertext: string;
    } | null;
};

type UserActiveSelectionRow = {
    id: string;
    activeTradingAccountId: string | null;
};

type PrismaTransactionClient = Omit<
    PrismaClient,
    '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export class TradingAccountServiceError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code:
            | 'TRADING_ACCOUNT_NOT_FOUND'
            | 'TRADING_ACCOUNT_FORBIDDEN'
            | 'TRADING_ACCOUNT_ALREADY_EXISTS'
            | 'TRADING_ACCOUNT_INVALID'
            | 'TRADING_ACCOUNT_OWNER_NOT_FOUND'
            | 'TRADING_ACCOUNT_ENCRYPTION_REQUIRED'
            | 'TRADING_ACCOUNT_SCHEMA_MISMATCH',
        message: string,
        public readonly domain = 'trading.account-management',
    ) {
        super(message);
        this.name = 'TradingAccountServiceError';
    }
}

function normalizeOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function requireString(
    value: unknown,
    fieldName: string,
    { min = 1, max = 120 }: { min?: number; max?: number } = {},
): string {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        throw new TradingAccountServiceError(
            400,
            'TRADING_ACCOUNT_INVALID',
            `${fieldName} is required.`,
        );
    }

    if (normalized.length < min) {
        throw new TradingAccountServiceError(
            400,
            'TRADING_ACCOUNT_INVALID',
            `${fieldName} must be at least ${min} characters.`,
        );
    }

    if (normalized.length > max) {
        throw new TradingAccountServiceError(
            400,
            'TRADING_ACCOUNT_INVALID',
            `${fieldName} must be ${max} characters or fewer.`,
        );
    }

    return normalized;
}

function parseAccountMode(value: unknown, fallback: TradingAccountModeValue = 'LIVE'): TradingAccountModeValue {
    if (value === undefined || value === null) {
        return fallback;
    }

    if (typeof value !== 'string') {
        throw new TradingAccountServiceError(
            400,
            'TRADING_ACCOUNT_INVALID',
            'accountMode must be either LIVE or PAPER.',
        );
    }

    const normalized = value.trim().toUpperCase();
    if (normalized === 'LIVE' || normalized === 'PAPER') {
        return normalized;
    }

    throw new TradingAccountServiceError(
        400,
        'TRADING_ACCOUNT_INVALID',
        'accountMode must be either LIVE or PAPER.',
    );
}

export class TradingAccountService {
    private readonly cipher: MT5CredentialCipher;

    constructor(
        private readonly prisma: PrismaClient,
        private readonly env: NodeJS.ProcessEnv = process.env,
    ) {
        this.cipher = new MT5CredentialCipher(env);
    }

    async listAccounts(
        actor: TradingAccountActor,
        query: TradingAccountListQuery = {},
    ): Promise<TradingAccountListResult> {
        const ownerUserId = this.resolveTargetUserId(actor, query.ownerUserId ?? null, true);
        const rows = await this.prisma.tradingAccount.findMany({
            where: ownerUserId ? { ownerUserId } : undefined,
            orderBy: ownerUserId
                ? [
                    { updatedAt: 'desc' },
                    { id: 'desc' },
                ]
                : [
                    { ownerUserId: 'asc' },
                    { updatedAt: 'desc' },
                    { id: 'desc' },
                ],
            include: {
                ownerUser: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        displayName: true,
                    },
                },
                credential: {
                    select: {
                        ciphertext: true,
                    },
                },
            },
        });

        const activeAccountIdByOwner = ownerUserId
            ? {
                [ownerUserId]: await this.getStoredActiveAccountId(ownerUserId),
            }
            : await this.loadActiveAccountMap(rows.map((row) => row.ownerUserId));

        return {
            accounts: rows.map((row: unknown) => this.mapSummary(
                row as TradingAccountRow,
                activeAccountIdByOwner[(row as TradingAccountRow).ownerUserId] ?? null,
            )),
            activeAccountId: ownerUserId ? activeAccountIdByOwner[ownerUserId] ?? null : null,
        };
    }

    async createAccount(actor: TradingAccountActor, input: TradingAccountCreateInput): Promise<TradingAccountSummary> {
        const ownerUserId = this.resolveTargetUserId(actor, input.ownerUserId ?? null, true);
        const label = requireString(input.label, 'label');
        const accountMode = parseAccountMode(input.accountMode, 'LIVE');
        const credential = this.buildCredentialPayload(input);

        try {
            const row = await this.prisma.$transaction(async (tx) => {
                const ownerUser = await this.ensureOwnerUser(ownerUserId, tx);
                const created = await tx.tradingAccount.create({
                    data: {
                        ownerUserId: ownerUser.id,
                        label,
                        accountMode,
                        credential: {
                            create: {
                                ciphertext: this.cipher.encrypt(credential),
                            },
                        },
                    },
                    include: {
                        ownerUser: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                displayName: true,
                            },
                        },
                        credential: {
                            select: {
                                ciphertext: true,
                            },
                        },
                    },
                });

                if (!ownerUser.activeTradingAccountId) {
                    await tx.user.update({
                        where: { id: ownerUser.id },
                        data: {
                            activeTradingAccountId: created.id,
                        },
                    });
                }

                return created;
            });

            const activeAccountId = await this.getStoredActiveAccountId(row.ownerUserId);
            return this.mapSummary(row as TradingAccountRow, activeAccountId);
        } catch (error) {
            this.rethrowPersistenceError(error);
        }
    }

    async updateAccount(
        actor: TradingAccountActor,
        accountId: string,
        input: TradingAccountUpdateInput,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingAccountSummary> {
        const account = await this.loadAccessibleAccount(actor, accountId, scope);
        const currentCredential = account.credential
            ? this.safeDecryptCredential(account.credential.ciphertext)
            : null;

        const nextLabel = input.label === undefined
            ? account.label
            : requireString(input.label, 'label');
        const nextAccountMode = input.accountMode === undefined
            ? account.accountMode ?? 'LIVE'
            : parseAccountMode(input.accountMode, account.accountMode ?? 'LIVE');
        const nextCredential = this.buildMergedCredential(input, currentCredential);

        try {
            const row = await this.prisma.tradingAccount.update({
                where: { id: account.id },
                data: {
                    label: nextLabel,
                    accountMode: nextAccountMode,
                    credential: {
                        upsert: {
                            update: {
                                ciphertext: this.cipher.encrypt(nextCredential),
                            },
                            create: {
                                ciphertext: this.cipher.encrypt(nextCredential),
                            },
                        },
                    },
                },
                include: {
                    ownerUser: {
                        select: {
                            id: true,
                            email: true,
                            username: true,
                            displayName: true,
                        },
                    },
                    credential: {
                        select: {
                            ciphertext: true,
                        },
                    },
                },
            });

            const activeAccountId = await this.getStoredActiveAccountId(row.ownerUserId);
            return this.mapSummary(row as TradingAccountRow, activeAccountId);
        } catch (error) {
            this.rethrowPersistenceError(error);
        }
    }

    async deleteAccount(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingAccountDeleteResult> {
        const account = await this.loadAccessibleAccount(actor, accountId, scope);

        return this.prisma.$transaction(async (tx) => {
            const owner = await tx.user.findUnique({
                where: { id: account.ownerUserId },
                select: {
                    id: true,
                    activeTradingAccountId: true,
                },
            });

            const deletedAccountWasActive = owner?.activeTradingAccountId === account.id;
            const fallback = deletedAccountWasActive
                ? await tx.tradingAccount.findFirst({
                    where: {
                        ownerUserId: account.ownerUserId,
                        id: {
                            not: account.id,
                        },
                    },
                    orderBy: [
                        { updatedAt: 'desc' },
                        { id: 'desc' },
                    ],
                    select: {
                        id: true,
                    },
                })
                : null;

            await tx.tradingAccount.delete({
                where: { id: account.id },
            });

            let activeAccountId = owner?.activeTradingAccountId ?? null;
            if (owner && deletedAccountWasActive) {
                activeAccountId = fallback?.id ?? null;
                await tx.user.update({
                    where: { id: owner.id },
                    data: {
                        activeTradingAccountId: activeAccountId,
                    },
                });
            }

            return {
                id: account.id,
                activeAccountId,
            };
        });
    }

    async selectActiveAccount(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingAccountSelectionResult> {
        const account = await this.loadAccessibleAccount(actor, accountId, scope);

        await this.prisma.user.update({
            where: { id: account.ownerUserId },
            data: {
                activeTradingAccountId: account.id,
            },
        });

        return {
            account: this.mapSummary(account, account.id),
            activeAccountId: account.id,
        };
    }

    async getReadinessSnapshotForUser(
        userId: string | null,
        query: TradingAccountReadinessQuery = {},
    ): Promise<AccountReadinessSnapshot> {
        if (!userId) {
            return evaluateAccountReadiness(this.env);
        }

        const account = await this.resolveReadinessAccount(userId, query.accountId ?? null);
        if (!account || !account.credential) {
            return evaluateStoredAccountReadiness(null, this.env);
        }

        const credential = this.safeDecryptCredential(account.credential.ciphertext);
        return evaluateStoredAccountReadiness({
            accountId: account.id,
            accountLabel: account.label,
            accountMode: account.accountMode ?? 'LIVE',
            mt5Login: credential?.mt5Login ?? null,
            mt5Password: credential?.mt5Password ?? null,
            mt5Server: credential?.mt5Server ?? null,
        }, this.env);
    }

    async getReadinessSnapshotForActor(
        actor: TradingAccountActor | null,
        query: TradingAccountReadinessQuery = {},
    ): Promise<AccountReadinessSnapshot> {
        if (!actor) {
            return evaluateAccountReadiness(this.env);
        }

        const account = await this.resolveReadinessAccountForActor(
            actor,
            query.accountId ?? null,
            query.ownerUserId ?? null,
        );
        if (!account || !account.credential) {
            return evaluateStoredAccountReadiness(null, this.env);
        }

        const credential = this.safeDecryptCredential(account.credential.ciphertext);
        return evaluateStoredAccountReadiness({
            accountId: account.id,
            accountLabel: account.label,
            accountMode: account.accountMode ?? 'LIVE',
            mt5Login: credential?.mt5Login ?? null,
            mt5Password: credential?.mt5Password ?? null,
            mt5Server: credential?.mt5Server ?? null,
        }, this.env);
    }

    async getFullReadinessSnapshotForUser(
        userId: string | null,
        query: TradingAccountReadinessQuery = {},
    ): Promise<AccountReadinessSnapshot> {
        if (!userId) {
            return evaluateFullAccountReadiness(this.env);
        }

        const account = await this.resolveReadinessAccount(userId, query.accountId ?? null);
        if (!account || !account.credential) {
            return evaluateFullStoredAccountReadiness(null, this.env);
        }

        const credential = this.safeDecryptCredential(account.credential.ciphertext);
        return evaluateFullStoredAccountReadiness({
            accountId: account.id,
            accountLabel: account.label,
            accountMode: account.accountMode ?? 'LIVE',
            mt5Login: credential?.mt5Login ?? null,
            mt5Password: credential?.mt5Password ?? null,
            mt5Server: credential?.mt5Server ?? null,
        }, this.env);
    }

    async getFullReadinessSnapshotForActor(
        actor: TradingAccountActor | null,
        query: TradingAccountReadinessQuery = {},
    ): Promise<AccountReadinessSnapshot> {
        if (!actor) {
            return evaluateFullAccountReadiness(this.env);
        }

        const account = await this.resolveReadinessAccountForActor(
            actor,
            query.accountId ?? null,
            query.ownerUserId ?? null,
        );
        if (!account || !account.credential) {
            return evaluateFullStoredAccountReadiness(null, this.env);
        }

        const credential = this.safeDecryptCredential(account.credential.ciphertext);
        return evaluateFullStoredAccountReadiness({
            accountId: account.id,
            accountLabel: account.label,
            accountMode: account.accountMode ?? 'LIVE',
            mt5Login: credential?.mt5Login ?? null,
            mt5Password: credential?.mt5Password ?? null,
            mt5Server: credential?.mt5Server ?? null,
        }, this.env);
    }

    async getBrokerContext(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingAccountBrokerContext> {
        const account = await this.loadAccessibleAccount(actor, accountId, scope);

        return {
            id: account.id,
            ownerUserId: account.ownerUserId,
            label: account.label,
            brokerKind: account.brokerKind ?? 'MT5',
            accountMode: account.accountMode ?? 'LIVE',
            status: account.status ?? 'PENDING',
            baseCurrency: account.baseCurrency ?? null,
            leverage: account.leverage ?? null,
            lastSeenAt: account.lastSeenAt?.toISOString() ?? null,
            lastSuccessfulSyncAt: account.lastSuccessfulSyncAt?.toISOString() ?? null,
            metadataJson: account.metadataJson ?? null,
            credential: account.credential
                ? this.safeDecryptCredential(account.credential.ciphertext)
                : null,
        };
    }

    private buildCredentialPayload(input: TradingAccountCreateInput): MT5CredentialPayload {
        return {
            mt5Login: requireString(input.mt5Login, 'mt5Login', { max: 60 }),
            mt5Password: requireString(input.mt5Password, 'mt5Password', { max: 255 }),
            mt5Server: requireString(input.mt5Server, 'mt5Server', { max: 120 }),
        };
    }

    private buildMergedCredential(
        input: TradingAccountUpdateInput,
        current: MT5CredentialPayload | null,
    ): MT5CredentialPayload {
        const mt5Login = input.mt5Login === undefined
            ? current?.mt5Login ?? null
            : input.mt5Login;
        const mt5Password = input.mt5Password === undefined || input.mt5Password === null
            ? current?.mt5Password ?? null
            : input.mt5Password;
        const mt5Server = input.mt5Server === undefined
            ? current?.mt5Server ?? null
            : input.mt5Server;

        return {
            mt5Login: requireString(mt5Login, 'mt5Login', { max: 60 }),
            mt5Password: requireString(mt5Password, 'mt5Password', { max: 255 }),
            mt5Server: requireString(mt5Server, 'mt5Server', { max: 120 }),
        };
    }

    private resolveTargetUserId(
        actor: TradingAccountActor,
        requestedOwnerUserId: string | null,
        defaultToSelf: boolean,
    ): string | null {
        if (!requestedOwnerUserId) {
            return actor.role === 'ADMIN' && !defaultToSelf
                ? null
                : actor.id;
        }

        if (actor.role !== 'ADMIN' && requestedOwnerUserId !== actor.id) {
            throw new TradingAccountServiceError(
                403,
                'TRADING_ACCOUNT_FORBIDDEN',
                'This account can only manage its own MT5 connection.',
            );
        }

        return requestedOwnerUserId;
    }

    private async ensureOwnerUser(
        ownerUserId: string | null,
        prisma: Pick<PrismaTransactionClient, 'user'> = this.prisma,
    ): Promise<UserActiveSelectionRow> {
        if (!ownerUserId) {
            throw new TradingAccountServiceError(
                400,
                'TRADING_ACCOUNT_OWNER_NOT_FOUND',
                'ownerUserId is required.',
            );
        }

        const user = await prisma.user.findUnique({
            where: { id: ownerUserId },
            select: {
                id: true,
                activeTradingAccountId: true,
            },
        });
        if (!user) {
            throw new TradingAccountServiceError(
                404,
                'TRADING_ACCOUNT_OWNER_NOT_FOUND',
                `User ${ownerUserId} was not found.`,
            );
        }

        return user as UserActiveSelectionRow;
    }

    private async loadAccessibleAccount(
        actor: TradingAccountActor,
        accountId: string,
        scope: TradingAccountAccessScope = {},
    ): Promise<TradingAccountRow> {
        const normalizedAccountId = requireString(accountId, 'accountId', { max: 191 });
        const account = await this.prisma.tradingAccount.findUnique({
            where: { id: normalizedAccountId },
            include: {
                ownerUser: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        displayName: true,
                    },
                },
                credential: {
                    select: {
                        ciphertext: true,
                    },
                },
            },
        });

        if (!account) {
            throw new TradingAccountServiceError(
                404,
                'TRADING_ACCOUNT_NOT_FOUND',
                `Trading account ${normalizedAccountId} was not found.`,
            );
        }

        if (actor.role !== 'ADMIN' && account.ownerUserId !== actor.id) {
            throw new TradingAccountServiceError(
                403,
                'TRADING_ACCOUNT_FORBIDDEN',
                'This account can only manage its own MT5 connection.',
            );
        }

        if (
            actor.role === 'ADMIN'
            && account.ownerUserId !== actor.id
            && scope.ownerUserId !== account.ownerUserId
        ) {
            throw new TradingAccountServiceError(
                403,
                'TRADING_ACCOUNT_FORBIDDEN',
                'Admin access to another user\'s MT5 connection requires an explicit owner scope.',
            );
        }

        return account as TradingAccountRow;
    }

    private async resolveReadinessAccount(userId: string, explicitAccountId: string | null): Promise<TradingAccountRow | null> {
        if (explicitAccountId) {
            return this.prisma.tradingAccount.findFirst({
                where: {
                    id: explicitAccountId,
                    ownerUserId: userId,
                },
                include: {
                    ownerUser: {
                        select: {
                            id: true,
                            email: true,
                            username: true,
                            displayName: true,
                        },
                    },
                    credential: {
                        select: {
                            ciphertext: true,
                        },
                    },
                },
            }) as Promise<TradingAccountRow | null>;
        }

        return this.resolveActiveAccountForUser(userId);
    }

    private async resolveReadinessAccountForActor(
        actor: TradingAccountActor,
        explicitAccountId: string | null,
        scopedOwnerUserId: string | null,
    ): Promise<TradingAccountRow | null> {
        if (explicitAccountId) {
            if (actor.role === 'ADMIN' && scopedOwnerUserId) {
                return this.prisma.tradingAccount.findFirst({
                    where: {
                        id: explicitAccountId,
                        ownerUserId: scopedOwnerUserId,
                    },
                    include: {
                        ownerUser: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                displayName: true,
                            },
                        },
                        credential: {
                            select: {
                                ciphertext: true,
                            },
                        },
                    },
                }) as Promise<TradingAccountRow | null>;
            }

            if (actor.role === 'ADMIN' && !scopedOwnerUserId) {
                const account = await this.prisma.tradingAccount.findFirst({
                    where: {
                        id: explicitAccountId,
                    },
                    include: {
                        ownerUser: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                displayName: true,
                            },
                        },
                        credential: {
                            select: {
                                ciphertext: true,
                            },
                        },
                    },
                }) as TradingAccountRow | null;

                if (account && account.ownerUserId !== actor.id) {
                    throw new TradingAccountServiceError(
                        403,
                        'TRADING_ACCOUNT_FORBIDDEN',
                        'Admin access to another user\'s MT5 connection requires an explicit owner scope.',
                    );
                }

                return account;
            }

            return this.prisma.tradingAccount.findFirst({
                where: {
                    id: explicitAccountId,
                    ...(actor.role === 'ADMIN' ? {} : { ownerUserId: actor.id }),
                },
                include: {
                    ownerUser: {
                        select: {
                            id: true,
                            email: true,
                            username: true,
                            displayName: true,
                        },
                    },
                    credential: {
                        select: {
                            ciphertext: true,
                        },
                    },
                },
            }) as Promise<TradingAccountRow | null>;
        }

        return this.resolveActiveAccountForUser(
            actor.role === 'ADMIN' && scopedOwnerUserId
                ? scopedOwnerUserId
                : actor.id,
        );
    }

    private async resolveActiveAccountForUser(userId: string): Promise<TradingAccountRow | null> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                activeTradingAccountId: true,
            },
        });

        if (!user) {
            return null;
        }

        if (user.activeTradingAccountId) {
            const activeAccount = await this.prisma.tradingAccount.findFirst({
                where: {
                    id: user.activeTradingAccountId,
                    ownerUserId: userId,
                },
                include: {
                    ownerUser: {
                        select: {
                            id: true,
                            email: true,
                            username: true,
                            displayName: true,
                        },
                    },
                    credential: {
                        select: {
                            ciphertext: true,
                        },
                    },
                },
            });

            if (activeAccount) {
                return activeAccount as TradingAccountRow;
            }
        }

        const fallbackAccount = await this.prisma.tradingAccount.findFirst({
            where: { ownerUserId: userId },
            orderBy: [
                { updatedAt: 'desc' },
                { id: 'desc' },
            ],
            include: {
                ownerUser: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        displayName: true,
                    },
                },
                credential: {
                    select: {
                        ciphertext: true,
                    },
                },
            },
        });

        const nextActiveAccountId = fallbackAccount?.id ?? null;
        if (user.activeTradingAccountId !== nextActiveAccountId) {
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    activeTradingAccountId: nextActiveAccountId,
                },
            });
        }

        return fallbackAccount as TradingAccountRow | null;
    }

    private async getStoredActiveAccountId(ownerUserId: string): Promise<string | null> {
        const ownerUser = await this.prisma.user.findUnique({
            where: { id: ownerUserId },
            select: {
                activeTradingAccountId: true,
            },
        });

        return ownerUser?.activeTradingAccountId ?? null;
    }

    private async loadActiveAccountMap(ownerUserIds: string[]): Promise<Record<string, string | null>> {
        const uniqueOwnerUserIds = [...new Set(ownerUserIds.filter(Boolean))];
        if (uniqueOwnerUserIds.length === 0) {
            return {};
        }

        const ownerRows = await this.prisma.user.findMany({
            where: {
                id: {
                    in: uniqueOwnerUserIds,
                },
            },
            select: {
                id: true,
                activeTradingAccountId: true,
            },
        });

        return ownerRows.reduce<Record<string, string | null>>((result, row) => {
            result[row.id] = row.activeTradingAccountId ?? null;
            return result;
        }, {});
    }

    private safeDecryptCredential(ciphertext: string): MT5CredentialPayload | null {
        try {
            return this.cipher.decrypt(ciphertext);
        } catch (error) {
            if (error instanceof MT5CredentialCipherError && error.code === 'ENCRYPTION_KEY_REQUIRED') {
                throw new TradingAccountServiceError(
                    500,
                    'TRADING_ACCOUNT_ENCRYPTION_REQUIRED',
                    error.message,
                );
            }

            return null;
        }
    }

    private mapSummary(row: TradingAccountRow, activeAccountId: string | null): TradingAccountSummary {
        const credential = row.credential
            ? this.safeDecryptCredential(row.credential.ciphertext)
            : null;

        return {
            id: row.id,
            ownerUserId: row.ownerUserId,
            ownerEmail: row.ownerUser.email,
            ownerUsername: row.ownerUser.username,
            ownerDisplayName: row.ownerUser.displayName,
            label: row.label,
            brokerKind: row.brokerKind ?? 'MT5',
            accountMode: row.accountMode ?? 'LIVE',
            status: row.status ?? 'PENDING',
            baseCurrency: row.baseCurrency ?? null,
            leverage: row.leverage ?? null,
            lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
            lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
            mt5Login: credential?.mt5Login ?? null,
            mt5Server: credential?.mt5Server ?? null,
            hasStoredCredential: Boolean(row.credential),
            isActive: activeAccountId === row.id,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }

    private rethrowPersistenceError(error: unknown): never {
        const candidate = error as Error & {
            code?: string;
        };
        const code = typeof candidate?.code === 'string' ? candidate.code : null;

        if (code === 'P2002') {
            throw new TradingAccountServiceError(
                409,
                'TRADING_ACCOUNT_ALREADY_EXISTS',
                'The MT5 account request conflicted with an existing unique record.',
            );
        }

        if (error instanceof TradingAccountServiceError) {
            throw error;
        }

        const schemaMismatchMessage = getDatabaseSchemaMismatchMessage(error);
        if (schemaMismatchMessage) {
            throw new TradingAccountServiceError(
                500,
                'TRADING_ACCOUNT_SCHEMA_MISMATCH',
                schemaMismatchMessage,
            );
        }

        if (error instanceof MT5CredentialCipherError && error.code === 'ENCRYPTION_KEY_REQUIRED') {
            throw new TradingAccountServiceError(
                500,
                'TRADING_ACCOUNT_ENCRYPTION_REQUIRED',
                error.message,
            );
        }

        throw error;
    }
}
