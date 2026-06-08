import { useState, useCallback, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
    TechIndicatorDefinition,
    ComposedSignal,
    ComposedSignalBlocks,
} from '@/types/signals';
import { useAppLocale } from '@/hooks/useAppLocale';
import { localizeTechIndicatorDefinitions } from '@/lib/localizeTechIndicators';

const readErrorMessage = (err: unknown, fallbackMessage: string) => {
    const apiMessage = typeof err === 'object' && err !== null && 'response' in err
        ? (err as { response?: { data?: { error?: unknown } } }).response?.data?.error
        : undefined;

    if (typeof apiMessage === 'string' && apiMessage.trim().length > 0) {
        return apiMessage;
    }

    return err instanceof Error ? err.message : fallbackMessage;
};

// ─── Indicator Catalog ───────────────────────────────────────────────────────

export function useTechIndicatorCatalog() {
    const { locale, copy } = useAppLocale();
    const [indicators, setIndicators] = useState<TechIndicatorDefinition[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/tech-indicators');
            setIndicators(res.data as TechIndicatorDefinition[]);
            setError(null);
        } catch (err: unknown) {
            setError(readErrorMessage(err, copy.common.requestFailed));
        } finally {
            setLoading(false);
        }
    }, [copy.common.requestFailed]);

    useEffect(() => { fetch(); }, [fetch]);

    const localizedIndicators = useMemo(
        () => localizeTechIndicatorDefinitions(indicators, locale),
        [indicators, locale],
    );

    return { indicators: localizedIndicators, loading, error, refetch: fetch };
}

// ─── Composed Signals CRUD ───────────────────────────────────────────────────

export function useComposedSignals() {
    const { copy } = useAppLocale();
    const [signals, setSignals] = useState<ComposedSignal[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/signals/composed');
            setSignals(res.data as ComposedSignal[]);
            setError(null);
        } catch (err: unknown) {
            setError(readErrorMessage(err, copy.common.requestFailed));
        } finally {
            setLoading(false);
        }
    }, [copy.common.requestFailed]);

    const create = useCallback(async (payload: {
        name: string;
        description?: string;
        category?: string;
        composedBlocks: ComposedSignalBlocks;
        createdBy?: string;
    }): Promise<ComposedSignal> => {
        const res = await axios.post('/api/signals/composed', payload);
        await fetchAll();
        return res.data as ComposedSignal;
    }, [fetchAll]);

    const update = useCallback(async (id: string, payload: Partial<{
        name: string;
        description: string;
        composedBlocks: ComposedSignalBlocks;
    }>): Promise<ComposedSignal> => {
        const res = await axios.patch(`/api/signals/composed/${id}`, payload);
        await fetchAll();
        return res.data as ComposedSignal;
    }, [fetchAll]);

    const retire = useCallback(async (id: string): Promise<ComposedSignal> => {
        const res = await axios.delete(`/api/signals/composed/${id}`);
        await fetchAll();
        return res.data as ComposedSignal;
    }, [fetchAll]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    return { signals, loading, error, refetch: fetchAll, create, update, retire };
}
