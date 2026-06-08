"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useConnectionStatus } from '@/store/useConnectionStatus';
import { resolveSocketUrl } from '@/lib/socketUrl';


interface SocketContextType {
    socket: Socket | null;
    connected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, connected: false });

export const useSocketContext = () => useContext(SocketContext);

export function SocketProvider({
    children,
    enabled = true,
}: {
    children: React.ReactNode;
    enabled?: boolean;
}) {
    const [connected, setConnected] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const setStatus = useConnectionStatus((s) => s.setStatus);

    useEffect(() => {
        if (!enabled) {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
            setStatus('disconnected');
            return;
        }

        if (!socketRef.current) {
            const socketUrl = resolveSocketUrl();
            socketRef.current = io(socketUrl, {
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                withCredentials: true,
            });
            setSocket(socketRef.current);
        }

        const socket = socketRef.current;
        if (!socket) return;

        const onConnect = () => {
            setConnected(true);
            setStatus('connected');
            console.log('[Socket] Connected to server');
        };

        const onDisconnect = () => {
            setConnected(false);
            setStatus('disconnected');
            console.log('[Socket] Disconnected from server');
        };

        const onReconnectAttempt = () => {
            setStatus('reconnecting');
            console.log('[Socket] Reconnecting…');
        };

        const onReconnectFailed = () => {
            setStatus('failed');
            console.log('[Socket] Reconnection failed');
        };

        const onReconnect = () => {
            setConnected(true);
            setStatus('connected');
            console.log('[Socket] Reconnected');
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.io.on('reconnect_attempt', onReconnectAttempt);
        socket.io.on('reconnect_failed', onReconnectFailed);
        socket.io.on('reconnect', onReconnect);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.io.off('reconnect_attempt', onReconnectAttempt);
            socket.io.off('reconnect_failed', onReconnectFailed);
            socket.io.off('reconnect', onReconnect);
            setConnected(false);
            socket.disconnect();
            socketRef.current = null;
            setSocket(null);
        };
    }, [enabled, setStatus]);

    return (
        <SocketContext.Provider value={{ socket, connected }}>
            {children}
        </SocketContext.Provider>
    );
}
