/**
 * Electron 主进程（桌宠模式）。
 *
 * 这个文件是桌面版的系统能力入口，主要负责四件事：
 * 1. 创建透明、置顶的 BrowserWindow，并在其中加载 React 桌宠页面；
 * 2. 启动 Express/OneBot 后端 utility process，通过 IPC 与其同步配置和截图；
 * 3. 提供托盘、全局鼠标、窗口拖拽/缩放、内容保护等浏览器没有的能力；
 * 4. 把受控能力通过 preload.js 暴露给渲染进程。
 *
 * 维护时请注意这里有两条消息通道：
 * - main <-> server.js 使用 utilityProcess IPC（postMessage / parentPort）；
 * - main <-> React 桌宠使用 Electron IPC（ipcMain / contextBridge）。
 */
const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    screen,
    shell,
    systemPreferences,
    Tray,
    utilityProcess,
} = require('electron');
const path = require('path');
const { getElectronDataDir } = require('../lib/paths');
const { createDesktopObserver } = require('./desktop-observer');

// 下列变量代表进程级单例。桌宠只允许创建一个窗口、托盘和观察器。
let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverReady = false;
let serverRestartTimer = null;
let serverRestartAttempts = 0;
let desktopObserver = null;
let cursorTrackingTimer = null;
let isQuitting = false;
let isPassthrough = false;
let isPetVisible = true;
let hidePetFromCapture = true;
const isDev = !app.isPackaged;
const PET_WIDTH = 250;
const PET_HEIGHT = 400;
const API_PORT = process.env.API_PORT || process.env.PORT || '3001';
const CONFIG_URL = `http://127.0.0.1:${API_PORT}`;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

// Test harnesses and portable builds may isolate Electron state without changing OS defaults.
if (process.env.HYACINE_USER_DATA_DIR) {
    app.setPath('userData', path.resolve(process.env.HYACINE_USER_DATA_DIR));
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function getApplicationRoot() {
    // app.getAppPath() is the ASAR root when packaged, but points at electron/ when
    // development starts with `electron electron/main.js`.
    return app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
}

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (!mainWindow.isVisible()) setPetVisible(true);
        mainWindow.showInactive();
    });
}

// --- 启动 Express 后端 ---
function sendToServer(message) {
    if (!serverReady || !serverProcess?.pid) return false;
    serverProcess.postMessage(message);
    return true;
}

function handleServerMessage(message) {
    // 后端保存配置后会把影响操作系统行为的部分回推给主进程。
    // 不让 server.js 直接调用 Electron API，可以保持普通 Web 模式仍可独立运行。
    if (message?.type === 'set-desktop-pet-visible') {
        setPetVisible(Boolean(message.visible));
    }
    if (message?.type === 'desktop-awareness-config') {
        hidePetFromCapture = message.config?.desktopAwarenessHidePetFromCapture !== false;
        mainWindow?.setContentProtection(hidePetFromCapture);
        desktopObserver?.updateConfig(message.config || {});
        rebuildTrayMenu();
    }
}

function getServerEnvironment() {
    const appRoot = getApplicationRoot();
    const explicitDataDir = process.env.HYACINE_DATA_DIR;
    const dataDir = explicitDataDir || getElectronDataDir({
        isPackaged: app.isPackaged,
        appRoot,
        userDataRoot: app.getPath('userData'),
        forceUserData: Boolean(process.env.HYACINE_USER_DATA_DIR),
    });
    const publicRoot = app.isPackaged
        ? path.join(process.resourcesPath, 'public')
        : path.join(appRoot, 'public');
    const environment = {
        ...process.env,
        NODE_ENV: app.isPackaged ? 'production' : 'development',
        ELECTRON_DESKTOP_PET: '1',
        HYACINE_RUNTIME_ROOT: appRoot,
        HYACINE_DATA_DIR: dataDir,
        HYACINE_DIST_DIR: path.join(appRoot, 'dist'),
        HYACINE_PUBLIC_DIR: publicRoot,
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    return environment;
}

function scheduleServerRestart() {
    if (isQuitting || serverRestartTimer) return;
    serverRestartAttempts += 1;
    if (serverRestartAttempts > 5) {
        dialog.showErrorBox('HYACINE-AI 后端已停止', '后端连续启动失败，请查看终端或日志后重新启动应用。');
        return;
    }
    const delay = Math.min(15_000, 1000 * (2 ** (serverRestartAttempts - 1)));
    console.warn(`[Electron] 后端将在 ${delay}ms 后重启（${serverRestartAttempts}/5）`);
    serverRestartTimer = setTimeout(() => {
        serverRestartTimer = null;
        startServer().catch((error) => {
            console.error('[Electron] 后端重启失败:', error.message);
            scheduleServerRestart();
        });
    }, delay);
}

function startServer() {
    const appRoot = getApplicationRoot();
    const serverPath = path.join(appRoot, 'server.js');
    serverReady = false;
    rebuildTrayMenu();

    return new Promise((resolve, reject) => {
        const child = utilityProcess.fork(serverPath, [], {
            cwd: appRoot,
            stdio: 'pipe',
            serviceName: 'HYACINE-AI Backend',
            env: getServerEnvironment(),
        });
        serverProcess = child;
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error('后端启动超时'));
        }, 20_000);

        child.stdout?.on('data', data => console.log(`[Server] ${data}`));
        child.stderr?.on('data', data => console.error(`[Server] ${data}`));
        child.on('message', (message) => {
            handleServerMessage(message);
            if (message?.type !== 'server-ready' || settled) return;
            settled = true;
            clearTimeout(timeout);
            serverReady = true;
            serverRestartAttempts = 0;
            rebuildTrayMenu();
            notifyServerPetState();
            resolve();
        });
        child.on('exit', (code) => {
            const exitedAfterReady = serverReady;
            clearTimeout(timeout);
            if (serverProcess === child) serverProcess = null;
            serverReady = false;
            rebuildTrayMenu();
            console.log(`[Server] 退出, code: ${code}`);
            if (!settled) {
                settled = true;
                reject(new Error(`后端启动失败，退出码 ${code}`));
            } else if (!isQuitting && exitedAfterReady) {
                scheduleServerRestart();
            }
        });
    });
}

function createObserver() {
    // Observer 只做本地、低成本采样；真正的视觉模型请求在 server 子进程中完成。
    // 这样 Electron 主进程不会持有 API Key，也不会因网络请求阻塞窗口事件循环。
    desktopObserver = createDesktopObserver({
        sendFrame: (frame) => {
            sendToServer({ type: 'desktop-awareness-frame', frame });
        },
        onStatus: (state) => {
            sendToServer({ type: 'desktop-awareness-state', state });
            rebuildTrayMenu();
        },
    });
    desktopObserver.start();
}

function setDesktopAwarenessEnabled(enabled) {
    // macOS 的前台应用识别依赖辅助功能权限；Windows/Linux 不走这个分支。
    if (enabled && process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
        systemPreferences.isTrustedAccessibilityClient(true);
    }
    sendToServer({ type: 'set-desktop-awareness-enabled', enabled: Boolean(enabled) });
}

function setHidePetFromCapture(enabled) {
    hidePetFromCapture = Boolean(enabled);
    mainWindow?.setContentProtection(hidePetFromCapture);
    sendToServer({ type: 'set-desktop-capture-hide-pet', enabled: hidePetFromCapture });
    rebuildTrayMenu();
}

function notifyServerPetState() {
    sendToServer({ type: 'desktop-pet-state', visible: isPetVisible });
}

function setPetVisible(visible) {
    isPetVisible = visible;
    // 隐藏桌宠也暂停采集，避免用户认为“看不见桌宠”等于退出时仍在截图。
    desktopObserver?.setSuspended(!visible);
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
            // 渲染页会加载模型和远端内容，因此保持 Node 隔离，只开放白名单 IPC。
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    // 窗口始终可交互（不使用穿透，确保拖拽可用）
    mainWindow.setIgnoreMouseEvents(false);
    // 操作系统支持时让桌宠不出现在截屏中；用户可从托盘关闭此保护以允许自我互动。
    mainWindow.setContentProtection(hidePetFromCapture);

    // 加载桌宠页面
    if (isDev) {
        // 开发模式：连接 Vite dev server
        mainWindow.loadURL(`${DEV_SERVER_URL.replace(/\/$/, '')}/pet.html`);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        // 生产模式也通过本地 HTTP 加载，使 /assets、模型和 Ammo 路径保持一致。
        mainWindow.loadURL(`${CONFIG_URL}/pet.html`);
    }

    mainWindow.on('show', () => {
        isPetVisible = true;
        desktopObserver?.setSuspended(false);
        notifyServerPetState();
        rebuildTrayMenu();
    });
    mainWindow.on('hide', () => {
        isPetVisible = false;
        desktopObserver?.setSuspended(true);
        notifyServerPetState();
        rebuildTrayMenu();
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
        isPetVisible = false;
        desktopObserver?.setSuspended(true);
        notifyServerPetState();
    });
}

function startCursorTracking() {
    if (cursorTrackingTimer) return;
    // renderer 内的 mousemove 只能覆盖桌宠窗口；全局坐标必须由主进程读取。
    // 20 FPS 足以表现视线跟随，同时避免高频 IPC 占用主线程。
    cursorTrackingTimer = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
        const point = screen.getCursorScreenPoint();
        const bounds = mainWindow.getBounds();
        mainWindow.webContents.send('global-cursor-moved', {
            x: point.x,
            y: point.y,
            windowBounds: bounds,
        });
    }, 50);
}

function stopCursorTracking() {
    if (cursorTrackingTimer) clearInterval(cursorTrackingTimer);
    cursorTrackingTimer = null;
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
        {
            label: '桌面感知',
            type: 'checkbox',
            enabled: serverReady,
            checked: Boolean(desktopObserver?.getState().enabled),
            click: (item) => setDesktopAwarenessEnabled(item.checked)
        },
        {
            label: '截图隐藏',
            type: 'checkbox',
            enabled: serverReady,
            checked: hidePetFromCapture,
            click: (item) => setHidePetFromCapture(item.checked)
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
    const publicRoot = app.isPackaged
        ? path.join(process.resourcesPath, 'public')
        : path.join(getApplicationRoot(), 'public');
    const iconPath = path.join(publicRoot, 'tray_icon.png');
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
        console.warn('[Electron] 未找到 public/tray_icon.png，跳过系统托盘创建');
        return;
    }
    // macOS: 标记为 Template Image，自动适配深色/浅色菜单栏。
    // Windows 会忽略该标记，继续使用原始 PNG。
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('HYACINE-AI 桌宠');
    rebuildTrayMenu();
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
ipcMain.on('resize-pet-window', (_event, { width, height, anchorBottom }) => {
    if (mainWindow) {
        const nextWidth = Math.round(width);
        const nextHeight = Math.round(height);
        if (anchorBottom) {
            // 气泡增加窗口高度时固定窗口底边，否则角色会随着窗口变高向下跳动。
            const [x, y] = mainWindow.getPosition();
            const [, currentHeight] = mainWindow.getSize();
            mainWindow.setBounds({
                x,
                y: y + currentHeight - nextHeight,
                width: nextWidth,
                height: nextHeight,
            });
        } else {
            mainWindow.setSize(nextWidth, nextHeight);
        }
    }
});

ipcMain.handle('test-desktop-awareness', async () => {
    if (!desktopObserver) return { ok: false, message: '桌面感知尚未初始化' };
    // 点击菜单会让桌宠成为前台应用；先失焦并稍等，避免观察器截到自己的菜单。
    mainWindow?.blur();
    await new Promise(resolve => setTimeout(resolve, 250));
    return desktopObserver.requestTest();
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
app.whenReady().then(async () => {
    if (!hasSingleInstanceLock) return;
    // Observer 可以先创建；server 启动后会通过 desktop-awareness-config
    // 下发最终配置，使观察器从默认关闭状态切换到用户保存的状态。
    createObserver();
    try {
        await startServer();
        createPetWindow();
        createTray();
        startCursorTracking();
    } catch (error) {
        dialog.showErrorBox('HYACINE-AI 启动失败', error.message);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    stopCursorTracking();
    desktopObserver?.stop();
    if (serverProcess) serverProcess.kill();
    app.quit();
});

app.on('before-quit', () => {
    isQuitting = true;
    clearTimeout(serverRestartTimer);
    stopCursorTracking();
    desktopObserver?.stop();
    if (serverProcess) serverProcess.kill();
});
