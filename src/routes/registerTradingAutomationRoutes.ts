import express from 'express';
import { requireTradingCapability } from '../middleware/featureFlag';
import { buildTradingFeatureFlagSnapshot, TradingFeatureFlagSnapshot } from '../services/trading/tradingFeatureFlags';

export function registerTradingAutomationRoutes(app: express.Application) {
    app.post('/api/trading/automation/preflight', requireTradingCapability('automation'), async (req, res) => {
        const snapshot = (res.locals as { tradingFeatureFlags?: TradingFeatureFlagSnapshot }).tradingFeatureFlags
            ?? buildTradingFeatureFlagSnapshot();

        res.json({
            success: true,
            data: {
                tier: 'automation',
                title: 'Automation tier enabled',
                message: 'Runtime gating allows automation controls to appear. Paper/demo AUTO_EXECUTE bindings can now queue supported ENTRY intents to the dedicated worker, while live accounts and exit-management automation remain blocked.',
                nextAction: 'automation-control-lane',
                evaluatedAt: snapshot.evaluatedAt,
            },
        });
    });
}
