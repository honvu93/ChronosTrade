import { resolveMT5BridgePort } from './mt5BridgeConfig';

export type AccountReadinessState =
    | 'ready'
    | 'execution-blocked'
    | 'credentials-missing'
    | 'credentials-partial'
    | 'bridge-unreachable'
    | 'unchecked';

export interface AccountReadinessCheckItem {
    key: string;
    label: string;
    passed: boolean;
    detail: string;
}

export interface AccountReadinessSnapshot {
    state: AccountReadinessState;
    checks: AccountReadinessCheckItem[];
    blockingReasons: string[];
    executionFailureCode: string | null;
    executionReadinessMessage: string | null;
    accountId: string | null;
    accountLabel: string | null;
    accountMode: 'LIVE' | 'PAPER' | null;
    hasStoredCredential: boolean;
    mt5Login: string | null;
    mt5Server: string | null;
    bridgePort: string | null;
    evaluatedAt: string;
}

interface EnvSource {
    MT5_EXEC_BRIDGE_PORT?: string;
    MT5_LOGIN?: string;
    MT5_PASSWORD?: string;
    MT5_SERVER?: string;
    MT5_BRIDGE_PORT?: string;
    ENCRYPTION_KEY?: string;
}

interface BridgeExecutionReadinessBlocker {
    code: string;
    message: string;
    field?: string | null;
    origin?: 'terminal' | 'account' | 'bridge' | null;
    value?: boolean | null;
}

interface BridgeExecutionReadinessPayload {
    ready: boolean;
    message: string;
    failureCode: string | null;
    blockers: BridgeExecutionReadinessBlocker[];
    terminal: {
        tradeAllowed: boolean | null;
        tradeApiDisabled: boolean | null;
    };
    account: {
        tradeAllowed: boolean | null;
    };
}

interface BridgeEnvelope<T> {
    ok: boolean;
    data?: T;
    error?: {
        code?: string;
        message?: string;
    };
}

interface ExecutionReadinessCheckResult {
    state: Extract<AccountReadinessState, 'execution-blocked' | 'bridge-unreachable'>;
    checks: AccountReadinessCheckItem[];
    blockingReasons: string[];
    failureCode: string | null;
    message: string | null;
}

export interface StoredAccountCredentialSource {
    accountId: string;
    accountLabel: string;
    accountMode: 'LIVE' | 'PAPER';
    mt5Login: string | null;
    mt5Password: string | null;
    mt5Server: string | null;
}

function withExecutionDefaults(snapshot: Omit<AccountReadinessSnapshot, 'executionFailureCode' | 'executionReadinessMessage'>): AccountReadinessSnapshot {
    return {
        ...snapshot,
        executionFailureCode: null,
        executionReadinessMessage: null,
    };
}

export function evaluateAccountReadiness(env: EnvSource): AccountReadinessSnapshot {
    const checks: AccountReadinessCheckItem[] = [];
    const blockingReasons: string[] = [];

    const mt5Login = env.MT5_LOGIN?.trim() || null;
    const mt5Password = env.MT5_PASSWORD?.trim() || null;
    const mt5Server = env.MT5_SERVER?.trim() || null;
    const bridgePortConfig = resolveMT5BridgePort(env);
    const bridgePort = bridgePortConfig.port;
    const encryptionKey = env.ENCRYPTION_KEY?.trim() || null;

    checks.push({
        key: 'mt5_login',
        label: 'MT5 Login',
        passed: mt5Login !== null && mt5Login.length > 0,
        detail: mt5Login ? `Login ${mt5Login} configured` : 'MT5_LOGIN environment variable is not set.',
    });

    checks.push({
        key: 'mt5_password',
        label: 'MT5 Password',
        passed: mt5Password !== null && mt5Password.length > 0,
        detail: mt5Password ? 'Password configured (masked)' : 'MT5_PASSWORD environment variable is not set.',
    });

    checks.push({
        key: 'mt5_server',
        label: 'MT5 Server',
        passed: mt5Server !== null && mt5Server.length > 0,
        detail: mt5Server ? `Server: ${mt5Server}` : 'MT5_SERVER environment variable is not set.',
    });

    checks.push({
        key: 'bridge_port',
        label: 'MT5 Bridge Port',
        passed: bridgePort.length > 0,
        detail: bridgePortConfig.source === 'exec-env'
            ? `Execution bridge port: ${bridgePort}`
            : bridgePortConfig.source === 'legacy-env'
                ? `Bridge port: ${bridgePort}`
                : `Bridge port: ${bridgePort} (default)`,
    });

    checks.push({
        key: 'encryption_key',
        label: 'Credential Encryption Key',
        passed: encryptionKey !== null && encryptionKey.length >= 32,
        detail: encryptionKey
            ? (encryptionKey.length >= 32
                ? 'Encryption key configured (256-bit minimum met)'
                : `Encryption key too short (${encryptionKey.length} chars, 32 required)`)
            : 'ENCRYPTION_KEY environment variable is not set.',
    });

    const credentialKeys = ['mt5_login', 'mt5_password', 'mt5_server'] as const;
    const credentialChecks = checks.filter((c) => credentialKeys.includes(c.key as typeof credentialKeys[number]));
    const credentialsPassed = credentialChecks.filter((c) => c.passed).length;
    const credentialsMissing = credentialChecks.filter((c) => !c.passed);

    for (const missing of credentialsMissing) {
        blockingReasons.push(missing.detail);
    }

    const bridgeCheck = checks.find((c) => c.key === 'bridge_port');
    if (bridgeCheck && !bridgeCheck.passed) {
        blockingReasons.push(bridgeCheck.detail);
    }

    const encryptionCheck = checks.find((c) => c.key === 'encryption_key');
    if (encryptionCheck && !encryptionCheck.passed) {
        blockingReasons.push(encryptionCheck.detail);
    }

    let state: AccountReadinessState;
    if (credentialsPassed === 0) {
        state = 'credentials-missing';
    } else if (credentialsPassed < credentialKeys.length) {
        state = 'credentials-partial';
    } else if (!bridgeCheck?.passed) {
        state = 'bridge-unreachable';
    } else if (blockingReasons.length > 0) {
        state = 'credentials-partial';
    } else {
        state = 'ready';
    }

    return withExecutionDefaults({
        state,
        checks,
        blockingReasons,
        accountId: null,
        accountLabel: null,
        accountMode: null,
        hasStoredCredential: credentialsPassed > 0,
        mt5Login,
        mt5Server,
        bridgePort,
        evaluatedAt: new Date().toISOString(),
    });
}

export function evaluateStoredAccountReadiness(
    account: StoredAccountCredentialSource | null,
    env: EnvSource,
): AccountReadinessSnapshot {
    const checks: AccountReadinessCheckItem[] = [];
    const blockingReasons: string[] = [];
    const bridgePortConfig = resolveMT5BridgePort(env);
    const bridgePort = bridgePortConfig.port;
    const encryptionKey = env.ENCRYPTION_KEY?.trim() || null;

    const mt5Login = account?.mt5Login?.trim() || null;
    const mt5Password = account?.mt5Password?.trim() || null;
    const mt5Server = account?.mt5Server?.trim() || null;
    const accountMode = account?.accountMode ?? null;

    checks.push({
        key: 'saved_account',
        label: 'Saved MT5 Account',
        passed: account !== null,
        detail: account
            ? `Account ${account.accountLabel} is connected for this user as ${account.accountMode === 'PAPER' ? 'paper/demo' : 'live'} trading.`
            : 'No MT5 account has been connected for this user yet.',
    });

    checks.push({
        key: 'mt5_login',
        label: 'MT5 Login',
        passed: mt5Login !== null && mt5Login.length > 0,
        detail: mt5Login
            ? `Login ${mt5Login} is saved for ${account?.accountLabel ?? 'this account'}.`
            : 'The saved MT5 login is missing for this account.',
    });

    checks.push({
        key: 'mt5_password',
        label: 'MT5 Password',
        passed: mt5Password !== null && mt5Password.length > 0,
        detail: mt5Password
            ? 'Password is saved for this account.'
            : 'The saved MT5 password is missing for this account.',
    });

    checks.push({
        key: 'mt5_server',
        label: 'MT5 Server',
        passed: mt5Server !== null && mt5Server.length > 0,
        detail: mt5Server
            ? `Server ${mt5Server} is saved for ${account?.accountLabel ?? 'this account'}.`
            : 'The saved MT5 server is missing for this account.',
    });

    checks.push({
        key: 'bridge_port',
        label: 'MT5 Bridge Port',
        passed: bridgePort.length > 0,
        detail: bridgePortConfig.source === 'exec-env'
            ? `Execution bridge port: ${bridgePort}`
            : bridgePortConfig.source === 'legacy-env'
                ? `Bridge port: ${bridgePort}`
                : `Bridge port: ${bridgePort} (default)`,
    });

    checks.push({
        key: 'encryption_key',
        label: 'Credential Encryption Key',
        passed: encryptionKey !== null && encryptionKey.length >= 32,
        detail: encryptionKey
            ? (encryptionKey.length >= 32
                ? 'Encryption key configured (256-bit minimum met)'
                : `Encryption key too short (${encryptionKey.length} chars, 32 required)`)
            : 'ENCRYPTION_KEY environment variable is not set.',
    });

    const credentialKeys = ['saved_account', 'mt5_login', 'mt5_password', 'mt5_server'] as const;
    const credentialChecks = checks.filter((c) => credentialKeys.includes(c.key as typeof credentialKeys[number]));
    const credentialFailures = credentialChecks.filter((c) => !c.passed);
    const bridgeCheck = checks.find((c) => c.key === 'bridge_port');
    const encryptionCheck = checks.find((c) => c.key === 'encryption_key');

    for (const missing of credentialFailures) {
        blockingReasons.push(missing.detail);
    }

    if (bridgeCheck && !bridgeCheck.passed) {
        blockingReasons.push(bridgeCheck.detail);
    }

    if (encryptionCheck && !encryptionCheck.passed) {
        blockingReasons.push(encryptionCheck.detail);
    }

    let state: AccountReadinessState;
    if (!account) {
        state = 'credentials-missing';
    } else if (credentialFailures.length > 0) {
        state = 'credentials-partial';
    } else if (!bridgeCheck?.passed) {
        state = 'bridge-unreachable';
    } else if (!encryptionCheck?.passed) {
        state = 'credentials-partial';
    } else {
        state = 'ready';
    }

    return withExecutionDefaults({
        state,
        checks,
        blockingReasons,
        accountId: account?.accountId ?? null,
        accountLabel: account?.accountLabel ?? null,
        accountMode,
        hasStoredCredential: account !== null,
        mt5Login,
        mt5Server,
        bridgePort,
        evaluatedAt: new Date().toISOString(),
    });
}

export async function checkBridgeHealth(bridgePort: string): Promise<AccountReadinessCheckItem> {
    const url = `http://localhost:${bridgePort}/bridge/health`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.ok) {
            return {
                key: 'bridge_health',
                label: 'MT5 Bridge Health',
                passed: true,
                detail: `Bridge responding on port ${bridgePort}.`,
            };
        }

        return {
            key: 'bridge_health',
            label: 'MT5 Bridge Health',
            passed: false,
            detail: `Bridge returned HTTP ${response.status} on port ${bridgePort}.`,
        };
    } catch {
        return {
            key: 'bridge_health',
            label: 'MT5 Bridge Health',
            passed: false,
            detail: `Bridge is not reachable on port ${bridgePort}. Ensure mt5-service is running.`,
        };
    }
}

async function checkBridgeExecutionReadiness(
    account: Pick<StoredAccountCredentialSource, 'mt5Login' | 'mt5Password' | 'mt5Server'>,
    bridgePort: string,
): Promise<ExecutionReadinessCheckResult> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`http://localhost:${bridgePort}/bridge/account/readiness`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            signal: controller.signal,
            body: JSON.stringify({
                mt5Login: account.mt5Login,
                mt5Password: account.mt5Password,
                mt5Server: account.mt5Server,
            }),
        });

        const payload = await response.json().catch(() => null) as BridgeEnvelope<BridgeExecutionReadinessPayload> | null;
        if (!response.ok || !payload || payload.ok === false || !payload.data) {
            const message = payload?.error?.message
                ?? `Execution readiness check failed with HTTP ${response.status}.`;
            return {
                state: 'bridge-unreachable',
                checks: [{
                    key: 'execution_readiness',
                    label: 'Execution Readiness',
                    passed: false,
                    detail: message,
                }],
                blockingReasons: [message],
                failureCode: payload?.error?.code ?? 'EXECUTION_READINESS_FAILED',
                message,
            };
        }

        const readiness = payload.data;
        const blockers = readiness.blockers ?? [];
        const blockingReasons = blockers.map((blocker) => blocker.message).filter(Boolean);

        return {
            state: 'execution-blocked',
            checks: [
                {
                    key: 'execution_readiness',
                    label: 'Execution Readiness',
                    passed: readiness.ready,
                    detail: readiness.ready
                        ? readiness.message
                        : readiness.message || 'Execution readiness is blocked by terminal or account settings.',
                },
                {
                    key: 'terminal_trade_allowed',
                    label: 'Terminal Trade Allowed',
                    passed: readiness.terminal.tradeAllowed !== false,
                    detail: readiness.terminal.tradeAllowed === false
                        ? 'The MT5 terminal reports trade_allowed=false.'
                        : 'The MT5 terminal allows trading requests.',
                },
                {
                    key: 'terminal_tradeapi_disabled',
                    label: 'External Python Trading',
                    passed: readiness.terminal.tradeApiDisabled !== true,
                    detail: readiness.terminal.tradeApiDisabled === true
                        ? 'The MT5 terminal reports tradeapi_disabled=true.'
                        : 'The MT5 terminal allows external Python trading.',
                },
                {
                    key: 'account_trade_allowed',
                    label: 'Account Trade Allowed',
                    passed: readiness.account.tradeAllowed !== false,
                    detail: readiness.account.tradeAllowed === false
                        ? 'The broker account reports trade_allowed=false.'
                        : 'The broker account is allowed to trade.',
                },
            ],
            blockingReasons: blockingReasons.length > 0
                ? blockingReasons
                : (readiness.ready ? [] : [readiness.message]),
            failureCode: readiness.ready ? null : readiness.failureCode,
            message: readiness.message,
        };
    } catch (error) {
        const message = error instanceof Error
            ? `Execution readiness check failed: ${error.message}`
            : 'Execution readiness check failed.';
        return {
            state: 'bridge-unreachable',
            checks: [{
                key: 'execution_readiness',
                label: 'Execution Readiness',
                passed: false,
                detail: message,
            }],
            blockingReasons: [message],
            failureCode: 'EXECUTION_READINESS_FAILED',
            message,
        };
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

export async function evaluateFullAccountReadiness(env: EnvSource): Promise<AccountReadinessSnapshot> {
    const snapshot = evaluateAccountReadiness(env);

    if (snapshot.bridgePort) {
        const healthCheck = await checkBridgeHealth(snapshot.bridgePort);
        snapshot.checks.push(healthCheck);

        if (!healthCheck.passed) {
            snapshot.blockingReasons.push(healthCheck.detail);
            if (snapshot.state === 'ready') {
                snapshot.state = 'bridge-unreachable';
            }
        }
    }

    return snapshot;
}

export async function evaluateFullStoredAccountReadiness(
    account: StoredAccountCredentialSource | null,
    env: EnvSource,
): Promise<AccountReadinessSnapshot> {
    const snapshot = evaluateStoredAccountReadiness(account, env);

    if (snapshot.bridgePort) {
        const healthCheck = await checkBridgeHealth(snapshot.bridgePort);
        snapshot.checks.push(healthCheck);

        if (!healthCheck.passed) {
            snapshot.blockingReasons.push(healthCheck.detail);
            if (snapshot.state === 'ready') {
                snapshot.state = 'bridge-unreachable';
            }
        }
    }

    if (
        snapshot.state === 'ready'
        && account
        && snapshot.bridgePort
        && account.mt5Login
        && account.mt5Password
        && account.mt5Server
    ) {
        const execution = await checkBridgeExecutionReadiness({
            mt5Login: account.mt5Login,
            mt5Password: account.mt5Password,
            mt5Server: account.mt5Server,
        }, snapshot.bridgePort);
        snapshot.checks.push(...execution.checks);
        snapshot.executionFailureCode = execution.failureCode;
        snapshot.executionReadinessMessage = execution.message;

        if (execution.blockingReasons.length > 0) {
            snapshot.blockingReasons.push(...execution.blockingReasons);
            snapshot.state = execution.state;
        }
    }

    return snapshot;
}
