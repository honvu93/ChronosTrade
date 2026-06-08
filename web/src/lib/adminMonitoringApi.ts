import {
    AdminMonitoringErrorEnvelope,
    AdminMonitoringResponseEnvelope,
    MonitoringSnapshot,
} from "@/types/adminMonitoring";

const readJson = async <T,>(response: Response) => response.json().catch(() => null) as Promise<T | null>;

export const loadAdminMonitoringSnapshot = async (): Promise<MonitoringSnapshot> => {
    const response = await fetch("/api/admin/monitoring", {
        cache: "no-store",
        credentials: "include",
    });
    const payload = await readJson<AdminMonitoringResponseEnvelope | AdminMonitoringErrorEnvelope>(response);

    if (!response.ok || !payload || payload.success === false) {
        throw new Error(
            payload && payload.success === false
                ? payload.error.message
                : "Unable to load the admin monitoring dashboard.",
        );
    }

    return payload.data;
};
