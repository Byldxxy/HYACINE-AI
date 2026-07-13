import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';

export function useDesktopPet() {
    const [state, setState] = useState({ available: false, visible: false, loading: true });

    const refresh = useCallback(async () => {
        try {
            const response = await fetch(apiUrl('/api/desktop-pet'));
            const data = await response.json();
            setState({ available: Boolean(data.available), visible: Boolean(data.visible), loading: false });
        } catch {
            setState({ available: false, visible: false, loading: false });
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

    const setVisible = useCallback(async (visible) => {
        if (!state.available) return;
        setState(prev => ({ ...prev, visible }));
        try {
            const response = await fetch(apiUrl('/api/desktop-pet'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visible }),
            });
            const data = await response.json();
            setState({ available: Boolean(data.available), visible: Boolean(data.visible), loading: false });
        } catch {
            setState(prev => ({ ...prev, visible: !visible }));
        }
    }, [state.available]);

    return { ...state, setVisible };
}
