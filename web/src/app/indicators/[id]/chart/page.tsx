"use client";

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, AlertTriangle, Activity, SlidersHorizontal } from 'lucide-react';
import AccessGate from '@/components/auth/AccessGate';
import { useIndicators } from '@/hooks/useIndicators';
import MultiPaneChart from '@/components/chart/MultiPaneChart';
import IndicatorTraceDrawer from '@/components/indicators/IndicatorTraceDrawer';
import IndicatorLogConsole from '@/components/indicators/IndicatorLogConsole';
import IndicatorSettingsDrawer from '@/components/indicators/IndicatorSettingsDrawer';
import { IndicatorInstance, IndicatorEvent } from '@/types/signals';
import { useSocketContext } from '@/components/SocketProvider';

export default function IndicatorChartPage() {
    const { id } = useParams();
    const router = useRouter();
    const { getInstance, fetchEvents } = useIndicators();
    const { socket } = useSocketContext();

    const [instance, setInstance] = useState<IndicatorInstance | null>(null);
    const [events, setEvents] = useState<IndicatorEvent[]>([]);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [instData, eventsData] = await Promise.all([
                getInstance(id as string),
                fetchEvents(id as string)
            ]);
            setInstance(instData);
            setEvents(eventsData);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to load indicator data');
        } finally {
            setLoading(false);
        }
    }, [fetchEvents, getInstance, id]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    // Subscribe to real-time events from the runner
    useEffect(() => {
        if (!socket || !id) return;

        const handleNewEvent = (data: { instanceId: string; event: IndicatorEvent }) => {
            if (data.instanceId !== id) return;
            setEvents(prev => [data.event, ...prev]);
        };

        socket.on('indicator:events', handleNewEvent);
        return () => {
            socket.off('indicator:events', handleNewEvent);
        };
    }, [socket, id]);

    const handleMarkerClick = (markerId: string) => {
        if (markerId.startsWith('backtest-')) return;
        setSelectedEventId(markerId);
    };

    if (loading && !instance) {
        return (
            <AccessGate requiredModules={["signal", "engine"]}>
                <div className="flex flex-col items-center justify-center min-h-screen bg-bg-primary">
                    <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-text-muted">Loading indicator chart...</p>
                </div>
            </AccessGate>
        );
    }

    if (error || !instance) {
        return (
            <AccessGate requiredModules={["signal", "engine"]}>
                <div className="flex flex-col items-center justify-center min-h-screen bg-bg-primary p-4">
                    <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
                    <h1 className="text-xl font-bold mb-2">Error Loading Indicator</h1>
                    <p className="text-text-muted mb-6">{error || 'Indicator not found'}</p>
                    <button
                        onClick={() => router.push('/indicators')}
                        className="px-4 py-2 bg-bg-secondary hover:bg-bg-tertiary rounded-lg border border-border-muted transition-colors"
                    >
                        Back to Dashboard
                    </button>
                </div>
            </AccessGate>
        );
    }

    return (
        <AccessGate requiredModules={["signal", "engine"]}>
        <div className="flex flex-col h-screen bg-bg-primary overflow-hidden">
            {/* Header */}
            <header className="shrink-0 border-b border-border-muted bg-bg-secondary/50 px-4 py-4 backdrop-blur-md md:px-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                    <button
                        onClick={() => router.push('/indicators')}
                        className="p-2 hover:bg-bg-tertiary rounded-full transition-colors text-text-muted"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h1 className="truncate font-bold text-lg">{instance.name}</h1>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${instance.status === 'ACTIVE' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                                instance.status === 'PAUSED' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' :
                                    'bg-bg-tertiary text-text-muted border border-border-muted'
                                }`}>
                                {instance.status}
                            </span>
                        </div>
                        <p className="text-xs text-text-muted">
                            {instance.symbol} / {instance.timeframe} / Live Indicator
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 md:justify-end">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary/50 rounded-md border border-border-muted text-[10px] font-mono">
                        <Activity className="w-3 h-3 text-accent" />
                        <span className="text-text-muted uppercase">Health:</span>
                        <span className={`${instance.errorMessage ? 'text-red-500' : 'text-accent'} font-bold`}>
                            {instance.errorMessage ? 'CRITICAL' : 'OPTIMAL'}
                        </span>
                    </div>
                    <div className="h-8 w-px bg-border-muted" />
                    <button
                        onClick={loadData}
                        className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary hover:bg-bg-tertiary rounded-md border border-border-muted text-sm transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/20 hover:bg-accent/20 rounded-md text-accent text-sm transition-all font-bold"
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                        Settings
                    </button>
                </div>
                </div>
            </header>

            {/* Main Content Split */}
            <main className="flex-1 flex flex-col min-h-0 relative">
                <div className="flex-1 relative min-h-0">
                    <MultiPaneChart
                        indicatorEvents={events}
                        onMarkerClick={handleMarkerClick}
                    />

                    {selectedEventId && (
                        <IndicatorTraceDrawer
                            instanceId={instance.id}
                            eventId={selectedEventId}
                            onClose={() => setSelectedEventId(null)}
                        />
                    )}

                    <IndicatorSettingsDrawer
                        instance={instance}
                        isOpen={isSettingsOpen}
                        onClose={() => setIsSettingsOpen(false)}
                        onSaveSuccess={loadData}
                    />
                </div>

                {/* Log Console at Bottom */}
                <div className="h-64 shrink-0 border-t border-border-muted">
                    <IndicatorLogConsole
                        instanceId={instance.id}
                        socket={socket}
                    />
                </div>
            </main>
        </div>
        </AccessGate>
    );
}
