import express from 'express';
import { requireTradingCapability } from '../middleware/featureFlag';
import { buildTradingFeatureFlagSnapshot, TradingFeatureFlagSnapshot } from '../services/trading/tradingFeatureFlags';

export function registerTradingCommandRoutes(app: express.Application) {
    app.post('/api/trading/commands/preflight', requireTradingCapability('write'), async (req, res) => {
        const snapshot = (res.locals as { tradingFeatureFlags?: TradingFeatureFlagSnapshot }).tradingFeatureFlags
            ?? buildTradingFeatureFlagSnapshot();

        res.json({
            success: true,
            data: {
                tier: 'write',
                title: 'Write tier enabled',
                message: 'Runtime gating allows manual command preparation. Execution submission remains out of scope until Story 4.8.',
                nextAction: 'manual-command-lane',
                evaluatedAt: snapshot.evaluatedAt,
            },
        });
    });
}
