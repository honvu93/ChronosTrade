"use client";

import { useEffect, useState, useCallback } from 'react';
import { useSocketContext } from '@/components/SocketProvider';

export interface BacktestProgress {
    backtestRunId: string;
    batchId?: string | null;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    counts?: {
        previewSignals: number;
        previewEvents: number;
        previewTraces: number;
        persistedSignals: number;
        persistedEvents: number;
        persistedTraces: number;
        persistedResults: number;
        droppedEvents: number;
        droppedTraces: number;
    };
    error?: string;
}

export function useBacktestProgress() {
    const { socket } = useSocketContext();
    const [progressMap, setProgressMap] = useState<Map<string, BacktestProgress>>(new Map());

    useEffect(() => {
        if (!socket) return;

        const handler = (data: BacktestProgress) => {
            setProgressMap((prev) => {
                const next = new Map(prev);
                next.set(data.backtestRunId, data);
                return next;
            });
        };

        socket.on('backtest:progress', handler);

        return () => {
            socket.off('backtest:progress', handler);
        };
    }, [socket]);

    const getProgress = useCallback(
        (runId: string) => progressMap.get(runId),
        [progressMap],
    );

    const clearProgress = useCallback(
        (runId: string) => {
            setProgressMap((prev) => {
                const next = new Map(prev);
                next.delete(runId);
                return next;
            });
        },
        [],
    );

    return { progressMap, getProgress, clearProgress };
}
