"use client";

import React, { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { Bell, X, ShieldAlert, Zap, Clock } from 'lucide-react';
import { TriggeredAlert } from '@/types/signals';
import { DateTime } from 'luxon';
import { useSocketContext } from '@/components/SocketProvider';
import { useAppLocale } from '@/hooks/useAppLocale';

export default function NotificationToaster() {
    const { socket } = useSocketContext();
    const { intlLocale, copy } = useAppLocale();
    const [notifications, setNotifications] = useState<TriggeredAlert[]>([]);

    useEffect(() => {
        if (!socket) return;

        const handleAlert = (alert: TriggeredAlert) => {
            setNotifications(prev => [alert, ...prev].slice(0, 5));

            // Play sound
            try {
                const audio = new Audio('/sounds/alert.mp3');
                audio.play();
            } catch (e) {
                // Ignore audio errors (browser policy)
            }

            // Auto-hide after 8 seconds
            setTimeout(() => {
                setNotifications(prev => prev.filter(n => n.alertId !== alert.alertId || n.timestamp !== alert.timestamp));
            }, 8000);
        };

        socket.on('indicator:alerts:triggered', handleAlert);

        return () => {
            socket.off('indicator:alerts:triggered', handleAlert);
        };
    }, [socket]);

    const removeNotification = (alert: TriggeredAlert) => {
        setNotifications(prev => prev.filter(n => n.alertId !== alert.alertId || n.timestamp !== alert.timestamp));
    };

    return (
        <div className="fixed top-20 right-6 z-[200] flex flex-col gap-3 w-80 pointer-events-none">
            {notifications.map((notif, i) => (
                <div
                    key={`${notif.alertId}-${notif.timestamp}`}
                    className="pointer-events-auto bg-bg-secondary/90 backdrop-blur-xl border border-accent/30 rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-right duration-300"
                >
                    <div className="flex">
                        <div className="w-1.5 bg-accent"></div>
                        <div className="flex-1 p-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="p-1.5 bg-accent/10 rounded-lg">
                                        <Bell className="w-4 h-4 text-accent" />
                                    </div>
                                    <span className="text-xs font-bold text-text-primary uppercase tracking-tight">
                                        {copy.notification.smartAlertTriggered}
                                    </span>
                                </div>
                                <button
                                    onClick={() => removeNotification(notif)}
                                    className="p-1 hover:bg-bg-primary rounded-lg transition-colors"
                                >
                                    <X className="w-4 h-4 text-text-muted" />
                                </button>
                            </div>

                            <div className="mt-2 space-y-1">
                                <div className="flex items-center gap-1.5">
                                    <ShieldAlert className="w-3 h-3 text-red-400" />
                                    <span className="text-[11px] font-bold text-text-secondary">{notif.instanceName}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 bg-bg-tertiary border border-border-muted rounded text-text-muted">
                                        {notif.symbol}
                                    </span>
                                </div>
                                <p className="text-xs text-text-primary leading-relaxed pl-4.5 border-l border-border-muted ml-1.5 py-1">
                                    {notif.message}
                                </p>
                            </div>

                            <div className="mt-3 flex items-center justify-between text-[10px] text-text-muted">
                                <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {DateTime.fromISO(notif.timestamp).setLocale(intlLocale).toRelative()}
                                </div>
                                <div className="flex items-center gap-1 animate-pulse">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent"></div>
                                    {copy.notification.live}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
