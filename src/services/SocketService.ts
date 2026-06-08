import { Server } from 'socket.io';
import http from 'http';
import IORedis from 'ioredis';
import { normalizeMarketSymbol } from '../utils/symbols';
import { normalizeTimeframe } from '../utils/timeframes';
import { getCorsOptions } from '../utils/corsConfig';
import { extractCookieTokenFromHeader, verifyJwtToken } from '../middleware/auth';
import { resolveJwtSecret } from '../services/auth/config';
import { AuthModuleKey, AuthRoleKey, normalizeAuthModuleKey } from '../services/auth/types';

const INDICATOR_STREAM_ROOM = 'workspace:indicators';

const readAuthorizedModules = (value: unknown): AuthModuleKey[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const normalizedModules = value
        .map((entry) => typeof entry === 'string' ? normalizeAuthModuleKey(entry) : null)
        .filter((entry): entry is AuthModuleKey => entry !== null);

    return Array.from(new Set(normalizedModules));
};

const canAccessIndicatorStreams = (role: unknown, modules: AuthModuleKey[]) => (
    role === 'ADMIN'
    || modules.includes('signal')
    || modules.includes('engine')
);

export class SocketService {
    private io: Server;
    private sub: IORedis;

    constructor(server: http.Server) {
        this.io = new Server(server, {
            cors: getCorsOptions()
        });

        this.sub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
        });
    }

    public init() {
        // Socket.IO Authentication Middleware
        this.io.use(async (socket, next) => {
            const authToken = typeof socket.handshake.auth.token === 'string'
                ? socket.handshake.auth.token
                : null;
            const headerToken = typeof socket.handshake.headers.authorization === 'string'
                ? socket.handshake.headers.authorization
                : null;
            const cookieToken = extractCookieTokenFromHeader(
                typeof socket.handshake.headers.cookie === 'string' ? socket.handshake.headers.cookie : undefined,
                'tvgit.accessToken',
            );
            const token = authToken || headerToken || cookieToken;

            if (!token) {
                console.warn(`[Socket] Auth failed for ${socket.id}: No token provided`);
                return next(new Error('Authentication error: No token provided'));
            }

            const bearerPrefix = 'Bearer ';
            const tokenValue = token.startsWith(bearerPrefix) ? token.slice(bearerPrefix.length) : token;

            try {
                const secret = resolveJwtSecret();
                const claims = await verifyJwtToken(tokenValue, secret);
                const modules = readAuthorizedModules(claims.modules);
                socket.data.authorizedRole = claims.role as AuthRoleKey | undefined;
                socket.data.authorizedModules = modules;
                socket.data.canAccessIndicatorStreams = canAccessIndicatorStreams(claims.role, modules);
                next();
            } catch (error) {
                console.warn(`[Socket] Auth failed for ${socket.id}: Invalid token`);
                next(new Error('Authentication error: Invalid token'));
            }
        });

        this.io.on('connection', (socket) => {
            console.log(`[Socket] Client connected: ${socket.id}`);
            if (socket.data.canAccessIndicatorStreams) {
                socket.join(INDICATOR_STREAM_ROOM);
            }

            socket.on('subscribe', ({ symbol, timeframe }) => {
                const room = `${normalizeMarketSymbol(symbol)}:${normalizeTimeframe(String(timeframe ?? ''))}`;
                socket.join(room);
                console.log(`[Socket] Client ${socket.id} subscribed to ${room}`);
            });

            socket.on('unsubscribe', ({ symbol, timeframe }) => {
                const room = `${normalizeMarketSymbol(symbol)}:${normalizeTimeframe(String(timeframe ?? ''))}`;
                socket.leave(room);
                console.log(`[Socket] Client ${socket.id} unsubscribed from ${room}`);
            });

            socket.on('disconnect', () => {
                console.log(`[Socket] Client disconnected: ${socket.id}`);
            });
        });

        // Lắng nghe dữ liệu từ Redis để broadcast
        this.sub.on('pmessage', (pattern, channel, message) => {
            const parts = channel.split(':');
            const type = parts[0];

            if (type === 'live' || type === 'confirmed') {
                const symbol = parts[1];
                const timeframe = normalizeTimeframe(parts[2] ?? '');
                const room = `${symbol}:${timeframe}`;
                const eventName = type === 'live' ? 'tick' : 'candle';
                this.io.to(room).emit(eventName, JSON.parse(message));
            } else if (type === 'indicator') {
                const subType = parts[1];
                if (subType === 'events') {
                    this.io.to(INDICATOR_STREAM_ROOM).emit('indicator:events', JSON.parse(message));
                } else if (subType === 'logs') {
                    const instanceId = parts[2];
                    this.io.to(INDICATOR_STREAM_ROOM).emit(`indicator:logs:${instanceId}`, JSON.parse(message));
                } else if (subType === 'alerts') {
                    this.io.to(INDICATOR_STREAM_ROOM).emit('indicator:alerts:triggered', JSON.parse(message));
                }
            } else if (type === 'backtest') {
                if (channel.startsWith('backtest:progress:')) {
                    const data = JSON.parse(message);
                    this.io.to(INDICATOR_STREAM_ROOM).emit('backtest:progress', data);
                }
            }
        });

        this.sub.psubscribe('live:*:*');
        this.sub.psubscribe('confirmed:*:*');
        this.sub.psubscribe('indicator:events');
        this.sub.psubscribe('indicator:logs:*');
        this.sub.psubscribe('indicator:alerts:*');
        this.sub.psubscribe('backtest:progress:*');
    }
}
