import { resolveMT5ReadPort, resolveMT5ExecPort } from './mt5BridgeConfig';

export interface MT5BridgeCredentialPayload {
    mt5Login: string;
    mt5Password: string;
    mt5Server: string;
}

export interface MT5BridgeSummaryPayload {
    login: string;
    server: string;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number | null;
    unrealizedPnl: number;
    realizedPnlDay: number;
    currency: string | null;
    leverage: number | null;
    brokerTime: string | null;
    rawBrokerJson: Record<string, unknown> | null;
}

export interface MT5BridgeExecutionBlocker {
    code: string;
    message: string;
    field?: string | null;
    origin?: 'terminal' | 'account' | 'bridge' | null;
    value?: boolean | null;
}

export interface MT5BridgeTerminalReadinessPayload {
    connected: boolean | null;
    tradeAllowed: boolean | null;
    tradeApiDisabled: boolean | null;
    dllsAllowed: boolean | null;
    path: string | null;
    dataPath: string | null;
    rawBrokerJson: Record<string, unknown> | null;
}

export interface MT5BridgeAccountReadinessPayload {
    login: string | null;
    server: string | null;
    tradeAllowed: boolean | null;
    tradeExpert: boolean | null;
    rawBrokerJson: Record<string, unknown> | null;
}

export interface MT5BridgeExecutionReadinessPayload {
    ready: boolean;
    message: string;
    failureCode: string | null;
    blockers: MT5BridgeExecutionBlocker[];
    terminal: MT5BridgeTerminalReadinessPayload;
    account: MT5BridgeAccountReadinessPayload;
    evaluatedAt: string;
}

export interface MT5BridgePositionPayload {
    brokerPositionId: string;
    brokerOrderId: string | null;
    symbol: string;
    side: 'LONG' | 'SHORT';
    volume: number;
    openPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    currentPrice: number | null;
    swap: number;
    commission: number;
    unrealizedPnl: number;
    openedAt: string;
    rawBrokerJson: Record<string, unknown> | null;
}

export interface MT5BridgeOrderPayload {
    brokerOrderId: string;
    relatedPositionBrokerId: string | null;
    symbol: string;
    side: 'LONG' | 'SHORT';
    orderType: 'MARKET' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP';
    requestedVolume: number;
    filledVolume: number;
    price: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    status: 'PENDING' | 'PLACED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';
    placedAt: string;
    expiresAt: string | null;
    rawBrokerJson: Record<string, unknown> | null;
}

export interface MT5BridgeDealPayload {
    brokerDealId: string;
    brokerOrderId: string | null;
    brokerPositionId: string | null;
    symbol: string;
    side: 'LONG' | 'SHORT';
    volume: number;
    price: number;
    commission: number;
    swap: number;
    fee: number;
    realizedPnl: number;
    executedAt: string;
    comment: string | null;
    rawBrokerJson: Record<string, unknown> | null;
}

export interface MT5BridgeCommandResult {
    accepted: boolean;
    brokerReference: string | null;
    brokerPositionId: string | null;
    brokerOrderId: string | null;
    message: string;
    payload: Record<string, unknown> | null;
    failure?: {
        code: string;
        category: 'terminal' | 'preflight' | 'broker' | 'transport';
        retcode: number | null;
        comment: string | null;
        message: string;
    } | null;
}

export interface MT5BridgeQuotePayload {
    symbol: string;
    bid: number | null;
    ask: number | null;
    last: number | null;
    brokerTime: string | null;
    rawBrokerJson: Record<string, unknown> | null;
}

interface MT5BridgeEnvelope<T> {
    ok: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

export class MT5BridgeClientError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly statusCode = 500,
    ) {
        super(message);
        this.name = 'MT5BridgeClientError';
    }
}

export class MT5BridgeClient {
    constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

    private getReadBaseUrl(): string {
        const { port } = resolveMT5ReadPort(this.env);
        return `http://localhost:${port}/bridge`;
    }

    private getExecBaseUrl(): string {
        const { port } = resolveMT5ExecPort(this.env);
        return `http://localhost:${port}/bridge`;
    }

    async health(): Promise<boolean> {
        try {
            const response = await fetch(`${this.getReadBaseUrl()}/health`);
            return response.ok;
        } catch {
            return false;
        }
    }

    // ── Read operations → market data port (default 8765) ──

    async fetchSummary(credentials: MT5BridgeCredentialPayload): Promise<MT5BridgeSummaryPayload> {
        return this.post('/account/summary', credentials, this.getReadBaseUrl());
    }

    async fetchPositions(credentials: MT5BridgeCredentialPayload): Promise<MT5BridgePositionPayload[]> {
        return this.post('/account/positions', credentials, this.getReadBaseUrl());
    }

    async fetchOrders(credentials: MT5BridgeCredentialPayload): Promise<MT5BridgeOrderPayload[]> {
        return this.post('/account/orders', credentials, this.getReadBaseUrl());
    }

    async fetchDeals(
        credentials: MT5BridgeCredentialPayload,
        { limit = 50 }: { limit?: number } = {},
    ): Promise<MT5BridgeDealPayload[]> {
        return this.post('/account/deals', {
            ...credentials,
            limit,
        }, this.getReadBaseUrl());
    }

    async fetchQuote(
        credentials: MT5BridgeCredentialPayload,
        symbol: string,
    ): Promise<MT5BridgeQuotePayload> {
        return this.post('/market/quote', {
            ...credentials,
            symbol,
        }, this.getReadBaseUrl());
    }

    async fetchExecutionReadiness(
        credentials: MT5BridgeCredentialPayload,
    ): Promise<MT5BridgeExecutionReadinessPayload> {
        return this.post('/account/readiness', credentials, this.getReadBaseUrl());
    }

    // ── Write operations → trade execution port (default 8766) ──

    async openMarket(
        credentials: MT5BridgeCredentialPayload,
        payload: Record<string, unknown>,
    ): Promise<MT5BridgeCommandResult> {
        return this.post('/command/open-market', { ...credentials, ...payload }, this.getExecBaseUrl());
    }

    async placePending(
        credentials: MT5BridgeCredentialPayload,
        payload: Record<string, unknown>,
    ): Promise<MT5BridgeCommandResult> {
        return this.post('/command/place-pending', { ...credentials, ...payload }, this.getExecBaseUrl());
    }

    async closePosition(
        credentials: MT5BridgeCredentialPayload,
        payload: Record<string, unknown>,
    ): Promise<MT5BridgeCommandResult> {
        return this.post('/command/close-position', { ...credentials, ...payload }, this.getExecBaseUrl());
    }

    async partialClose(
        credentials: MT5BridgeCredentialPayload,
        payload: Record<string, unknown>,
    ): Promise<MT5BridgeCommandResult> {
        return this.post('/command/partial-close', { ...credentials, ...payload }, this.getExecBaseUrl());
    }

    async modifyPosition(
        credentials: MT5BridgeCredentialPayload,
        payload: Record<string, unknown>,
    ): Promise<MT5BridgeCommandResult> {
        return this.post('/command/modify-position', { ...credentials, ...payload }, this.getExecBaseUrl());
    }

    async cancelOrder(
        credentials: MT5BridgeCredentialPayload,
        payload: Record<string, unknown>,
    ): Promise<MT5BridgeCommandResult> {
        return this.post('/command/cancel-order', { ...credentials, ...payload }, this.getExecBaseUrl());
    }

    private async post<T>(path: string, body: object, baseUrl: string): Promise<T> {
        let response: Response;
        try {
            response = await fetch(`${baseUrl}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
        } catch (error) {
            throw new MT5BridgeClientError(
                'BRIDGE_UNREACHABLE',
                error instanceof Error ? error.message : 'MT5 bridge is unreachable.',
                502,
            );
        }

        const payload = await response.json().catch(() => null) as MT5BridgeEnvelope<T> | null;
        if (!response.ok || !payload || payload.ok === false || payload.data === undefined) {
            throw new MT5BridgeClientError(
                payload?.error?.code ?? 'BRIDGE_REQUEST_FAILED',
                payload?.error?.message ?? `Bridge request to ${path} failed.`,
                response.status,
            );
        }

        return payload.data;
    }
}
