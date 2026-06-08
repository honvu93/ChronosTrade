"use client";

import React, { useEffect, useState } from 'react';
import { X, Info, Activity, ShieldAlert, Zap } from 'lucide-react';
import { IndicatorLogicTrace } from '@/types/signals';
import { useIndicators } from '@/hooks/useIndicators';
import { DateTime } from 'luxon';

interface IndicatorTraceDrawerProps {
    instanceId: string;
    eventId: string | null;
    onClose: () => void;
}

export default function IndicatorTraceDrawer({
    instanceId,
    eventId,
    onClose,
}: IndicatorTraceDrawerProps) {
    const { fetchTrace } = useIndicators();
    const [trace, setTrace] = useState<IndicatorLogicTrace | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!eventId) {
            setTrace(null);
            return;
        }

        const loadTrace = async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await fetchTrace(instanceId, eventId);
                setTrace(data);
            } catch (err: any) {
                setError(err.message || 'Failed to load trace');
            } finally {
                setLoading(false);
            }
        };

        loadTrace();
    }, [instanceId, eventId, fetchTrace]);

    if (!eventId) return null;

    return (
        <div className="fixed inset-y-0 right-0 w-96 bg-bg-secondary border-l border-border-muted shadow-2xl z-[100] flex flex-col transform transition-transform duration-300 ease-in-out">
            <div className="p-4 border-b border-border-muted flex items-center justify-between bg-bg-primary">
                <div className="flex items-center gap-2">
                    <Info className="w-5 h-5 text-accent" />
                    <h2 className="font-bold text-text-primary">Logic Trace</h2>
                </div>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-bg-secondary rounded-md text-text-muted hover:text-text-primary transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-40 space-y-2">
                        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm text-text-muted">Loading trace details...</p>
                    </div>
                ) : error ? (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
                        {error}
                    </div>
                ) : trace ? (
                    <>
                        {/* Summary Header */}
                        <div className="space-y-1">
                            <div className="text-xs text-text-muted uppercase tracking-wider font-semibold">Event Type</div>
                            <div className="text-lg font-bold text-accent">{trace.eventType}</div>
                            <div className="text-xs text-text-secondary">
                                {DateTime.fromISO(trace.candleTime).toFormat('HH:mm:ss dd/MM/yyyy')}
                            </div>
                        </div>

                        {/* State Transition */}
                        <div className="p-4 rounded-xl bg-bg-primary border border-border-muted space-y-3">
                            <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-tight">
                                <Activity className="w-4 h-4" />
                                State Transition
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="text-center">
                                    <div className="text-[10px] text-text-muted uppercase mb-1">Before</div>
                                    <div className="px-2 py-1 rounded bg-bg-secondary text-sm font-mono border border-border-muted">
                                        {trace.stateBefore || 'NULL'}
                                    </div>
                                </div>
                                <div className="text-text-muted">→</div>
                                <div className="text-center">
                                    <div className="text-[10px] text-text-muted uppercase mb-1">After</div>
                                    <div className="px-2 py-1 rounded bg-accent/10 text-accent text-sm font-mono border border-accent/20">
                                        {trace.stateAfter || 'NULL'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Trigger Rule */}
                        {trace.ruleId && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-tight">
                                    <ShieldAlert className="w-4 h-4" />
                                    Triggered Rule
                                </div>
                                <div className="p-3 rounded-lg bg-bg-primary border border-border-muted font-mono text-sm">
                                    {trace.ruleId}
                                </div>
                            </div>
                        )}

                        {/* Variable Snapshots */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-tight">
                                <Zap className="w-4 h-4" />
                                Variable Snapshot
                            </div>

                            {trace.indicatorJson && (
                                <div className="space-y-2">
                                    <div className="text-[10px] text-text-muted uppercase ml-1">Indicators</div>
                                    <pre className="p-3 rounded-lg bg-bg-primary border border-border-muted text-xs overflow-x-auto text-text-secondary">
                                        {JSON.stringify(trace.indicatorJson, null, 2)}
                                    </pre>
                                </div>
                            )}

                            {trace.thresholdJson && (
                                <div className="space-y-2">
                                    <div className="text-[10px] text-text-muted uppercase ml-1">Thresholds</div>
                                    <pre className="p-3 rounded-lg bg-bg-primary border border-border-muted text-xs overflow-x-auto text-text-secondary">
                                        {JSON.stringify(trace.thresholdJson, null, 2)}
                                    </pre>
                                </div>
                            )}

                            {trace.notes && (
                                <div className="space-y-2">
                                    <div className="text-[10px] text-text-muted uppercase ml-1">Notes</div>
                                    <div className="p-3 rounded-lg bg-accent/5 border border-accent/10 text-sm italic text-text-secondary">
                                        {trace.notes}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="text-center text-text-muted py-10">
                        No trace data available
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-border-muted bg-bg-primary">
                <button
                    onClick={onClose}
                    className="w-full py-2 px-4 bg-bg-secondary hover:bg-bg-tertiary text-text-primary rounded-lg border border-border-muted transition-colors font-semibold"
                >
                    Close Trace
                </button>
            </div>
        </div>
    );
}
