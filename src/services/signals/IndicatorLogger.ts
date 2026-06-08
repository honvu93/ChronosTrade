import IORedis from 'ioredis';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface IndicatorLogEntry {
    instanceId: string;
    level: LogLevel;
    message: string;
    timestamp: string;
    meta?: any;
}

export class IndicatorLogger {
    constructor(private redisPub: IORedis) { }

    public async log(instanceId: string, level: LogLevel, message: string, meta?: any) {
        const entry: IndicatorLogEntry = {
            instanceId,
            level,
            message,
            timestamp: new Date().toISOString(),
            meta,
        };

        const channel = `indicator:logs:${instanceId}`;
        await this.redisPub.publish(channel, JSON.stringify(entry));

        // Also log to console for server-side visibility
        const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
        console[consoleMethod](`[Indicator:${instanceId}] [${level.toUpperCase()}] ${message}`, meta || '');
    }

    public async info(instanceId: string, message: string, meta?: any) {
        await this.log(instanceId, 'info', message, meta);
    }

    public async warn(instanceId: string, message: string, meta?: any) {
        await this.log(instanceId, 'warn', message, meta);
    }

    public async error(instanceId: string, message: string, meta?: any) {
        await this.log(instanceId, 'error', message, meta);
    }

    public async debug(instanceId: string, message: string, meta?: any) {
        await this.log(instanceId, 'debug', message, meta);
    }
}
