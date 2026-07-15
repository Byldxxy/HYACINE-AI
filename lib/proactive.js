// lib/proactive.js - 主动发言引擎模块

let recentObservations = {};  // { groupId: [{sender, text, time}] }
let proactiveTimer = null;
let lastProactiveTime = {};   // { groupId: timestamp }
const MAX_OBSERVATION_BUFFER = 100;

function clamp01(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
}

function getContextSize(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 30;
    return Math.max(3, Math.min(50, Math.round(num)));
}

function selectObservationContext(observations, configuredSize) {
    if (!Array.isArray(observations)) return [];
    return observations.slice(-getContextSize(configuredSize));
}

function parseDecision(content, fallbackThreshold) {
    const raw = (content || '').trim();
    if (!raw || raw.includes('[NO_ACTION]')) return { score: 0, reply: '' };

    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
        return {
            score: clamp01(parsed.score, 0),
            reply: String(parsed.reply || '').trim()
        };
    } catch {
        return { score: fallbackThreshold, reply: raw };
    }
}

/**
 * 观察消息 (收集但不回复)
 * @param {string} groupId - 群组标识
 * @param {string} senderName - 发送者名称
 * @param {string} text - 消息文本
 */
function observeMessage(groupId, senderName, text) {
    if (!groupId) return;
    if (!recentObservations[groupId]) recentObservations[groupId] = [];
    recentObservations[groupId].push({
        sender: senderName,
        text: text.substring(0, 100),
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
    });
    // 缓存略大于可配置窗口，调整条目数后无需重新积累。
    if (recentObservations[groupId].length > MAX_OBSERVATION_BUFFER) {
        recentObservations[groupId] = recentObservations[groupId].slice(-MAX_OBSERVATION_BUFFER);
    }
}

/**
 * 主动发言检查 - 判断是否应该主动发言
 * @param {Object} deps - 依赖对象
 * @param {Object} deps.config - 全局配置
 * @param {Array} deps.napcatConnections - NapCat WebSocket 连接数组
 * @param {Object} deps.sessions - 会话存储
 * @param {Function} deps.sendToQQ - 发送QQ消息函数
 * @param {Function} deps.saveMemoryToDisk - 保存记忆函数
 * @param {Function} deps.broadcastLog - 广播日志函数
 * @param {Object} deps.wss - WebSocket 服务器实例
 */
async function proactiveCheck(deps) {
    const { config, napcatConnections, sessions, sendToQQ, saveMemoryToDisk, broadcastLog, wss } = deps;
    
    if (!config.enableProactive) return;
    if (napcatConnections.length === 0) return;
    if (!config.apiKey) return;

    const OpenAI = require('openai');
    const targetGroups = config.proactiveTargetGroups || [];
    const cooldown = (config.proactiveCooldown || 600) * 1000;
    const threshold = clamp01(config.proactiveThreshold, 0.6);
    const ws = napcatConnections[0];

    for (const groupId of Object.keys(recentObservations)) {
        const plainGroupId = groupId.replace(/^group_/, '');
        if (targetGroups.length > 0 && !targetGroups.includes(groupId) && !targetGroups.includes(plainGroupId)) continue;

        const obs = selectObservationContext(
            recentObservations[groupId],
            config.proactiveContextSize
        );
        if (!obs || obs.length < 3) continue;

        const lastTime = lastProactiveTime[groupId] || 0;
        if (Date.now() - lastTime < cooldown) continue;

        try {
            const openai = new OpenAI({
                baseURL: config.apiEndpoint || "https://api.openai.com/v1",
                apiKey: config.apiKey,
            });

            const chatContext = obs.map(o => `[${o.time}] ${o.sender}: ${o.text}`).join('\n');
            const completion = await openai.chat.completions.create({
                model: config.modelName || "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: `${config.systemPrompt || '你是一个群聊 AI 助手。'}\n\n你正在观察群聊。请根据最近的消息和已配置的人设，判断是否有适合主动回复的内容。\n\n适合插话的场景：有趣的话题、有人需要帮助、自然的回应或参与讨论。\n\n请只输出 JSON，不要解释：\n{"score":0到1之间的数字,"reply":"想说的话"}\n如果不该说话，输出 {"score":0,"reply":""}。\nreply 必须自然接话，不超过30字。`
                    },
                    { role: "user", content: `最近的群聊消息:\n${chatContext}` }
                ],
                temperature: config.temperature || 0.7,
            });

            const response = completion.choices[0]?.message?.content || "";
            const decision = parseDecision(response, threshold);

            if (decision.score >= threshold && decision.reply.length > 0) {
                const reply = decision.reply.slice(0, 120);
                sendToQQ(ws, reply, 'group', null, parseInt(plainGroupId, 10), false);
                lastProactiveTime[groupId] = Date.now();
                broadcastLog(wss, 'out', `[主动发言 ${decision.score.toFixed(2)}] ${reply}`);
                deps.emitPetEvent?.('proactive', {
                    duration: Math.max(1.2, Math.min(5, reply.length * 0.08)),
                });

                const sessionId = groupId;
                if (!sessions[sessionId]) sessions[sessionId] = [];
                sessions[sessionId].push({ role: "assistant", content: reply });
                saveMemoryToDisk();

                recentObservations[groupId] = [];
            }
        } catch (e) {
            console.warn("主动发言检查失败:", e.message);
        }
    }
}

/**
 * 启动/重启主动发言定时器
 * @param {Object} config - 全局配置
 */
function restartProactiveTimer(config) {
    if (proactiveTimer) clearInterval(proactiveTimer);
    const getDeps = typeof config === 'function' ? config : () => ({ config });
    const deps = getDeps();
    if (deps.config.enableProactive) {
        const interval = (deps.config.proactiveInterval || 300) * 1000;
        proactiveTimer = setInterval(() => proactiveCheck(getDeps()), interval);
        console.log(`🤖 主动发言已启动, 间隔: ${deps.config.proactiveInterval || 300}秒`);
    } else {
        console.log('🤖 主动发言已关闭');
    }
}

/**
 * 获取主动发言引擎的状态 (用于外部调用 proactiveCheck)
 */
function getProactiveState() {
    return { recentObservations, lastProactiveTime };
}

module.exports = {
    observeMessage,
    proactiveCheck,
    restartProactiveTimer,
    getProactiveState,
    selectObservationContext,
};
