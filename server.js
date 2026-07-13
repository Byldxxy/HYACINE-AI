// server.js - 入口文件 (模块化架构)
// 使用 CommonJS (require) 以确保 Windows pkg 打包稳定性
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const OpenAI = require('openai');

// --- 导入模块 ---
const { maskApiKey } = require('./lib/utils');
const { createConfigManager } = require('./lib/config');
const { createMemoryManager } = require('./lib/memory');
const { observeMessage, restartProactiveTimer } = require('./lib/proactive');
const { createMessageHandler, sendToQQ } = require('./lib/message-handler');
const { generateImage } = require('./lib/image-gen');
const { getRuntimePaths, prepareRuntimeData } = require('./lib/paths');

// ==========================================
// 🏗️ 核心：智能环境/路径适配 (防闪退关键)
// ==========================================
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
const ASSET_PATH = RUNTIME_PATH;
const migratedFiles = prepareRuntimeData(runtimePaths);

// ==========================================
// 🚀 初始化服务器
// ==========================================
const app = express();
const API_PORT = Number(process.env.API_PORT || process.env.PORT || 3001);
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

app.use(cors({
    origin(origin, callback) {
        if (!origin || LOCAL_ORIGIN_RE.test(origin)) return callback(null, true);
        return callback(new Error(`CORS origin not allowed: ${origin}`));
    }
}));
app.use(express.json());
app.use(express.static(path.join(ASSET_PATH, 'dist')));

if (migratedFiles.length > 0) {
    console.log(`📦 已迁移旧版运行时数据: ${migratedFiles.join(', ')}`);
}

app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(ASSET_PATH, 'dist', 'index.html'));
});

// --- 内存状态 ---
let napcatConnections = [];
let desktopPetVisible = true;
const desktopPetAvailable = process.env.ELECTRON_DESKTOP_PET === '1' && typeof process.send === 'function';

process.on('message', (message) => {
    if (message?.type === 'desktop-pet-state') {
        desktopPetVisible = Boolean(message.visible);
    }
});

// --- 创建配置管理器 ---
const configManager = createConfigManager({ configFile: CONFIG_FILE });

// --- 创建记忆管理器 ---
const memory = createMemoryManager({ MEMORY_FILE, SUMMARY_FILE, PERSISTENT_FILE });

// --- 日志广播工具 ---
const broadcastLog = (wss, type, message) => {
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

// --- 创建消息处理器 ---
let wssRef = null; // 将在后面赋值
const handleQQMessage = createMessageHandler({
    getConfig: () => configManager.getConfig(),
    memory,
    paths: { AVATAR_DIR },
    broadcastLog: (ws, type, msg) => wssRef && broadcastLog(wssRef, type, msg),
    get wss() { return wssRef; },
    observeMessage,
});

// --- 初始化系统 ---
async function initSystem() {
    await configManager.loadConfig();
    await memory.loadAll();
}
const initPromise = initSystem(); // 初始化完成后在 wss 就绪后手动启动主动发言

// ==========================================
// 🔌 API 接口
// ==========================================

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

// 配置读取 (脱敏)
app.get('/api/config', (req, res) => {
    const config = configManager.getConfig();
    const safeConfig = { ...config };
    safeConfig.httpPort = String(API_PORT);
    safeConfig.wsUrl = `ws://${BIND_HOST}:${API_PORT}`;
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
        if (wssRef) broadcastLog(wssRef, 'system', '配置已更新');
        enhancedRestartProactiveTimer();
        res.json({ success: true });
    } catch (_error) {
        res.status(500).json({ success: false });
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
    process.send({ type: 'set-desktop-pet-visible', visible: desktopPetVisible });
    res.json({ available: true, visible: desktopPetVisible });
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
    const sessions = memory.getSessions();
    sessions[req.params.sessionId] = req.body;
    await memory.saveMemoryToDisk();
    if (wssRef) broadcastLog(wssRef, 'system', `✏️ 会话 [${req.params.sessionId}] 记忆已被手动修改`);
    res.json({ success: true });
});

app.delete('/api/memory/:sessionId', async (req, res) => {
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
    const summaries = memory.getSummaries();
    summaries[req.params.sessionId] = req.body.summary || '';
    await memory.saveSummariesToDisk();
    if (wssRef) broadcastLog(wssRef, 'system', `📝 会话 [${req.params.sessionId}] 摘要已更新`);
    res.json({ success: true });
});

// --- 持久化记忆 API ---
app.get('/api/persistent-memory', (req, res) => {
    res.json(memory.getPersistentMemory());
});

app.post('/api/persistent-memory', async (req, res) => {
    memory.setPersistentMemory(req.body);
    await memory.savePersistentMemoryToDisk();
    if (wssRef) broadcastLog(wssRef, 'system', '💾 持久化记忆已更新');
    res.json({ success: true });
});

app.delete('/api/persistent-memory', async (req, res) => {
    memory.setPersistentMemory([]);
    await memory.savePersistentMemoryToDisk();
    if (wssRef) broadcastLog(wssRef, 'system', '🧹 持久化记忆已清空');
    res.json({ success: true });
});

// --- 测试对话 API ---
app.post('/api/test-chat', async (req, res) => {
    const { message, isMaster: testIsMaster, scenario } = req.body;
    if (!message || !configManager.getConfig().apiKey) {
        return res.status(400).json({ error: '缺少消息或 API Key' });
    }
    try {
        const config = configManager.getConfig();
        const openai = new OpenAI({
            baseURL: config.apiEndpoint || "https://api.openai.com/v1",
            apiKey: config.apiKey
        });

        let systemPrompt = config.systemPrompt || "你是一个助手。";
        const maxLen = config.maxReplyLength || 1000;
        systemPrompt += `\n[System Configuration]\n1. Length Constraint: STRICTLY UNDER ${maxLen} CHARACTERS.\n2. Style: Concise, oral.`;

        if (testIsMaster && config.masterPrompt) {
            systemPrompt += `\n${config.masterPrompt}`;
        } else if (!testIsMaster && config.strangerPrompt) {
            systemPrompt += `\n${config.strangerPrompt}`;
        }

        const sessions = memory.getSessions();
        const summaries = memory.getSummaries();
        const persistentMem = memory.getPersistentMemory();
        const testSessionId = `test_${scenario || 'default'}`;
        if (!sessions[testSessionId]) sessions[testSessionId] = [];

        const identityPrefix = testIsMaster
            ? `[发送者: 主人/Master (测试用户)] `
            : `[发送者: 测试用户(000000)] `;

        sessions[testSessionId].push({ role: "user", content: identityPrefix + message });

        const maxMem = config.shortMem || 10;
        if (sessions[testSessionId].length > maxMem * 2) {
            sessions[testSessionId] = sessions[testSessionId].slice(-(maxMem * 2));
        }

        const messagesToSend = [{ role: "system", content: systemPrompt }];
        if (summaries[testSessionId]) {
            messagesToSend.push({ role: "system", content: `[过去的对话摘要]\n${summaries[testSessionId]}` });
        }
        if (config.persistMem && persistentMem.length > 0) {
            const factList = persistentMem.map(p => `- ${p.fact}`).join('\n');
            messagesToSend.push({ role: "system", content: `[你长期记住的事实]\n${factList}` });
        }
        messagesToSend.push(...sessions[testSessionId]);

        const completion = await openai.chat.completions.create({
            model: config.modelName || "gpt-3.5-turbo",
            messages: messagesToSend,
            temperature: config.temperature || 0.7,
        });

        const aiReply = completion.choices[0]?.message?.content || "(AI 未返回内容)";
        sessions[testSessionId].push({ role: "assistant", content: aiReply });
        memory.saveMemoryToDisk();

        const imgCmdMatch = aiReply.match(/\[CMD:IMAGE_GEN\]\s*(.*)/);
        if (imgCmdMatch) {
            return res.json({ reply: aiReply, isImage: true, imagePrompt: imgCmdMatch[1] });
        }
        res.json({ reply: aiReply, isImage: false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/test-chat/:scenario', (req, res) => {
    const sessions = memory.getSessions();
    const summaries = memory.getSummaries();
    delete sessions[`test_${req.params.scenario}`];
    delete summaries[`test_${req.params.scenario}`];
    memory.saveMemoryToDisk();
    res.json({ success: true });
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

// --- 启动服务器 ---
const server = app.listen(API_PORT, BIND_HOST, () => {
    console.log(`🤖 后端启动于: http://${BIND_HOST}:${API_PORT}`);
    if (isPkg) {
        console.log(`📦 EXE 模式运行中`);
    }
    console.log(`📂 运行时数据路径: ${runtimePaths.dataDir}`);
});

// --- WebSocket 服务 ---
const wss = new WebSocketServer({ server });
wssRef = wss;

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        const msgStr = message.toString();
        if (msgStr === 'iam_frontend') {
            ws.isFrontend = true;
            return;
        }

        if (!ws.isFrontend && !napcatConnections.includes(ws)) {
            napcatConnections.push(ws);
            broadcastLog(wss, 'system', '🔗 NapCat 已连接');
            ws.on('close', () => {
                napcatConnections = napcatConnections.filter(c => c !== ws);
                broadcastLog(wss, 'system', '🔌 NapCat 已断开');
            });
        }

        let msgObj;
        try { msgObj = JSON.parse(msgStr); } catch (_e) { return; }

        if (msgObj.post_type === 'message') {
            await handleQQMessage(ws, msgObj);
        }
    });
});

// --- 主动发言定时检查 (使用依赖注入) ---
const proactiveCheckDeps = () => ({
    config: configManager.getConfig(),
    napcatConnections,
    sessions: memory.getSessions(),
    sendToQQ,
    saveMemoryToDisk: () => memory.saveMemoryToDisk(),
    broadcastLog: (ws, type, msg) => broadcastLog(wss, type, msg),
    wss,
});

function enhancedRestartProactiveTimer() {
    restartProactiveTimer(proactiveCheckDeps);
}

// 启动主动发言定时器 (在 wss 就绪后)
enhancedRestartProactiveTimer();
// 确保初始化完成后也启动一次
initPromise.then(() => enhancedRestartProactiveTimer());
