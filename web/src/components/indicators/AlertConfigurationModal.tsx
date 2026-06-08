"use client";

import React, { useState } from 'react';
import { X, Bell, AlertTriangle, ShieldCheck, Zap } from 'lucide-react';
import { IndicatorInstance, AlertType } from '@/types/signals';
import { useAppLocale } from '@/hooks/useAppLocale';
import { interpolateCopy } from '@/lib/translations';

interface AlertConfigurationModalProps {
    instance: IndicatorInstance;
    isOpen: boolean;
    onClose: () => void;
    onSave: (alertData: any) => Promise<void>;
}

export default function AlertConfigurationModal({ instance, isOpen, onClose, onSave }: AlertConfigurationModalProps) {
    const [type, setType] = useState<AlertType>('PRICE');
    const [operator, setOperator] = useState('>');
    const [target, setTarget] = useState('');
    const [eventType, setEventType] = useState('ENTRY');
    const [loading, setLoading] = useState(false);
    const { copy } = useAppLocale();

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const conditionJson = type === 'PRICE'
                ? { operator, target: parseFloat(target) }
                : { eventType };

            await onSave({
                instanceId: instance.id,
                type,
                conditionJson
            });
            onClose();
        } catch (err) {
            console.error('Failed to save alert:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md bg-bg-secondary border border-border-muted rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-muted bg-bg-tertiary/50">
                    <div className="flex items-center gap-2 font-bold text-text-primary">
                        <Bell className="w-5 h-5 text-accent" />
                        {copy.alertConfig.configureSmartAlert}
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-bg-primary rounded-lg transition-colors">
                        <X className="w-5 h-5 text-text-muted" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-text-muted uppercase tracking-wider">{copy.alertConfig.alertType}</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setType('PRICE')}
                                className={`px-4 py-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${type === 'PRICE'
                                        ? 'bg-accent/10 border-accent text-accent shadow-inner'
                                        : 'bg-bg-primary border-border-muted text-text-muted hover:border-text-muted'
                                    }`}
                            >
                                <Zap className="w-5 h-5" />
                                <span className="text-xs font-bold uppercase">{copy.alertConfig.priceAction}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setType('INDICATOR')}
                                className={`px-4 py-3 rounded-lg border flex flex-col items-center gap-2 transition-all ${type === 'INDICATOR'
                                        ? 'bg-accent/10 border-accent text-accent shadow-inner'
                                        : 'bg-bg-primary border-border-muted text-text-muted hover:border-text-muted'
                                    }`}
                            >
                                <ShieldCheck className="w-5 h-5" />
                                <span className="text-xs font-bold uppercase">{copy.alertConfig.signalMatrix}</span>
                            </button>
                        </div>
                    </div>

                    {type === 'PRICE' ? (
                        <div className="space-y-4 animate-in slide-in-from-left-2 duration-300">
                            <div className="flex items-center gap-3">
                                <select
                                    value={operator}
                                    onChange={(e) => setOperator(e.target.value)}
                                    className="px-3 py-2 bg-bg-primary border border-border-muted rounded-lg text-sm text-text-primary focus:border-accent outline-none"
                                >
                                    <option value=">">{copy.alertConfig.greaterThanOrEqual}</option>
                                    <option value="<">{copy.alertConfig.lessThanOrEqual}</option>
                                </select>
                                <input
                                    type="number"
                                    step="any"
                                    value={target}
                                    onChange={(e) => setTarget(e.target.value)}
                                    placeholder={copy.alertConfig.targetPrice}
                                    className="flex-1 px-3 py-2 bg-bg-primary border border-border-muted rounded-lg text-sm text-text-primary focus:border-accent outline-none"
                                    required
                                />
                            </div>
                            <p className="text-[10px] text-text-muted italic">
                                {interpolateCopy(copy.alertConfig.notifyPriceCross, { symbol: instance.symbol })}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4 animate-in slide-in-from-right-2 duration-300">
                            <label className="text-xs font-bold text-text-muted uppercase tracking-wider">{copy.alertConfig.selectSignalEvent}</label>
                            <select
                                value={eventType}
                                onChange={(e) => setEventType(e.target.value)}
                                className="w-full px-3 py-2 bg-bg-primary border border-border-muted rounded-lg text-sm text-text-primary focus:border-accent outline-none"
                            >
                                <option value="ENTRY">{copy.alertConfig.entryPrimary}</option>
                                <option value="ENTRY_CONFIRMED">{copy.alertConfig.entryConfirmedStrict}</option>
                                <option value="TP1_HIT">{copy.alertConfig.tp1HitSuccess}</option>
                                <option value="STOP_HIT">{copy.alertConfig.stopHitFailure}</option>
                            </select>
                            <p className="text-[10px] text-text-muted italic">
                                {interpolateCopy(copy.alertConfig.notifyEngineEvent, { name: instance.name })}
                            </p>
                        </div>
                    )}

                    <div className="pt-4 border-t border-border-muted flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 bg-bg-primary border border-border-muted rounded-lg text-xs font-bold text-text-secondary hover:bg-bg-tertiary transition-colors uppercase"
                        >
                            {copy.alertConfig.cancel}
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 rounded-lg text-xs font-bold text-white shadow-lg shadow-accent/20 transition-all uppercase"
                        >
                            {loading ? copy.alertConfig.saving : copy.alertConfig.activateAlert}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
