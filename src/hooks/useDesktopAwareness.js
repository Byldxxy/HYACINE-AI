import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';

const INITIAL_STATE = {
    available: false,
    enabled: false,
    paused: false,
    processing: false,
    lastResult: 'idle',
    petConnected: false,
    status: 'loading',
    detail: '',
};

export function useDesktopAwareness() {
    const [state, setState] = useState(INITIAL_STATE);

    const refresh = useCallback(async () => {
        try {
            const response = await fetch(apiUrl('/api/desktop-awareness'));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setState({
                available: Boolean(data.available),
                enabled: Boolean(data.enabled),
                paused: Boolean(data.paused),
                processing: Boolean(data.processing),
                lastResult: String(data.lastResult || 'idle'),
                petConnected: Boolean(data.petConnected),
                status: String(data.status || 'unavailable'),
                detail: String(data.detail || ''),
            });
        } catch {
            setState({ ...INITIAL_STATE, status: 'unavailable' });
        }
    }, []);

    useEffect(() => {
        const initialTimer = window.setTimeout(refresh, 0);
        const timer = window.setInterval(refresh, 5000);
        return () => {
            window.clearTimeout(initialTimer);
            window.clearInterval(timer);
        };
    }, [refresh]);

    return state;
}
