export interface WorkerLogEntry {
    level: 'info' | 'warn' | 'error';
    worker: string;
    jobId: string | null;
    event: string;
    message: string;
    timestamp: string;
}

export function createWorkerLogger(workerName: string) {
    const log = (
        level: WorkerLogEntry['level'],
        event: string,
        message: string,
        jobId: string | null = null,
    ) => {
        const entry: WorkerLogEntry = {
            level,
            worker: workerName,
            jobId,
            event,
            message,
            timestamp: new Date().toISOString(),
        };
        const line = JSON.stringify(entry);
        if (level === 'error') {
            console.error(line);
        } else {
            console.log(line);
        }
    };

    return {
        info: (event: string, message: string, jobId?: string | null) =>
            log('info', event, message, jobId ?? null),
        warn: (event: string, message: string, jobId?: string | null) =>
            log('warn', event, message, jobId ?? null),
        error: (event: string, message: string, jobId?: string | null) =>
            log('error', event, message, jobId ?? null),
    };
}
