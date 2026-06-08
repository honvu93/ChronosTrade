type TradingExecutionLogLevel = 'info' | 'warn' | 'error';

type TradingExecutionConsole = Pick<typeof console, 'info' | 'warn' | 'error'>;

export interface TradingExecutionLogRecord {
    event: string;
    message: string;
    actorUserId?: string | null;
    requestedByUserId?: string | null;
    ownerUserId?: string | null;
    accountId?: string | null;
    accountMode?: 'LIVE' | 'PAPER' | null;
    commandId?: string | null;
    commandType?: string | null;
    tradeIntentId?: string | null;
    symbol?: string | null;
    side?: string | null;
    volume?: number | null;
    price?: number | null;
    brokerPositionId?: string | null;
    brokerOrderId?: string | null;
    brokerReference?: string | null;
    idempotencyKey?: string | null;
    status?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    ownerScopeUserId?: string | null;
    route?: string | null;
    requestBody?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
}

const defaultConsole: TradingExecutionConsole = console;

export function createTradingExecutionLogger(
    sink: TradingExecutionConsole = defaultConsole,
) {
    return {
        log(level: TradingExecutionLogLevel, record: TradingExecutionLogRecord) {
            const payload = {
                timestamp: new Date().toISOString(),
                domain: 'trading.execution',
                level,
                ...record,
            };
            const line = `[TradingExecution] ${JSON.stringify(payload)}`;
            if (level === 'error') {
                sink.error(line);
                return;
            }
            if (level === 'warn') {
                sink.warn(line);
                return;
            }
            sink.info(line);
        },
    };
}

export type TradingExecutionLogger = ReturnType<typeof createTradingExecutionLogger>;
