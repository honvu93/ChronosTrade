"use client";

import React, { useEffect, useState, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { Terminal, ScrollText, AlertCircle, XCircle, Info } from 'lucide-react';
import { DateTime } from 'luxon';
import { useAppLocale } from '@/hooks/useAppLocale';

interface LogEntry {
    instanceId: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    timestamp: string;
    meta?: any;
}

interface IndicatorLogConsoleProps {
    instanceId: string;
    socket: Socket | null;
}

export default function IndicatorLogConsole({ instanceId, socket }: IndicatorLogConsoleProps) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [autoScroll, setAutoScroll] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const { copy } = useAppLocale();

    useEffect(() => {
        if (!socket) return;

        const handleLog = (log: LogEntry) => {
            setLogs(prev => [...prev.slice(-99), log]);
        };

        socket.on(`indicator:logs:${instanceId}`, handleLog);

        return () => {
            socket.off(`indicator:logs:${instanceId}`, handleLog);
        };
    }, [socket, instanceId]);

    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'error': return 'text-red-400';
            case 'warn': return 'text-yellow-400';
            case 'debug': return 'text-blue-400';
            default: return 'text-green-400';
        }
    };

    const getLevelIcon = (level: string) => {
        switch (level) {
            case 'error': return <XCircle className="w-3 h-3 text-red-500" />;
            case 'warn': return <AlertCircle className="w-3 h-3 text-yellow-500" />;
            case 'debug': return <Terminal className="w-3 h-3 text-blue-500" />;
            default: return <Info className="w-3 h-3 text-green-500" />;
        }
    };

    return (
        <div className="flex flex-col h-full bg-bg-secondary/80 backdrop-blur-md border-t border-border-muted overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-bg-tertiary/50 border-b border-border-muted">
                <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-tight">
                    <ScrollText className="w-4 h-4" />
                    {copy.indicatorLogs.liveExecutionLogs}
                </div>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-[10px] text-text-muted cursor-pointer hover:text-text-primary transition-colors">
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={(e) => setAutoScroll(e.target.checked)}
                            className="w-3 h-3 rounded bg-bg-primary border-border-muted accent-accent"
                        />
                        {copy.indicatorLogs.autoScroll}
                    </label>
                    <button
                        onClick={() => setLogs([])}
                        className="text-[10px] text-text-muted hover:text-red-400 transition-colors uppercase font-bold"
                    >
                        {copy.indicatorLogs.clear}
                    </button>
                </div>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1.5 scrollbar-thin scrollbar-thumb-border-muted"
            >
                {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full opacity-20 space-y-2">
                        <Terminal className="w-8 h-8" />
                        <p>{copy.indicatorLogs.waitingForExecution}</p>
                    </div>
                ) : (
                    logs.map((log, i) => (
                        <div key={i} className="flex gap-3 hover:bg-bg-primary/50 group transition-colors">
                            <span className="text-text-muted whitespace-nowrap shrink-0">
                                {DateTime.fromISO(log.timestamp).toFormat('HH:mm:ss.SSS')}
                            </span>
                            <span className={`uppercase font-bold shrink-0 w-10 ${getLevelColor(log.level)}`}>
                                {log.level}
                            </span>
                            <span className="text-text-secondary flex-1 break-all">
                                {log.message}
                                {log.meta && (
                                    <span className="text-text-muted ml-2 opacity-50 italic">
                                        {typeof log.meta === 'object' ? JSON.stringify(log.meta) : String(log.meta)}
                                    </span>
                                )}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
