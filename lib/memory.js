// lib/memory.js - 记忆管理模块 (CRUD, 摘要, 持久化)

const fs = require('fs').promises;
const fsSync = require('fs');

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
    
    // 内存数据
    let sessions = {};
    let sessionSummaries = {};
    let persistentMemory = [];

    /**
     * 加载所有记忆数据
     */
    async function loadAll() {
        // 加载会话
        try {
            if (fsSync.existsSync(MEMORY_FILE)) {
                const memData = await fs.readFile(MEMORY_FILE, 'utf-8');
                sessions = JSON.parse(memData);
                console.log(`🧠 记忆已恢复: ${Object.keys(sessions).length} 个会话`);
            }
        } catch (_error) {
            sessions = {};
        }

        // 加载摘要
        try {
            if (fsSync.existsSync(SUMMARY_FILE)) {
                const sumData = await fs.readFile(SUMMARY_FILE, 'utf-8');
                sessionSummaries = JSON.parse(sumData);
                console.log(`📝 摘要已加载: ${Object.keys(sessionSummaries).length} 个`);
            }
        } catch (_error) {
            sessionSummaries = {};
        }

        // 加载持久化记忆
        try {
            if (fsSync.existsSync(PERSISTENT_FILE)) {
                const pData = await fs.readFile(PERSISTENT_FILE, 'utf-8');
                persistentMemory = JSON.parse(pData);
                console.log(`💾 持久化记忆已加载: ${persistentMemory.length} 条`);
            }
        } catch (_error) {
            persistentMemory = [];
        }
    }

    // --- 保存函数 ---
    async function saveMemoryToDisk() {
        try {
            await fs.writeFile(MEMORY_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
        } catch (e) {
            console.error("记忆保存失败", e);
        }
    }

    async function saveSummariesToDisk() {
        try {
            await fs.writeFile(SUMMARY_FILE, JSON.stringify(sessionSummaries, null, 2), 'utf-8');
        } catch (e) {
            console.error("摘要保存失败", e);
        }
    }

    async function savePersistentMemoryToDisk() {
        try {
            await fs.writeFile(PERSISTENT_FILE, JSON.stringify(persistentMemory, null, 2), 'utf-8');
        } catch (e) {
            console.error("持久化记忆保存失败", e);
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
    function setSessions(val) { sessions = val; }
    function getSummaries() { return sessionSummaries; }
    function setSummaries(val) { sessionSummaries = val; }
    function getPersistentMemory() { return persistentMemory; }
    function setPersistentMemory(val) { persistentMemory = val; }

    return {
        // 数据访问
        getSessions, setSessions,
        getSummaries, setSummaries,
        getPersistentMemory, setPersistentMemory,
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
