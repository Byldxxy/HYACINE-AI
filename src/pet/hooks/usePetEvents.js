/**
 * 订阅后端广播的桌宠语义事件。
 *
 * 连接建立后用 `iam_pet` 标识客户端，server.js 才会向它发送 pet:event。onEvent 放入
 * ref 是为了让 WebSocket 只建立一次，同时始终调用 React 最新 render 中的回调。
 */
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
                // 后端重启很常见，固定 3 秒重连；组件卸载后 disposed 会阻止重新连接。
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
