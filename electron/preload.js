/**
 * Electron 安全桥。
 *
 * 桌宠页面启用了 contextIsolation 且关闭 nodeIntegration，因此不能直接访问
 * ipcRenderer、文件系统或其他 Node API。这里仅暴露经过收敛的窗口控制方法，
 * 并为事件订阅返回取消函数。新增系统能力时应扩展这个白名单，不要把
 * ipcRenderer 本身暴露给页面。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 窗口交互：渲染进程提供屏幕坐标，主进程负责真正移动原生窗口。
    setMousePassthrough: (passthrough) => {
        ipcRenderer.send('set-mouse-passthrough', passthrough);
    },
    openConfig: () => {
        ipcRenderer.send('open-config');
    },
    dragStart: (mouseX, mouseY) => {
        ipcRenderer.send('drag-start', { mouseX, mouseY });
    },
    dragMove: (mouseX, mouseY) => {
        ipcRenderer.send('drag-move', { mouseX, mouseY });
    },
    dragEnd: () => {
        ipcRenderer.send('drag-end');
    },
    // 订阅函数都返回 unsubscribe，供 React useEffect 在卸载时清理监听器。
    onPassthroughChanged: (callback) => {
        const listener = (_e, val) => callback(val);
        ipcRenderer.on('passthrough-changed', listener);
        return () => ipcRenderer.removeListener('passthrough-changed', listener);
    },
    onGlobalCursorMoved: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('global-cursor-moved', listener);
        return () => ipcRenderer.removeListener('global-cursor-moved', listener);
    },
    togglePassthrough: () => {
        ipcRenderer.send('toggle-passthrough');
    },
    resizePetWindow: (width, height, anchorBottom = false) => {
        ipcRenderer.send('resize-pet-window', { width, height, anchorBottom });
    },
    testDesktopAwareness: () => ipcRenderer.invoke('test-desktop-awareness'),
});
