import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { IndicatorInstance, IndicatorEvent, IndicatorLogicTrace, IndicatorAlert } from '@/types/signals';

export function useIndicators() {
    const [instances, setInstances] = useState<IndicatorInstance[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchInstances = useCallback(async () => {
        setLoading(true);
        try {
            const response = await axios.get('/api/indicators/instances');
            setInstances(response.data as IndicatorInstance[]);
            setError(null);
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchEvents = useCallback(async (instanceId: string) => {
        try {
            const response = await axios.get(`/api/indicators/instances/${instanceId}/events`);
            return response.data as IndicatorEvent[];
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        }
    }, []);

    const fetchTrace = useCallback(async (instanceId: string, eventId: string) => {
        try {
            const response = await axios.get(`/api/indicators/instances/${instanceId}/events/${eventId}/trace`);
            return response.data as IndicatorLogicTrace;
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        }
    }, []);

    const promoteBacktest = useCallback(async (backtestRunId: string, name?: string) => {
        setLoading(true);
        try {
            const response = await axios.post('/api/indicators/instances/promote', { backtestRunId, name });
            await fetchInstances();
            return response.data as IndicatorInstance;
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [fetchInstances]);

    const updateStatus = useCallback(async (id: string, status: string) => {
        try {
            await axios.post(`/api/indicators/instances/${id}/status`, { status });
            await fetchInstances();
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        }
    }, [fetchInstances]);

    const getInstance = useCallback(async (id: string) => {
        try {
            const response = await axios.get(`/api/indicators/instances/${id}`);
            return response.data as IndicatorInstance;
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        }
    }, []);

    const fetchAlerts = useCallback(async (instanceId: string) => {
        try {
            const response = await axios.get(`/api/indicators/instances/${instanceId}/alerts`);
            return response.data as IndicatorAlert[];
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        }
    }, []);

    const createAlert = useCallback(async (alertData: Partial<IndicatorAlert>) => {
        setLoading(true);
        try {
            const response = await axios.post('/api/indicators/alerts', alertData);
            return response.data as IndicatorAlert;
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    const toggleAlert = useCallback(async (alertId: string, isActive: boolean) => {
        try {
            await axios.patch(`/api/indicators/alerts/${alertId}`, { isActive });
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        }
    }, []);

    const updateInstance = useCallback(async (id: string, data: any) => {
        setLoading(true);
        try {
            const response = await axios.patch(`/api/indicators/instances/${id}`, data);
            await fetchInstances();
            return response.data as IndicatorInstance;
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [fetchInstances]);

    useEffect(() => {
        fetchInstances();
    }, [fetchInstances]);

    return {
        instances,
        loading,
        error,
        fetchInstances,
        fetchEvents,
        fetchTrace,
        promoteBacktest,
        updateStatus,
        getInstance,
        fetchAlerts,
        createAlert,
        toggleAlert,
        updateInstance,
    };
}
