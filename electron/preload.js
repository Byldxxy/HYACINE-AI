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
        ipcRenderer.on('passthrough-changed', (_e, val) => callback(val));
    },
    togglePassthrough: () => {
        ipcRenderer.send('toggle-passthrough');
    },
    resizePetWindow: (width, height) => {
        ipcRenderer.send('resize-pet-window', { width, height });
    }
});
