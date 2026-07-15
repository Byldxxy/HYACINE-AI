import { useEffect, useRef } from 'react';
import { WS_URL } from '../../lib/api';

export function usePetEvents(onEvent) {
    const callbackRef = useRef(onEvent);

    useEffect(() => {
        callbackRef.current = onEvent;
    }, [onEvent]);

    useEffect(() => {
        let ws;
        let reconnectTimer;
        let disposed = false;

        const connect = () => {
            if (disposed) return;
            ws = new WebSocket(WS_URL);
            ws.onopen = () => ws.send('iam_pet');
            ws.onmessage = (message) => {
                try {
                    const payload = JSON.parse(message.data);
                    if (payload.type === 'pet:event') callbackRef.current?.(payload.event, payload.detail || {});
                } catch {
                    // Ignore non-JSON and unrelated OneBot traffic.
                }
            };
            ws.onclose = () => {
                if (!disposed) reconnectTimer = setTimeout(connect, 3000);
            };
        };

        connect();
        return () => {
            disposed = true;
            clearTimeout(reconnectTimer);
            if (ws) {
                ws.onclose = null;
                ws.close();
            }
        };
    }, []);
}
