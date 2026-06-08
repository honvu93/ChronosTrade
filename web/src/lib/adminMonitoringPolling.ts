export interface MonitoringPollStateInput {
    visible: boolean;
    focused: boolean;
    isAdmin: boolean;
}

export const MONITORING_POLL_INTERVAL_MS = 30_000;

export const shouldPollAdminMonitoring = ({
    visible,
    focused,
    isAdmin,
}: MonitoringPollStateInput) => isAdmin && visible && focused;
