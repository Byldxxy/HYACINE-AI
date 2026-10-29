/**
 * HYACINE-AI 后端入口。
 *
 * 同一个进程同时提供三类接口：
 * - Express REST/静态页面：WebUI 配置、记忆管理和测试接口；
 * - WebSocket：NapCat 反向连接、WebUI 日志订阅、桌宠事件订阅；
 * - process IPC：仅在 Electron fork 模式下与主进程交换桌宠状态和桌面截图。
 *
 * server.js 不直接依赖 Electron，因此也可用 `node server.js` 作为普通机器人后端运行。
 * CommonJS 入口同时保留了 Windows pkg 的兼容性。跨边界新增消息时，请同时更新发送端、
 * 接收端和不可用时的降级行为。
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

// --- 导入模块 ---
const { officialIdentity } = require('./lib/qq-identity');
const { createOfficialBot, challenge, verifyCallback } = require('./lib/qq-official');
const { createOneBotClient } = require('./lib/onebot-client');
const { timingSafeEqual } = require('node:crypto');
const { maskApiKey } = require('./lib/utils');
const { createAffect } = require('./lib/extensions/affect');
const affect = createAffect();
const { createStickerStore } = require('./lib/extensions/sticker-store');
const { createConfigManager } = require('./lib/config');
const { createMemoryManager } = require('./lib/memory');
const { restartProactiveTimer, stopProactiveTimer } = require('./lib/proactive');
const { createMessageHandler, sendToQQ } = require('./lib/message-handler');
const { createConversationRuntime } = require('./lib/conversation-runtime');
const { createTestConversation } = require('./lib/test-conversation');
const qqTransport = require('./lib/qq-transport');
const { generateImage } = require('./lib/image-gen');
const { createDesktopAwarenessEngine, normalizeDesktopAwarenessConfig } = require('./lib/desktop-awareness');
const { getRuntimePaths, prepareRuntimeData } = require('./lib/paths');
const { hasParentIpc, onParentMessage, sendToParent } = require('./lib/parent-ipc');
const { buildDiagnosticsReport } = require('./lib/diagnostics');
const { version: APP_VERSION } = require('./package.json');

// 路径必须在任何管理器初始化前准备好；配置、会话和用户图片都写入 data/，
// 不应写进 public/ 或源码目录中的历史位置。
const runtimePaths = getRuntimePaths();
const {
    isPkg,
    runtimeRoot: RUNTIME_PATH,
    configFile: CONFIG_FILE,
    memoryFile: MEMORY_FILE,
    summaryFile: SUMMARY_FILE,
    persistentFile: PERSISTENT_FILE,
    avatarDir: AVATAR_DIR,
} = runtimePaths;
const DIST_PATH = process.env.HYACINE_DIST_DIR || path.join(RUNTIME_PATH, 'dist');
const PUBLIC_PATH = process.env.HYACINE_PUBLIC_DIR || path.join(RUNTIME_PATH, 'public');
const migratedFiles = prepareRuntimeData(runtimePaths);

// ==========================================
// 🚀 初始化服务器
// ==========================================
const app = express();
const API_PORT = Number(process.env.API_PORT || process.env.PORT || 3001);
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

function sendManagementError(res, error) {
    const invalidInput = error?.code === 'invalid-data';
    if (!invalidInput) console.error('管理 API 操作失败:', error);
    return res.status(invalidInput ? 400 : 500).json({
        success: false,
        error: invalidInput ? error.message : '服务器写入失败',
    });
}

app.use(cors({
    origin(origin, callback) {
        if (!origin || LOCAL_ORIGIN_RE.test(origin)) return callback(null, true);
        return callback(new Error(`CORS origin not allowed: ${origin}`));
    }
}));
app.use(express.json({ limit: '1mb', verify(req, _res, body) { if (req.path === '/api/qqbot/webhook') req.rawBody = Buffer.from(body); } }));
// 生产构建由后端托管；开发时 Vite 仍负责 5173 端口的热更新页面。
app.use(express.static(DIST_PATH));
app.use(express.static(PUBLIC_PATH));

if (migratedFiles.length > 0) {
    console.log(`📦 已迁移旧版运行时数据: ${migratedFiles.join(', ')}`);
}

app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_PATH, 'index.html'));
});

// --- 内存状态 ---
let napcatConnections = [];
let desktopPetVisible = true;
let desktopAwarenessState = { enabled: false, paused: false, status: 'disabled', detail: '' };
let desktopAwarenessEngine = null;
// 两个条件同时满足才认为 Electron 可用，防止普通 node 模式误发父进程消息。
const desktopPetAvailable = process.env.ELECTRON_DESKTOP_PET === '1' && hasParentIpc;

onParentMessage((message) => {
    // 此处只接收 Electron 主进程消息。NapCat 和浏览器 WebSocket 消息在文件末尾处理。
    if (message?.type === 'desktop-pet-state') {
        desktopPetVisible = Boolean(message.visible);
    }
    if (message?.type === 'desktop-awareness-state') {
        const previousStatus = desktopAwarenessState.status;
        desktopAwarenessState = { ...desktopAwarenessState, ...message.state };
        if (wssRef && message.state?.status !== previousStatus) {
            if (message.state?.status === 'permission-denied') {
                broadcastLog(wssRef, 'error', message.state.detail || '桌面感知缺少屏幕录制权限');
            } else if (message.state?.status === 'error') {
                broadcastLog(wssRef, 'error', `桌面感知暂停: ${message.state.detail || '未知错误'}`);
            }
        }
    }
    if (message?.type === 'set-desktop-awareness-enabled') {
        const config = configManager.getConfig();
        configManager.saveConfig({
            ...config,
            enableDesktopAwareness: Boolean(message.enabled),
        }).then(() => {
            syncDesktopAwarenessConfig();
            if (wssRef) {
                broadcastLog(wssRef, 'system', `桌面感知已${message.enabled ? '启用' : '停用'}`);
            }
        }).catch((error) => {
            console.error('更新桌面感知开关失败:', error.message);
        });
    }
    if (message?.type === 'set-desktop-capture-hide-pet') {
        const config = configManager.getConfig();
        configManager.saveConfig({
            ...config,
            desktopAwarenessHidePetFromCapture: Boolean(message.enabled),
        }).then(() => {
            syncDesktopAwarenessConfig();
            if (wssRef) {
                broadcastLog(wssRef, 'system', `截图桌宠保护已${message.enabled ? '启用' : '关闭'}`);
            }
        }).catch((error) => {
            console.error('更新截图桌宠保护失败:', error.message);
        });
    }
    if (message?.type === 'desktop-awareness-frame') {
        desktopAwarenessEngine?.handleFrame(message.frame);
    }
});

// --- 创建配置管理器 ---
const configManager = createConfigManager({ configFile: CONFIG_FILE });
const stickerStore = createStickerStore(path.join(runtimePaths.dataDir, 'stickers'));

// --- 创建记忆管理器 ---
const memory = createMemoryManager({ MEMORY_FILE, SUMMARY_FILE, PERSISTENT_FILE });

// --- 日志广播工具 ---
const broadcastLog = (wss, type, message) => {
    // 日志只发给已通过 iam_frontend 标记的客户端，避免把内部日志回送给 NapCat。
    const logPayload = JSON.stringify({
        type: 'log',
        level: type,
        content: message,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isFrontend) {
            client.send(logPayload);
        }
    });
};

const broadcastPetEvent = (wss, event, detail = {}) => {
    // 桌宠事件是语义事件（thinking/speaking 等），具体动作由 manifest 在 renderer 映射。
    const payload = JSON.stringify({ type: 'pet:event', event, detail });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isPet) client.send(payload);
    });
};

desktopAwarenessEngine = createDesktopAwarenessEngine({
    getConfig: () => configManager.getConfig(),
    emitPetEvent: (event, detail) => wssRef && broadcastPetEvent(wssRef, event, detail),
    broadcastLog: (type, message) => wssRef && broadcastLog(wssRef, type, message),
});

function syncDesktopAwarenessConfig() {
    // WebUI 配置由后端持久化，但 Electron observer 才能调用 desktopCapturer；
    // 因此只把操作系统采集所需字段同步回主进程，API Key 和人设保留在后端。
    if (!desktopPetAvailable) return;
    const config = configManager.getConfig();
    sendToParent({
        type: 'desktop-awareness-config',
        config: {
            enableDesktopAwareness: config.enableDesktopAwareness,
            desktopAwarenessInterval: config.desktopAwarenessInterval,
            desktopAwarenessChangeThreshold: config.desktopAwarenessChangeThreshold,
            desktopAwarenessExcludedTerms: config.desktopAwarenessExcludedTerms,
            desktopAwarenessHidePetFromCapture: config.desktopAwarenessHidePetFromCapture !== false,
        },
    });
}

// --- 创建消息处理器 ---
let wssRef = null; // 将在后面赋值
const conversationRuntime = createConversationRuntime();
const testConversation = createTestConversation({
    runtime: conversationRuntime,
    memory,
    getConfig: () => configManager.getConfig(),
});
function effectiveChatConfig() {
    const config = configManager.getConfig();
    if (config.qqProvider !== 'qqbot') return config;
    return { ...config, botQQ: officialIdentity(config, 'bot'), masterQQ: config.qqBotMasterId ? officialIdentity(config, config.qqBotMasterId) : '' };
}
const handleQQMessage = createMessageHandler({
    runtime: conversationRuntime,
    stickerStore,
    affect,
    // Official OpenIDs must never be compared to personal QQ account numbers.
    getConfig: effectiveChatConfig,
    memory,
    paths: { AVATAR_DIR },
    broadcastLog: (ws, type, msg) => wssRef && broadcastLog(wssRef, type, msg),
    get wss() { return wssRef; },
    emitPetEvent: (event, detail) => wssRef && broadcastPetEvent(wssRef, event, detail),
});

// --- 初始化系统 ---
let systemReady = false;
async function initSystem() {
    await configManager.loadConfig();
    await stickerStore.load();
    const oldConfig = configManager.getConfig();
    if (oldConfig.stickers?.length) {
        const failed = [];
        for (const item of oldConfig.stickers) {
            try { await stickerStore.add({ ...item, source: 'migration' }); }
            catch (error) { failed.push(item); console.error('旧表情迁移未完成:', error.message); }
        }
        await configManager.saveConfig({ ...oldConfig, stickers: failed });
    }
    await memory.loadAll();
    syncDesktopAwarenessConfig();
}
const initPromise = initSystem().then(() => { systemReady = true; });
// Keep the original promise rejected so consumers cannot mistake failed initialization for readiness.
initPromise.catch(error => console.error('系统初始化失败:', error.message));

// ==========================================
// 🔌 API 接口
// ==========================================

app.get('/api/status', (_req, res) => {
    const config = configManager.getConfig();
    const connections = napcatConnections.filter(connection => connection.readyState === WebSocket.OPEN).length;
    res.set('Cache-Control', 'no-store').json({
        ready: systemReady,
        qq: config.qqProvider === 'qqbot' ? officialBot.status() : { provider: config.qqProvider || 'napcat', connected: connections > 0, connections, state: connections ? 'connected' : onebotState },
        model: {
            configured: [config.apiEndpoint, config.apiKey, config.modelName]
                .every(value => typeof value === 'string' && value.trim().length > 0),
        },
        desktop: {
            available: desktopPetAvailable,
            visible: desktopPetAvailable && desktopPetVisible,
        },
        version: APP_VERSION,
    });
});

// 图片文件流服务 (EXE 模式适配)
app.get('/api/avatars/:filename', (req, res) => {
    const filePath = path.join(AVATAR_DIR, req.params.filename);
    if (fsSync.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Not found');
    }
});

// 看板娘列表
app.get('/api/avatars', async (req, res) => {
    try {
        const files = await fs.readdir(AVATAR_DIR);
        const imageFiles = files.filter(file => /\.(png|jpg|jpeg|webp)$/i.test(file));
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const avatarList = imageFiles.map(file => ({
            id: file,
            name: file.split('.')[0],
            fileName: file,
            preview: `${baseUrl}/api/avatars/${encodeURIComponent(file)}`
        }));
        res.json(avatarList);
    } catch (error) {
        console.error("读取头像列表失败:", error);
        res.json([]);
    }
});

// Separate media management: per-item mutations avoid overwriting concurrent group teaching.
app.get('/api/extensions/affect', (_req, res) => res.json(affect.status()));
app.delete('/api/extensions/affect', (_req, res) => { affect.clear(); res.json({ success: true }); });
app.get('/api/stickers', async (_req, res) => {
    try { await initPromise; res.json(stickerStore.list()); } catch (error) { sendManagementError(res, error); }
});
app.get('/api/stickers/:id/image', async (req, res) => {
    try { await initPromise; const image = await stickerStore.image(req.params.id); res.set('Cache-Control', 'no-store').type(image.mime).send(image.bytes); } catch { res.sendStatus(404); }
});
app.post('/api/stickers', async (req, res) => {
    try { await initPromise; const item = await stickerStore.add({ ...req.body, source: 'manual' }); res.json({ success: true, item }); } catch (error) { sendManagementError(res, error); }
});
app.patch('/api/stickers/:id', async (req, res) => {
    try { await initPromise; await stickerStore.update(req.params.id, req.body); res.json({ success: true }); } catch (error) { sendManagementError(res, error); }
});
app.delete('/api/stickers/:id', async (req, res) => {
    try { await initPromise; await stickerStore.remove(req.params.id); res.json({ success: true }); } catch (error) { sendManagementError(res, error); }
});
// 配置读取 (脱敏)
app.get('/api/config', (req, res) => {
    const config = configManager.getConfig();
    const safeConfig = { ...config };
    safeConfig.httpPort = String(API_PORT);
    safeConfig.wsUrl = `ws://${BIND_HOST}:${API_PORT}`;
    for (const field of ['onebotToken', 'snowlumaToken', 'qqBotSecret']) if (safeConfig[field]) safeConfig[field] = '***';
    if (safeConfig.apiKey) {
        safeConfig.apiKey = maskApiKey(safeConfig.apiKey);
    }
    res.json(safeConfig);
});

// 配置保存
app.post('/api/config', async (req, res) => {
    try {
        const incoming = req.body;
        await configManager.saveConfig(incoming);
        syncQQChannels();
        if (wssRef) broadcastLog(wssRef, 'system', '配置已更新');
        enhancedRestartProactiveTimer();
        syncDesktopAwarenessConfig();
        res.json({ success: true });
    } catch (error) {
        sendManagementError(res, error);
    }
});

// --- Electron 桌宠窗口 ---
app.get('/api/desktop-pet', (_req, res) => {
    res.json({
        available: desktopPetAvailable,
        visible: desktopPetAvailable ? desktopPetVisible : false,
    });
});

app.post('/api/desktop-pet', (req, res) => {
    if (!desktopPetAvailable) {
        return res.status(409).json({
            available: false,
            visible: false,
            error: '桌宠开关仅在 Electron 模式下可用',
        });
    }

    desktopPetVisible = Boolean(req.body?.visible);
    sendToParent({ type: 'set-desktop-pet-visible', visible: desktopPetVisible });
    res.json({ available: true, visible: desktopPetVisible });
});

app.get('/api/desktop-awareness', (_req, res) => {
    const settings = normalizeDesktopAwarenessConfig(configManager.getConfig());
    const engineState = desktopAwarenessEngine?.getState();
    const petConnected = Boolean(wssRef && [...wssRef.clients].some(client => client.isPet && client.readyState === WebSocket.OPEN));
    res.json({
        available: desktopPetAvailable,
        enabled: settings.enabled,
        paused: desktopAwarenessState.paused,
        status: desktopPetAvailable ? desktopAwarenessState.status : 'unavailable',
        detail: desktopAwarenessState.detail || '',
        processing: Boolean(engineState?.processing),
        lastResult: engineState?.lastResult?.status || 'idle',
        lastResultDiagnostics: engineState?.lastResult?.diagnostics || {},
        petConnected,
    });
});

app.get('/api/diagnostics', (_req, res) => {
    const engineState = desktopAwarenessEngine?.getState() || {};
    res.json(buildDiagnosticsReport({
        version: APP_VERSION,
        config: configManager.getConfig(),
        sessions: memory.getSessions(),
        summaries: memory.getSummaries(),
        persistentMemory: memory.getPersistentMemory(),
        desktopAwareness: desktopAwarenessState,
        desktopEngine: engineState,
        desktopPetAvailable,
        desktopPetVisible,
        runtimeMode: process.env.ELECTRON_DESKTOP_PET === '1'
            ? 'electron'
            : isPkg ? 'pkg' : 'source',
    }));
});

// --- 记忆 API ---
app.get('/api/memory/list', (req, res) => {
    const sessions = memory.getSessions();
    const list = Object.keys(sessions).map(key => ({
        id: key,
        count: sessions[key].length,
        lastUpdate: new Date().toLocaleTimeString(),
        preview: sessions[key].length > 0 ? sessions[key][sessions[key].length - 1].content.substring(0, 30) : "(空)"
    }));
    res.json(list);
});

app.get('/api/memory/:sessionId', (req, res) => {
    const sessions = memory.getSessions();
    res.json(sessions[req.params.sessionId] || []);
});

app.post('/api/memory/:sessionId', async (req, res) => {
    try {
        conversationRuntime.reset(req.params.sessionId);
        await conversationRuntime.enqueue(req.params.sessionId, async () => {
            memory.setSession(req.params.sessionId, req.body);
            await memory.saveMemoryToDisk();
        });
        if (wssRef) broadcastLog(wssRef, 'system', `✏️ 会话 [${req.params.sessionId}] 记忆已被手动修改`);
        res.json({ success: true });
    } catch (error) {
        sendManagementError(res, error);
    }
});

app.delete('/api/memory/:sessionId', async (req, res) => {
    conversationRuntime.reset(req.params.sessionId);
    const sessions = memory.getSessions();
    const summaries = memory.getSummaries();
    delete sessions[req.params.sessionId];
    delete summaries[req.params.sessionId];
    await memory.saveMemoryToDisk();
    await memory.saveSummariesToDisk();
    if (wssRef) broadcastLog(wssRef, 'system', `🗑️ 会话 [${req.params.sessionId}] 记忆已删除`);
    res.json({ success: true });
});

app.delete('/api/memory', async (req, res) => {
    conversationRuntime.reset();
    memory.setSessions({});
    memory.setSummaries({});
    await memory.saveMemoryToDisk();
    await memory.saveSummariesToDisk();
    if (wssRef) broadcastLog(wssRef, 'system', '🧹 全局记忆已重置');
    res.json({ success: true });
});

// --- 摘要 API ---
app.get('/api/summary/:sessionId', (req, res) => {
    const summaries = memory.getSummaries();
    res.json({ summary: summaries[req.params.sessionId] || '' });
});

app.post('/api/summary/:sessionId', async (req, res) => {
    try {
        conversationRuntime.reset(req.params.sessionId);
        memory.setSummary(req.params.sessionId, req.body?.summary ?? '');
        await memory.saveSummariesToDisk();
        if (wssRef) broadcastLog(wssRef, 'system', `📝 会话 [${req.params.sessionId}] 摘要已更新`);
        res.json({ success: true });
    } catch (error) {
        sendManagementError(res, error);
    }
});

// --- 持久化记忆 API ---
app.get('/api/persistent-memory', (req, res) => {
    res.json(memory.getPersistentMemory());
});

app.post('/api/persistent-memory', async (req, res) => {
    try {
        memory.setPersistentMemory(req.body);
        await memory.savePersistentMemoryToDisk();
        if (wssRef) broadcastLog(wssRef, 'system', '💾 持久化记忆已更新');
        res.json({ success: true });
    } catch (error) {
        sendManagementError(res, error);
    }
});

app.delete('/api/persistent-memory', async (req, res) => {
    memory.setPersistentMemory([]);
    await memory.savePersistentMemoryToDisk();
    if (wssRef) broadcastLog(wssRef, 'system', '🧹 持久化记忆已清空');
    res.json({ success: true });
});

// --- 测试对话 API ---
app.post('/api/test-chat', async (req, res) => {
    const { message } = req.body;
    if (!message || !configManager.getConfig().apiKey) {
        return res.status(400).json({ error: '缺少消息或 API Key' });
    }
    try {
        res.json(await testConversation.chat(req.body));
    } catch (error) {
        res.status(error.code === 'conversation-reset' ? 409 : 500).json({ error: error.message });
    }
});

app.delete('/api/test-chat/:scenario', async (req, res) => {
    try {
        await testConversation.reset(req.params.scenario);
        res.json({ success: true });
    } catch (error) {
        sendManagementError(res, error);
    }
});

// --- 测试生图 API ---
app.post('/api/test-image', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || !configManager.getConfig().apiKey) {
        return res.status(400).json({ error: '缺少提示词或 API Key' });
    }
    try {
        // 尝试读取底图
        let initImgBase64 = null;
        const config = configManager.getConfig();
        const fileName = config.currentPersonaFileName;
        if (fileName) {
            const imgPath = path.join(AVATAR_DIR, fileName);
            if (fsSync.existsSync(imgPath)) {
                const imgBuffer = await fs.readFile(imgPath);
                initImgBase64 = imgBuffer.toString('base64');
            }
        }
        const imgResult = await generateImage(config, prompt, initImgBase64);
        res.json({ success: true, type: imgResult.type, data: imgResult.data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Express 5 forwards rejected async handlers here. Keep management failures JSON
// shaped so the WebUI and integration tests never receive an HTML error page.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return sendManagementError(res, error);
});

// --- 启动服务器 ---
const server = app.listen(API_PORT, BIND_HOST, () => {
    console.log(`🤖 后端启动于: http://${BIND_HOST}:${API_PORT}`);
    if (isPkg) {
        console.log(`📦 EXE 模式运行中`);
    }
    console.log(`📂 运行时数据路径: ${runtimePaths.dataDir}`);
    initPromise.then(() => {
        console.log('✅ 配置与记忆初始化完成');
        sendToParent({ type: 'server-ready', port: API_PORT });
    }, () => {});
});

// --- WebSocket 服务 ---
const wss = new WebSocketServer({ server });
wssRef = wss;

const officialBot = createOfficialBot({ getConfig: () => configManager.getConfig() });
let onebotState = 'disconnected', channelSignature = '';
const snowlumaClient = createOneBotClient({
    attach: ws => attachOneBot(ws, 'snowluma'),
    onState: state => { onebotState = state; },
});
function activeProvider() { return configManager.getConfig().qqProvider || 'napcat'; }
function syncQQChannels() {
    const c = configManager.getConfig();
    const signature = JSON.stringify([activeProvider(), c.botQQ, c.onebotToken, c.snowlumaUrl, c.snowlumaToken, c.qqBotAppId, c.qqBotSecret, c.qqBotSandbox, c.qqBotMasterId]);
    if (signature === channelSignature) return;
    channelSignature = signature;
    snowlumaClient.stop(); officialBot.reset(); conversationRuntime.reset();
    for (const ws of napcatConnections) { qqTransport.disconnect(ws); ws.close(1000, 'Channel configuration changed'); }
    napcatConnections = []; onebotState = 'disconnected';
    if (activeProvider() === 'snowluma') {
        if (c.snowlumaUrl) snowlumaClient.start({ url: c.snowlumaUrl, token: c.snowlumaToken });
        else onebotState = 'unconfigured';
    }
}
function tokenMatches(actual, expected) {
    const a = Buffer.from(actual || ''), b = Buffer.from(expected || '');
    return a.length === b.length && timingSafeEqual(a, b);
}
function attachOneBot(ws, provider, request) {
    ws.on('close', () => {
        qqTransport.disconnect(ws);
        if (napcatConnections.includes(ws)) {
            napcatConnections = napcatConnections.filter(c => c !== ws);
            broadcastLog(wss, 'system', `${provider === 'snowluma' ? 'SnowLuma' : 'NapCat'} 已断开`);
        }
    });
    ws.on('error', () => { broadcastLog(wss, 'error', `${provider === 'snowluma' ? 'SnowLuma' : 'OneBot'} 连接异常，请检查地址和访问令牌`); });
    ws.on('message', async message => {
        try {
            const raw = message.toString();
            if (provider === 'napcat' && raw === 'iam_frontend' && !ws.selfId) { ws.isFrontend = true; return; }
            if (provider === 'napcat' && raw === 'iam_pet' && !ws.selfId) { ws.isPet = true; return; }
            if (ws.isFrontend || ws.isPet) return;
            await initPromise;
            if (ws.readyState !== WebSocket.OPEN || activeProvider() !== provider) return;
            const config = configManager.getConfig();
            if (provider === 'napcat' && config.onebotToken) {
                const bearer = request?.headers.authorization?.replace(/^Bearer /i, '');
                if (!tokenMatches(bearer, config.onebotToken)) { ws.close(1008, 'Invalid access token'); return; }
            }
            let event;
            try { event = JSON.parse(raw); } catch { return; }
            if (!event || typeof event !== 'object') return;
            if (qqTransport.handleResponse(ws, event)) return;
            if (provider === 'snowluma' && event.echo === 'hyacine:login' && event.status === 'ok' && Number(event.retcode) === 0) event = { post_type: 'meta_event', self_id: event.data?.user_id };
            if (!['message', 'message_sent', 'meta_event', 'notice', 'request'].includes(event.post_type)) return;
            const selfId = String(event.self_id || ws.selfId || config.botQQ || '');
            if (!/^\d+$/.test(selfId) || (config.botQQ && selfId !== String(config.botQQ)) || (ws.selfId && ws.selfId !== selfId)) return;
            ws.selfId = selfId;
            if ((event.notice_type === 'bot_status' && event.sub_type === 'offline') || event.notice_type === 'bot_offline' || (event.meta_event_type === 'heartbeat' && event.status?.online === false)) {
                napcatConnections = napcatConnections.filter(connection => connection !== ws);
                onebotState = 'account-offline';
                qqTransport.disconnect(ws);
                return;
            }
            if (!napcatConnections.includes(ws)) { napcatConnections.push(ws); broadcastLog(wss, 'system', `${provider === 'snowluma' ? 'SnowLuma' : 'NapCat'} 已连接`); }
            // Only the verified official webhook adapter may assign the official identity namespace.
            delete event.channel;
            if (event.post_type === 'message') await handleQQMessage(ws, event);
        } catch (error) { broadcastLog(wss, 'error', `QQ 消息处理失败: ${error.message}`); }
    });
}
wss.on('connection', (ws, request) => attachOneBot(ws, 'napcat', request));

app.post('/api/qqbot/webhook', async (req, res) => {
    try {
        await initPromise;
        const config = configManager.getConfig();
        if (activeProvider() !== 'qqbot' || !config.qqBotAppId || !config.qqBotSecret) return res.sendStatus(503);
        if (req.get('X-Bot-Appid') !== config.qqBotAppId) return res.sendStatus(401);
        if (req.body?.op === 13) {
            // Validation challenges are unsigned by the platform and do not establish event readiness.
            return res.json(challenge(config.qqBotSecret, req.body.d));
        }
        if (!verifyCallback(config.qqBotSecret, req.rawBody, req.get('X-Signature-Timestamp'), req.get('X-Signature-Ed25519'))) return res.sendStatus(401);
        const accepted = officialBot.accept(req.body);
        res.json({ op: 12 });
        if (accepted) void handleQQMessage(accepted.transport, accepted.event).catch(() => broadcastLog(wss, 'error', 'QQ 官方消息处理失败'));
    } catch { if (!res.headersSent) res.sendStatus(400); }
});
initPromise.then(syncQQChannels, () => {});

// --- 主动发言定时检查 (使用依赖注入) ---
const proactiveCheckDeps = () => ({
    config: configManager.getConfig(),
    getConfig: () => configManager.getConfig(),
    runtime: conversationRuntime,
    memory,
    napcatConnections,
    sessions: memory.getSessions(),
    sendToQQ,
    saveMemoryToDisk: () => memory.saveMemoryToDisk(),
    broadcastLog: (ws, type, msg) => broadcastLog(wss, type, msg),
    emitPetEvent: (event, detail) => broadcastPetEvent(wss, event, detail),
    wss,
});

function enhancedRestartProactiveTimer() {
    restartProactiveTimer(proactiveCheckDeps);
}

// 配置与历史读取完成后才启动，防止初始化期间使用默认配置
initPromise.then(() => enhancedRestartProactiveTimer(), () => {});

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`收到 ${signal}，正在关闭后端...`);
    stopProactiveTimer();
    snowlumaClient.stop(); officialBot.reset();
    conversationRuntime.reset();
    for (const connection of napcatConnections) qqTransport.disconnect(connection);
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
