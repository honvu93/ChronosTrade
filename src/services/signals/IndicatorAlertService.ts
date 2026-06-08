import { PrismaClient } from '@prisma/client';

export type AlertTypeValue = 'PRICE' | 'INDICATOR' | 'VOLATILITY';

export class IndicatorAlertService {
    constructor(private prisma: PrismaClient) { }

    public async createAlert(params: {
        instanceId: string;
        type: AlertTypeValue;
        conditionJson: any;
    }) {
        return this.prisma.indicatorAlert.create({
            data: {
                ...params,
                isActive: true,
            },
        });
    }

    public async listAlerts(instanceId: string) {
        return this.prisma.indicatorAlert.findMany({
            where: { instanceId },
            orderBy: { createdAt: 'desc' },
        });
    }

    public async toggleAlert(id: string, isActive: boolean) {
        return this.prisma.indicatorAlert.update({
            where: { id },
            data: { isActive },
        });
    }

    public async deleteAlert(id: string) {
        return this.prisma.indicatorAlert.delete({
            where: { id },
        });
    }

    public async updateTriggerTime(id: string) {
        return this.prisma.indicatorAlert.update({
            where: { id },
            data: { lastTriggeredAt: new Date() },
        });
    }

    public async getActiveAlerts() {
        return this.prisma.indicatorAlert.findMany({
            where: { isActive: true },
            include: {
                indicatorInstance: true
            }
        });
    }
}
