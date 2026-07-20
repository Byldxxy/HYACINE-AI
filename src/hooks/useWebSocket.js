/**
 * WebUI 实时日志 WebSocket。
 *
 * 与桌宠 usePetEvents 使用同一端口，但连接后发送 iam_frontend，后端据此只转发日志。
 * 连接断开后自动重连；cleanup 会移除 onclose，避免页面卸载后定时器重新建连。
 */
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
