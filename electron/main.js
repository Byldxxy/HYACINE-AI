// electron/main.js - Electron 主进程 (桌宠模式)
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, screen } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isPassthrough = false;
let isPetVisible = true;
const isDev = process.env.NODE_ENV !== 'production';
const PET_WIDTH = 250;
const PET_HEIGHT = 400;
const API_PORT = process.env.API_PORT || process.env.PORT || '3001';
const CONFIG_URL = `http://localhost:${API_PORT}`;

// --- 启动 Express 后端 ---
function startServer() {
    const serverPath = path.join(__dirname, '..', 'server.js');
    serverProcess = fork(serverPath, [], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
        env: {
            ...process.env,
            NODE_ENV: process.env.NODE_ENV || 'development',
            ELECTRON_DESKTOP_PET: '1',
        }
    });
    serverProcess.stdout?.on('data', (d) => console.log(`[Server] ${d}`));
    serverProcess.stderr?.on('data', (d) => console.error(`[Server] ${d}`));
    serverProcess.on('exit', (code) => console.log(`[Server] 退出, code: ${code}`));
    serverProcess.on('message', (message) => {
        if (message?.type === 'set-desktop-pet-visible') {
            setPetVisible(Boolean(message.visible));
        }
    });
}

function notifyServerPetState() {
    if (serverProcess?.connected) {
        serverProcess.send({ type: 'desktop-pet-state', visible: isPetVisible });
    }
}

function setPetVisible(visible) {
    isPetVisible = visible;
    if (mainWindow) {
        if (visible) mainWindow.showInactive();
        else mainWindow.hide();
    }
    notifyServerPetState();
    rebuildTrayMenu();
}

// --- 创建桌宠窗口 ---
function createPetWindow() {
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: PET_WIDTH,
        height: PET_HEIGHT,
        x: screenW - PET_WIDTH - 50,   // 右下角
        y: screenH - PET_HEIGHT,
        transparent: true,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        hasShadow: false,
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    // 窗口始终可交互（不使用穿透，确保拖拽可用）
    mainWindow.setIgnoreMouseEvents(false);

    // 加载桌宠页面
    if (isDev) {
        // 开发模式：连接 Vite dev server
        mainWindow.loadURL('http://localhost:5173/pet.html');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        // 生产模式：加载构建产物
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'pet.html'));
    }

    mainWindow.on('show', () => {
        isPetVisible = true;
        notifyServerPetState();
        rebuildTrayMenu();
    });
    mainWindow.on('hide', () => {
        isPetVisible = false;
        notifyServerPetState();
        rebuildTrayMenu();
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
        isPetVisible = false;
        notifyServerPetState();
    });
}

// --- 系统托盘 ---
function rebuildTrayMenu() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        {
            label: '打开配置面板',
            click: () => shell.openExternal(CONFIG_URL)
        },
        { type: 'separator' },
        {
            label: '显示桌宠',
            type: 'checkbox',
            checked: isPetVisible,
            click: (item) => setPetVisible(item.checked)
        },
        {
            label: '穿透模式',
            type: 'checkbox',
            checked: isPassthrough,
            click: (item) => {
                if (!mainWindow) return;
                isPassthrough = item.checked;
                mainWindow.setIgnoreMouseEvents(isPassthrough, isPassthrough ? { forward: true } : undefined);
                mainWindow.webContents.send('passthrough-changed', isPassthrough);
            }
        },
        {
            label: '置顶切换',
            type: 'checkbox',
            checked: true,
            click: (item) => {
                if (mainWindow) mainWindow.setAlwaysOnTop(item.checked);
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => app.quit()
        }
    ]);
    tray.setContextMenu(contextMenu);
}

function createTray() {
    const { nativeImage } = require('electron');
    const iconPath = path.join(__dirname, '..', 'public', 'tray_icon.png');
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
        console.warn('[Electron] 未找到 public/tray_icon.png，跳过系统托盘创建');
        return;
    }
    // macOS: 标记为 Template Image，自动适配深色/浅色菜单栏
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('HYACINE-AI 桌宠');
    rebuildTrayMenu();
    tray.on('click', () => {
        if (mainWindow && !mainWindow.isVisible()) setPetVisible(true);
    });
}

// --- IPC: 渲染进程 → 主进程 ---
ipcMain.on('set-mouse-passthrough', (_event, passthrough) => {
    if (mainWindow) {
        if (passthrough) {
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
        } else {
            mainWindow.setIgnoreMouseEvents(false);
        }
    }
});

ipcMain.on('open-config', () => {
    shell.openExternal(CONFIG_URL);
});

// 拖拽窗口
ipcMain.on('drag-start', (event, { mouseX, mouseY }) => {
    if (!mainWindow) return;
    const [winX, winY] = mainWindow.getPosition();
    mainWindow._dragOffset = { x: mouseX - winX, y: mouseY - winY };
});

ipcMain.on('drag-move', (event, { mouseX, mouseY }) => {
    if (!mainWindow || !mainWindow._dragOffset) return;
    const { x: offX, y: offY } = mainWindow._dragOffset;
    mainWindow.setPosition(
        Math.round(mouseX - offX),
        Math.round(mouseY - offY)
    );
});

ipcMain.on('drag-end', () => {
    if (mainWindow) mainWindow._dragOffset = null;
});

// 窗口缩放
ipcMain.on('resize-pet-window', (_event, { width, height }) => {
    if (mainWindow) {
        mainWindow.setSize(Math.round(width), Math.round(height));
    }
});

// 穿透模式切换
ipcMain.on('toggle-passthrough', () => {
    if (!mainWindow) return;
    isPassthrough = !isPassthrough;
    mainWindow.setIgnoreMouseEvents(isPassthrough, isPassthrough ? { forward: true } : undefined);
    mainWindow.webContents.send('passthrough-changed', isPassthrough);
    rebuildTrayMenu();
});

// --- App 生命周期 ---
app.whenReady().then(() => {
    startServer();
    // 等 server 启动
    setTimeout(() => {
        createPetWindow();
        createTray();
    }, 1500);
});

app.on('window-all-closed', () => {
    if (serverProcess) serverProcess.kill();
    app.quit();
});

app.on('before-quit', () => {
    if (serverProcess) serverProcess.kill();
});
