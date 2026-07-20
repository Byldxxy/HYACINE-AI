/**
 * WebUI 中“显示桌宠”开关的状态桥。
 *
 * POST 先乐观更新 UI，再由 server.js 通过子进程 IPC 控制 Electron 窗口；失败时回滚。
 * 普通 node server 没有 process.send，因此 available=false 并禁用开关。
 */
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
        // 乐观更新减少按钮延迟；网络或 IPC 失败时 catch 恢复原状态。
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
