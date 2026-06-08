"use client";

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { resolveSocketUrl } from '@/lib/socketUrl';


export function useSocket() {
    const [connected, setConnected] = useState(false);
    const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        if (!socketRef.current) {
            const socketUrl = resolveSocketUrl();
            const newSocket = io(socketUrl, {
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                withCredentials: true,
            });
            socketRef.current = newSocket;
            setSocketInstance(newSocket);
        }

        const socket = socketRef.current;
        if (!socket) return;

        const onConnect = () => {
            setConnected(true);
            console.log('[Socket] Connected to server');
        };

        const onDisconnect = () => {
            setConnected(false);
            console.log('[Socket] Disconnected from server');
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            // We usually don't disconnect the entire socket if shared,
            // but we MUST remove the listeners tied to this component's state setters.
        };
    }, []);

    return {
        socket: socketInstance,
        connected
    };
}
