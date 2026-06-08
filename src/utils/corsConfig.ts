import { CorsOptions } from 'cors';

const PRODUCTION_DRIVE_ENVS = new Set(['production', 'prod']);

export const isProduction = () =>
    PRODUCTION_DRIVE_ENVS.has((process.env.NODE_ENV || '').trim().toLowerCase());

export function getAllowedOrigins(): string[] {
    if (!isProduction()) {
        const devOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:5001',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001',
            'http://127.0.0.1:5001',
        ];
        // Optional extra dev origins (LAN IP, tunnel domain, etc.)
        // e.g. CORS_DEV_EXTRA_ORIGINS="http://192.168.1.x:5001,https://trade.your-domain.com"
        const extra = (process.env.CORS_DEV_EXTRA_ORIGINS || '')
            .split(',')
            .map(o => o.trim())
            .filter(o => o.length > 0);
        return [...devOrigins, ...extra];
    }

    const originsStr = process.env.CORS_ORIGIN || '';
    return originsStr
        .split(',')
        .map(o => o.trim())
        .filter(o => o.length > 0);
}

export function getCorsOptions(): CorsOptions {
    return {
        origin: (origin, callback) => {
            const allowed = getAllowedOrigins();
            // Allow requests with no origin (like mobile apps or curl) in dev
            if (!origin && !isProduction()) {
                return callback(null, true);
            }
            if (!origin || allowed.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    };
}
