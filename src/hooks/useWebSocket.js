// hooks/useWebSocket.js - WebSocket 连接管理 hook
import { useEffect, useRef } from 'react';
import { WS_URL } from '../lib/api';

/**
 * WebSocket 连接 hook
 * @param {Function} onLog - 日志回调 (level, content, time)
 * @param {Function} onStatusChange - 状态变化回调 (message)
 */
export function useWebSocket(onLog, onStatusChange) {
    const wsRef = useRef(null);

    useEffect(() => {
        let ws = null;
        const connectWs = () => {
            ws = new WebSocket(WS_URL);
            wsRef.current = ws;
            ws.onopen = () => {
                ws.send("iam_frontend");
                if (onStatusChange) onStatusChange("✨ 链接正常，等待指令。");
            };
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'log') {
                        if (onLog) onLog(data.level, data.content, data.time);
                        if (data.level === 'out' && onStatusChange) onStatusChange("回复已发送！");
                    }
                } catch {
                    if (onLog) onLog('error', '收到无法解析的 WebSocket 消息');
                }
            };
            ws.onclose = () => setTimeout(connectWs, 3000);
        };
        connectWs();
        return () => {
            if (ws) {
                ws.onclose = null;
                ws.close();
            }
        };
    }, [onLog, onStatusChange]);

    return wsRef;
}
