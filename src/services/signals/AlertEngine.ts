import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import { IndicatorAlertService } from './IndicatorAlertService';

export class AlertEngine {
    private sub: IORedis;

    constructor(
        private prisma: PrismaClient,
        private alertService: IndicatorAlertService,
        private redisPub: IORedis
    ) {
        this.sub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
        });
    }

    public init() {
        this.sub.on('pmessage', async (pattern, channel, message) => {
            try {
                const data = JSON.parse(message);
                const parts = channel.split(':');
                const type = parts[0];

                if (type === 'live') {
                    // Price alert check
                    await this.checkPriceAlerts(parts[1], parts[2], data);
                } else if (type === 'indicator' && parts[1] === 'events') {
                    // Indicator signal alert check
                    await this.checkIndicatorAlerts(data);
                }
            } catch (err) {
                console.error('[AlertEngine] Error processing pmessage:', err);
            }
        });

        this.sub.psubscribe('live:*:*');
        this.sub.psubscribe('indicator:events');
        console.log('[AlertEngine] Listening for ticks and indicator events...');
    }

    private async checkPriceAlerts(symbol: string, timeframe: string, bar: any) {
        const activeAlerts = await this.prisma.indicatorAlert.findMany({
            where: {
                isActive: true,
                type: 'PRICE',
                indicatorInstance: {
                    symbol: symbol,
                    timeframe: timeframe,
                    status: 'ACTIVE',
                }
            },
            include: { indicatorInstance: true }
        });

        for (const alert of activeAlerts) {
            const condition = alert.conditionJson as any;
            const price = parseFloat(bar.close);
            let triggered = false;

            if (condition.operator === '>' && price >= condition.target) triggered = true;
            if (condition.operator === '<' && price <= condition.target) triggered = true;

            if (triggered) {
                await this.triggerAlert(alert, `Price ${condition.operator} ${condition.target} (Current: ${price})`);
            }
        }
    }

    private async checkIndicatorAlerts(eventData: any) {
        const { instanceId, event } = eventData;
        const activeAlerts = await this.prisma.indicatorAlert.findMany({
            where: {
                isActive: true,
                type: 'INDICATOR',
                instanceId: instanceId,
                indicatorInstance: {
                    status: 'ACTIVE',
                },
            },
            include: { indicatorInstance: true }
        });

        for (const alert of activeAlerts) {
            const condition = alert.conditionJson as any;
            if (event.eventType === condition.eventType) {
                await this.triggerAlert(alert, `Indicator Signal: ${event.eventType} @ ${event.price}`);
            }
        }
    }

    private async triggerAlert(alert: any, message: string) {
        // Cooldown check (prevent spamming)
        if (alert.lastTriggeredAt) {
            const lastTriggered = new Date(alert.lastTriggeredAt).getTime();
            const now = Date.now();
            if (now - lastTriggered < 60000) return; // 1 minute cooldown
        }

        console.log(`[AlertEngine] TRIGGERED: ${alert.indicatorInstance.name} - ${message}`);

        await this.alertService.updateTriggerTime(alert.id);

        // Publish to Redis for frontend broadcast
        await this.redisPub.publish('indicator:alerts:triggered', JSON.stringify({
            alertId: alert.id,
            instanceId: alert.instanceId,
            instanceName: alert.indicatorInstance.name,
            symbol: alert.indicatorInstance.symbol,
            message,
            timestamp: new Date().toISOString()
        }));
    }
}
