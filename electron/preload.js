// electron/preload.js - IPC 桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
    // 穿透模式回调
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
