'use client';

import React from 'react';
import AccessGate from '@/components/auth/AccessGate';
import { useIndicators } from '@/hooks/useIndicators';
import AlertConfigurationModal from '@/components/indicators/AlertConfigurationModal';
import MainLayout from '@/components/layout/MainLayout';
import { IndicatorInstance } from '@/types/signals';
import {
    Play,
    Pause,
    Trash2,
    Activity,
    AlertCircle,
    Clock,
    BarChart2,
    Shield,
    Zap,
    Bell
} from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { isIndicatorHeartbeatStale } from '@/lib/indicatorHeartbeat';

export default function IndicatorsPage() {
    const { instances, loading, fetchInstances, updateStatus, createAlert, error } = useIndicators();
    const [selectedInstance, setSelectedInstance] = React.useState<IndicatorInstance | null>(null);
    const activeCount = instances.filter(i => i.status === 'ACTIVE').length;
    const errorCount = instances.filter(i => i.errorMessage).length;
    const staleCount = instances.filter(i => {
        if (i.status !== 'ACTIVE') return false;
        return isIndicatorHeartbeatStale(i.lastProcessedCandleTime, i.timeframe);
    }).length;

    return (
        <AccessGate requiredModules={["signal", "engine"]}>
            <MainLayout>
            <div className="flex flex-col h-full bg-bg-secondary text-text-primary p-6 space-y-8 overflow-y-auto">
                <header className="flex justify-between items-center shrink-0">
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent italic tracking-tight">
                            Fleet Intelligence
                        </h1>
                        <p className="text-text-secondary mt-1 text-sm">Managing {instances.length} live detection nodes</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => { void fetchInstances(); }}
                            className="flex items-center gap-2 px-4 py-2 bg-bg-tertiary hover:bg-white/5 rounded-xl border border-border-muted transition-all text-sm font-bold"
                        >
                            <Zap size={16} className="text-accent" />
                            Refresh Fleet
                        </button>
                    </div>
                </header>

                {/* Fleet Health Overview */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
                    <div className="p-4 rounded-2xl bg-bg-tertiary border border-border-muted space-y-1">
                        <div className="text-[10px] text-text-muted uppercase font-bold tracking-widest">Total Nodes</div>
                        <div className="text-2xl font-black">{instances.length}</div>
                    </div>
                    <div className="p-4 rounded-2xl bg-bg-tertiary border border-border-muted space-y-1">
                        <div className="text-[10px] text-price-up uppercase font-bold tracking-widest">Active Runtime</div>
                        <div className="text-2xl font-black text-price-up/90">{activeCount}</div>
                    </div>
                    <div className="p-4 rounded-2xl bg-bg-tertiary border border-border-muted space-y-1">
                        <div className="text-[10px] text-accent uppercase font-bold tracking-widest">Stale Heartbeat</div>
                        <div className="text-2xl font-black text-accent/90">{staleCount}</div>
                    </div>
                    <div className="p-4 rounded-2xl bg-bg-tertiary border border-border-muted space-y-1">
                        <div className="text-[10px] text-price-down uppercase font-bold tracking-widest">Critical Errors</div>
                        <div className="text-2xl font-black text-price-down/90">{errorCount}</div>
                    </div>
                </div>

                {error && (
                    <div className="bg-price-down/10 border border-price-down/30 p-4 rounded-xl flex items-center space-x-3 text-price-down/90">
                        <AlertCircle size={20} />
                        <span>{error}</span>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loading && instances.length === 0 ? (
                        <div className="col-span-full h-64 flex items-center justify-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
                        </div>
                    ) : instances.length === 0 ? (
                        <div className="col-span-full h-64 flex flex-col items-center justify-center bg-bg-tertiary rounded-2xl border border-border-muted text-text-muted space-y-4">
                            <Activity size={48} className="opacity-20" />
                            <p>No active indicators. Promote a backtest run in /signals to start.</p>
                        </div>
                    ) : (
                        instances.map((instance) => {
                            const lastUpdate = instance.lastProcessedCandleTime ? DateTime.fromISO(instance.lastProcessedCandleTime as string) : null;
                            const isStale = instance.status === 'ACTIVE' && isIndicatorHeartbeatStale(instance.lastProcessedCandleTime, instance.timeframe);

                            return (
                                <div key={instance.id} className={`bg-bg-tertiary rounded-2xl border transition-all p-5 flex flex-col space-y-4 group relative overflow-hidden ${isStale ? 'border-accent/40 shadow-[0_0_20px_rgba(240,185,11,0.1)]' : 'border-border-muted hover:border-blue-500/30'
                                    }`}>
                                    {isStale && (
                                        <div className="absolute top-0 right-0 bg-accent text-bg-secondary text-[8px] font-black px-2 py-0.5 uppercase tracking-tighter">
                                            Stale Detection
                                        </div>
                                    )}
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <h3 className="font-bold text-lg leading-tight group-hover:text-blue-400 transition-colors">
                                                {instance.name}
                                            </h3>
                                            <div className="flex items-center space-x-2 text-xs font-mono">
                                                <span className="bg-blue-900/20 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">
                                                    {instance.symbol}
                                                </span>
                                                <span className="bg-purple-900/20 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20">
                                                    {instance.timeframe}
                                                </span>
                                            </div>
                                        </div>
                                        <div className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase border ${instance.status === 'ACTIVE' ? 'bg-price-up/10 text-price-up border-price-up/20' :
                                            instance.status === 'PAUSED' ? 'bg-accent/10 text-accent border-accent/20' :
                                                'bg-bg-primary text-text-muted border-border-muted'
                                            }`}>
                                            {instance.status}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                                        <div className="space-y-1">
                                            <span className="text-text-muted block uppercase tracking-tighter">Last Heartbeat</span>
                                            <div className={`flex items-center space-x-1.5 ${isStale ? 'text-accent' : 'text-text-secondary'}`}>
                                                <Clock size={12} />
                                                <span>
                                                    {lastUpdate ? lastUpdate.toRelative() : 'Never'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <span className="text-text-muted block uppercase tracking-tighter">Diagnostic</span>
                                            <div className={`flex items-center space-x-1.5 ${instance.errorMessage ? 'text-price-down' : 'text-price-up'}`}>
                                                <Shield size={12} />
                                                <span>{instance.errorMessage ? 'Critical' : 'Optimal'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-2 flex items-center justify-between border-t border-border-muted">
                                        <div className="flex space-x-2">
                                            {instance.status === 'ACTIVE' ? (
                                                <button
                                                    onClick={() => updateStatus(instance.id, 'PAUSED')}
                                                    className="p-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 rounded-lg transition-colors border border-yellow-500/20"
                                                    title="Pause Indicator"
                                                >
                                                    <Pause size={16} />
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => updateStatus(instance.id, 'ACTIVE')}
                                                    className="p-2 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg transition-colors border border-green-500/20"
                                                    title="Resume Indicator"
                                                >
                                                    <Play size={16} />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setSelectedInstance(instance)}
                                                className="p-2 bg-accent/10 hover:bg-accent/20 text-accent rounded-lg transition-colors border border-accent/20"
                                                title="Configure Alerts"
                                            >
                                                <Bell size={16} />
                                            </button>
                                            <button
                                                onClick={() => updateStatus(instance.id, 'ARCHIVED')}
                                                className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors border border-red-500/20"
                                                title="Archive Indicator"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                        <Link
                                            href={`/indicators/${instance.id}/chart`}
                                            className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all shadow-lg shadow-blue-600/20 text-sm font-bold"
                                        >
                                            <BarChart2 size={16} />
                                            <span>Analyzer</span>
                                        </Link>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {selectedInstance && (
                    <AlertConfigurationModal
                        instance={selectedInstance}
                        isOpen={!!selectedInstance}
                        onClose={() => setSelectedInstance(null)}
                        onSave={async (alertData) => { await createAlert(alertData); }}
                    />
                )}
            </div>
            </MainLayout>
        </AccessGate>
    );
}
