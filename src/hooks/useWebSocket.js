/**
 * WebUI 实时日志 WebSocket。
 *
 * 与桌宠 usePetEvents 使用同一端口，但连接后发送 iam_frontend，后端据此只转发日志。
 * 连接断开后退避重连；cleanup 同时取消待执行重连与连接事件。
 */
import { useEffect, useRef } from 'react';
import { WS_URL } from '../lib/api';
import { createReconnectingSocket } from '../lib/reconnectingSocket';

/**
 * WebSocket 连接 hook
 * @param {Function} onLog - 日志回调 (level, content, time)
 * @param {Function} onStatusChange - 状态变化回调 (message)
 */
export function useWebSocket(onLog, onStatusChange) {
    const wsRef = useRef(null);
    const callbacksRef = useRef({ onLog, onStatusChange });

    useEffect(() => {
        callbacksRef.current = { onLog, onStatusChange };
    }, [onLog, onStatusChange]);

    useEffect(() => createReconnectingSocket({
        url: WS_URL,
        identity: 'iam_frontend',
        onSocketChange: socket => { wsRef.current = socket; },
        onOpen: () => callbacksRef.current.onStatusChange?.("✨ 链接正常，等待指令。"),
        onMessage: event => {
            const callbacks = callbacksRef.current;
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'log') {
                    callbacks.onLog?.(data.level, data.content, data.time);
                    if (data.level === 'out') callbacks.onStatusChange?.("回复已发送！");
                }
            } catch {
                callbacks.onLog?.('error', '收到无法解析的 WebSocket 消息');
            }
        },
    }), []);

    return wsRef;
}
