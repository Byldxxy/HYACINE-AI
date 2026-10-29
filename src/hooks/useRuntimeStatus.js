import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';

export function useRuntimeStatus() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const lifecycle = useRef(null);

    const refresh = useCallback(() => {
        const current = lifecycle.current;
        if (!current) return Promise.resolve(null);
        if (current.pending) return current.pending;

        const controller = new AbortController();
        current.controller = controller;
        setLoading(true);
        const pending = Promise.resolve()
            .then(() => apiRequest('/api/status', { signal: controller.signal }))
            .then(data => {
                if (lifecycle.current === current && !controller.signal.aborted) {
                    setStatus(data);
                    setError(null);
                }
                return data;
            })
            .catch(requestError => {
                if (lifecycle.current === current && !controller.signal.aborted) {
                    setStatus(null);
                    setError(requestError.message || '无法读取运行状态');
                }
                return null;
            })
            .finally(() => {
                if (lifecycle.current !== current) return;
                current.pending = null;
                current.controller = null;
                setLoading(false);
            });
        current.pending = pending;
        return pending;
    }, []);

    useEffect(() => {
        const current = { pending: null, controller: null };
        lifecycle.current = current;
        const poll = () => {
            if (!document.hidden) void refresh();
        };
        const initialTimer = window.setTimeout(poll, 0);
        const interval = window.setInterval(poll, 10_000);
        document.addEventListener('visibilitychange', poll);
        return () => {
            lifecycle.current = null;
            current.controller?.abort();
            window.clearTimeout(initialTimer);
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', poll);
        };
    }, [refresh]);

    return { status, loading, error, refresh };
}
