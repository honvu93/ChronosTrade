"use client";

import React, { useState, useEffect } from 'react';
import { X, Save, RotateCcw, Layout, ShieldCheck, Zap } from 'lucide-react';
import { IndicatorInstance } from '@/types/signals';
import { useIndicators } from '@/hooks/useIndicators';
import { useAppLocale } from '@/hooks/useAppLocale';
import { interpolateCopy } from '@/lib/translations';

interface IndicatorSettingsDrawerProps {
    instance: IndicatorInstance;
    isOpen: boolean;
    onClose: () => void;
    onSaveSuccess?: () => void;
}

export default function IndicatorSettingsDrawer({ instance, isOpen, onClose, onSaveSuccess }: IndicatorSettingsDrawerProps) {
    const { updateInstance } = useIndicators();
    const [jsonConfig, setJsonConfig] = useState(JSON.stringify(instance.parameterJson, null, 2));
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { copy } = useAppLocale();

    useEffect(() => {
        setJsonConfig(JSON.stringify(instance.parameterJson, null, 2));
    }, [instance]);

    if (!isOpen) return null;

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const parsed = JSON.parse(jsonConfig);
            await updateInstance(instance.id, { parameterJson: parsed });
            onSaveSuccess?.();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Invalid JSON format');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] transition-opacity duration-300"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="fixed top-0 right-0 h-full w-[450px] bg-bg-secondary border-l border-border-muted shadow-2xl z-[160] flex flex-col animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="p-6 border-b border-border-muted flex items-center justify-between bg-bg-tertiary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent/20 rounded-lg">
                            <Layout className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text-primary">{copy.indicatorSettings.advancedSettings}</h2>
                            <p className="text-xs text-text-muted italic">{instance.name}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors text-text-muted"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <section>
                        <div className="flex items-center justify-between mb-3 text-xs font-bold uppercase tracking-widest text-text-muted">
                            <span>{copy.indicatorSettings.strategyParameters}</span>
                            <span className="text-[10px] px-1.5 py-0.5 bg-bg-primary rounded border border-border-muted">{copy.indicatorSettings.jsonConfig}</span>
                        </div>

                        <div className="relative group">
                            <textarea
                                value={jsonConfig}
                                onChange={(e) => setJsonConfig(e.target.value)}
                                className="w-full h-[350px] bg-bg-primary text-green-400 font-mono text-sm p-4 rounded-xl border border-border-muted focus:border-accent/50 outline-none transition-all resize-none shadow-inner"
                                spellCheck={false}
                            />
                            {error && (
                                <div className="absolute bottom-4 left-4 right-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[11px] text-red-500 animate-in fade-in zoom-in">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="w-3 h-3" />
                                        <span>{interpolateCopy(copy.indicatorSettings.syntaxError, { error })}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="space-y-4">
                        <div className="text-xs font-bold uppercase tracking-widest text-text-muted mb-2">{copy.indicatorSettings.capabilities}</div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-bg-primary/50 border border-border-muted rounded-lg opacity-50">
                                <div className="flex items-center gap-2 text-xs font-medium text-text-secondary mb-1">
                                    <ShieldCheck className="w-3 h-3 text-blue-400" />
                                    {copy.indicatorSettings.riskGuard}
                                </div>
                                <div className="text-[10px] text-text-muted">{copy.indicatorSettings.enabledInCode}</div>
                            </div>
                            <div className="p-3 bg-bg-primary/50 border border-border-muted rounded-lg opacity-50">
                                <div className="flex items-center gap-2 text-xs font-medium text-text-secondary mb-1">
                                    <Zap className="w-3 h-3 text-yellow-400" />
                                    {copy.indicatorSettings.liveExecution}
                                </div>
                                <div className="text-[10px] text-text-muted">{copy.indicatorSettings.manualApproval}</div>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border-muted bg-bg-tertiary/20 flex items-center gap-3">
                    <button
                        onClick={() => setJsonConfig(JSON.stringify(instance.parameterJson, null, 2))}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-bg-secondary hover:bg-bg-tertiary text-text-muted border border-border-muted rounded-lg transition-all text-sm font-medium"
                    >
                        <RotateCcw className="w-4 h-4" />
                        {copy.indicatorSettings.reset}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex-[2] flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg transition-all text-sm font-bold shadow-lg shadow-accent/20 disabled:opacity-50"
                    >
                        {isSaving ? (
                            <RotateCcw className="w-4 h-4 animate-spin" />
                        ) : (
                            <Save className="w-4 h-4" />
                        )}
                        {copy.indicatorSettings.saveParameters}
                    </button>
                </div>
            </div>
        </>
    );
}
