/**
 * 记忆管理模块（会话、摘要、持久化事实）。
 *
 * 三类数据刻意分文件保存：sessions 是可裁剪的近期逐字消息，summaries 是溢出消息的
 * 压缩结果，persistentMemory 是跨会话注入的长期事实。message-handler.js 决定何时裁剪
 * 和提取，本模块负责数据所有权、磁盘读写以及两种辅助 LLM 调用。
 */

const { atomicWriteJson, readJsonWithBackup } = require('./json-store');
const {
    parsePersistentMemory,
    parseSessionMessages,
    parseSessions,
    parseSummaries,
} = require('./schemas');

/**
 * 创建记忆管理器
 * @param {Object} paths - 文件路径配置
 * @param {string} paths.MEMORY_FILE - 会话记忆文件路径
 * @param {string} paths.SUMMARY_FILE - 摘要文件路径
 * @param {string} paths.PERSISTENT_FILE - 持久化记忆文件路径
 * @returns {Object} 记忆管理器实例
 */
function createMemoryManager(paths) {
    const { MEMORY_FILE, SUMMARY_FILE, PERSISTENT_FILE } = paths;
    
    // Getter 返回的是可变引用，消息处理器会原地 push/slice；修改后必须显式调用保存函数。
    let sessions = {};
    let sessionSummaries = {};
    let persistentMemory = [];

    /**
     * 加载所有记忆数据
     */
    async function loadAll() {
        // 每类文件独立容错，一个 JSON 损坏不会连带丢失其他两类记忆。
        [sessions, sessionSummaries, persistentMemory] = await Promise.all([
            readJsonWithBackup(MEMORY_FILE, {
                fallback: {}, validate: parseSessions, label: '会话记忆',
            }),
            readJsonWithBackup(SUMMARY_FILE, {
                fallback: {}, validate: parseSummaries, label: '会话摘要',
            }),
            readJsonWithBackup(PERSISTENT_FILE, {
                fallback: [], validate: parsePersistentMemory, label: '持久化记忆',
            }),
        ]);
        console.log(`🧠 记忆已恢复: ${Object.keys(sessions).length} 个会话`);
        console.log(`📝 摘要已加载: ${Object.keys(sessionSummaries).length} 个`);
        console.log(`💾 持久化记忆已加载: ${persistentMemory.length} 条`);
    }

    // --- 保存函数 ---
    async function saveMemoryToDisk() {
        try {
            await atomicWriteJson(MEMORY_FILE, parseSessions(sessions));
        } catch (e) {
            console.error("记忆保存失败", e);
            throw e;
        }
    }

    async function saveSummariesToDisk() {
        try {
            await atomicWriteJson(SUMMARY_FILE, parseSummaries(sessionSummaries));
        } catch (e) {
            console.error("摘要保存失败", e);
            throw e;
        }
    }

    async function savePersistentMemoryToDisk() {
        try {
            await atomicWriteJson(PERSISTENT_FILE, parsePersistentMemory(persistentMemory));
        } catch (e) {
            console.error("持久化记忆保存失败", e);
            throw e;
        }
    }

    /**
     * LLM 摘要压缩 - 将旧消息压缩为摘要
     * @param {Object} config - 全局配置
     * @param {Array} messages - 待压缩的消息数组
     * @returns {Promise<string>} 摘要文本
     */
    async function summarizeMessages(config, messages) {
        const OpenAI = require('openai');
        try {
            const openai = new OpenAI({
                baseURL: config.apiEndpoint || "https://api.openai.com/v1",
                apiKey: config.apiKey,
            });
            // 只压缩 message-handler 已判定溢出的旧窗口，最近对话仍以原文发送给主模型。
            const textDump = messages.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n');
            const completion = await openai.chat.completions.create({
                model: config.modelName || "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "你是一个记忆压缩器。请将以下对话记录压缩为一段简洁的摘要（不超过150字），保留关键事实、用户偏好、重要结论。直接输出摘要文本，不要加前缀。" },
                    { role: "user", content: textDump }
                ],
                temperature: 0.3,
            });
            return completion.choices[0]?.message?.content || "";
        } catch (e) {
            console.error("摘要生成失败:", e.message);
            return "";
        }
    }

    /**
     * 提取关键事实 - 从对话中提取持久化记忆
     * @param {Object} config - 全局配置
     * @param {Array} messages - 消息数组
     * @param {string} sessionId - 会话ID
     * @param {Function} broadcastLog - 日志广播函数
     * @param {Object} wss - WebSocket 服务器
     */
    async function extractFacts(config, messages, sessionId, broadcastLog, wss) {
        if (!config.persistMem) return;
        const OpenAI = require('openai');
        try {
            const openai = new OpenAI({
                baseURL: config.apiEndpoint || "https://api.openai.com/v1",
                apiKey: config.apiKey,
            });
            // 仅观察最近四条，避免每轮重复扫描整个历史；按事实文本做精确去重。
            const recentText = messages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
            const completion = await openai.chat.completions.create({
                model: config.modelName || "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "你是一个信息提取器。从最近的对话中提取值得长期记住的事实（如用户偏好、重要信息、关系状态等）。每条事实一行，用JSON数组格式输出。如果没有值得提取的信息，输出空数组 []。只输出JSON，不要解释。" },
                    { role: "user", content: recentText }
                ],
                temperature: 0.2,
            });
            const raw = completion.choices[0]?.message?.content || "[]";
            const facts = JSON.parse(raw);
            if (Array.isArray(facts) && facts.length > 0) {
                facts.forEach(fact => {
                    const exists = persistentMemory.some(p => p.fact === fact);
                    if (!exists) {
                        persistentMemory.push({ fact, source: sessionId, time: new Date().toISOString() });
                    }
                });
                await savePersistentMemoryToDisk();
                if (broadcastLog && wss) {
                    broadcastLog(wss, 'info', `💾 提取了 ${facts.length} 条持久化记忆`);
                }
            }
        } catch (e) {
            console.warn("持久化记忆提取失败(非致命):", e.message);
        }
    }

    // --- Getters/Setters ---
    function getSessions() { return sessions; }
    function setSessions(val) { sessions = parseSessions(val); }
    function getSummaries() { return sessionSummaries; }
    function setSummaries(val) { sessionSummaries = parseSummaries(val); }
    function getPersistentMemory() { return persistentMemory; }
    function setPersistentMemory(val) { persistentMemory = parsePersistentMemory(val); }
    function setSession(sessionId, value) {
        sessions[sessionId] = parseSessionMessages(value);
    }
    function setSummary(sessionId, value) {
        const parsed = parseSummaries({ [sessionId]: value });
        sessionSummaries[sessionId] = parsed[sessionId];
    }

    return {
        // 数据访问
        getSessions, setSessions,
        getSummaries, setSummaries,
        getPersistentMemory, setPersistentMemory,
        setSession, setSummary,
        // 持久化
        loadAll,
        saveMemoryToDisk,
        saveSummariesToDisk,
        savePersistentMemoryToDisk,
        // LLM 功能
        summarizeMessages,
        extractFacts,
    };
}

module.exports = { createMemoryManager };
