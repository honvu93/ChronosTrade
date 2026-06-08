import express from 'express';
import { PrismaClient } from '@prisma/client';
import { MonitoringService } from '../services/admin/MonitoringService';

type RouteGuard = express.RequestHandler[];

function createErrorResponse(res: express.Response, error: unknown) {
    console.error('[MonitoringRoutes] Unexpected error:', error);
    return res.status(500).json({
        success: false,
        error: {
            code: 'ADMIN_MONITORING_FAILED',
            message: 'Unable to load the admin monitoring snapshot.',
            domain: 'admin.monitoring',
        },
    });
}

export function createGetAdminMonitoringRouteHandler(
    monitoringService: Pick<MonitoringService, 'getSnapshot'>,
): express.RequestHandler {
    return async (_req, res) => {
        try {
            const snapshot = await monitoringService.getSnapshot();
            res.json({
                success: true,
                data: snapshot,
            });
        } catch (error) {
            createErrorResponse(res, error);
        }
    };
}

export function registerMonitoringRoutes(
    app: express.Application,
    prisma: PrismaClient,
    guards: {
        adminOnly?: RouteGuard;
    } = {},
) {
    const monitoringService = new MonitoringService(prisma);
    const adminOnly = guards.adminOnly ?? [];

    app.get(
        '/api/admin/monitoring',
        ...adminOnly,
        createGetAdminMonitoringRouteHandler(monitoringService),
    );
}
