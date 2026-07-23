/**
 * OneBot/QQ 消息处理主流水线。
 *
 * 数据流：NapCat 消息 -> 触发判断 -> 文本/图片标准化 -> 同会话串行队列 -> 记忆裁剪
 * -> 组装人设与身份上下文 -> 调用文本模型 -> 普通回复或生图分支 -> OneBot 发送。
 *
 * 该模块使用依赖注入而不是直接引用 server.js 的全局对象，便于测试并避免循环依赖。
 * 修改时尤其要维护两个约束：同一 session 的消息必须按到达顺序处理；图片二进制只进入
 * 当前模型请求，不写入会话 JSON，历史中只保存“附带图片”的文字标记。
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { smartSplit } = require('./utils');
const { generateImage, selectImageGenerationPrompt } = require('./image-gen');
const { extractImageSources, prepareVisionImages, stripImageSegments } = require('./vision');
const {
    buildConversationMessages,
    buildConversationSystemPrompt,
    requestChatCompletion,
} = require('./chat-completion');

/**
 * 创建消息处理器
 * @param {Object} deps - 依赖注入
 * @param {Object} deps.getConfig - 获取配置的函数
 * @param {Object} deps.memory - 记忆管理器
 * @param {Object} deps.paths - 路径配置
 * @param {Function} deps.broadcastLog - 日志广播函数
 * @param {Object} deps.wss - WebSocket 服务器
 * @returns {Function} handleQQMessage 函数
 */
function createMessageHandler(deps) {
    const { getConfig, memory, paths, broadcastLog, wss } = deps;
    const { AVATAR_DIR } = paths;

    // --- 并发控制: Promise 队列 ---
    // 群里连续 @ 或私聊连发时，模型请求完成顺序可能与消息顺序不同。每个 sessionId
    // 拥有独立 Promise 链：同一会话串行，不同群/私聊仍可并行。
    const sessionQueues = new Map();

    /**
     * 将消息处理排队，确保同一 sessionId 的请求串行执行
     * @param {string} sessionId - 会话标识
     * @param {Function} fn - 异步处理函数
     * @returns {Promise} 处理结果
     */
    function enqueueSession(sessionId, fn) {
        const prev = sessionQueues.get(sessionId) || Promise.resolve();
        const next = prev.then(fn, fn); // 即使上一个失败也继续
        const guarded = next.catch(() => {});
        sessionQueues.set(sessionId, guarded); // 吞掉队列中的错误，防止 unhandled rejection
        guarded.finally(() => {
            if (sessionQueues.get(sessionId) === guarded) {
                sessionQueues.delete(sessionId);
            }
        });
        return next;
    }

    /**
     * 处理 QQ 消息 (核心入口)
     * @param {Object} ws - NapCat WebSocket 连接
     * @param {Object} msgObj - OneBot v11 消息对象
     */
    async function handleQQMessage(ws, msgObj) {
        const config = getConfig();
        const rawMsg = msgObj.raw_message || "";
        const senderId = msgObj.user_id;
        const groupId = msgObj.group_id;
        const msgType = msgObj.message_type;
        const imageSources = extractImageSources(msgObj);

        // 1. 触发判断。群聊默认只响应 @、句首关键词或 alwaysReply；私聊直接进入流程。
        const isAtMe = rawMsg.includes(`[CQ:at,qq=${config.botQQ}]`);
        const keywords = config.customKeywords || [];
        const isKeywordTrigger = keywords.some(kw => rawMsg.trim().startsWith(kw));

        // 主动发言观察与即时回复解耦：即使本条消息不触发机器人，也可进入群聊观察缓冲。
        if (msgType === 'group' && config.enableProactive && deps.observeMessage) {
            const senderName = msgObj.sender?.nickname || "未知群友";
            const cleanObs = stripImageSegments(rawMsg.replace(/\[CQ:at,qq=\d+\]/g, '')).trim();
            if (cleanObs) {
                deps.observeMessage(`group_${groupId}`, senderName, cleanObs);
            }
        }

        if (msgType === 'group' && !config.alwaysReply && !isAtMe && !isKeywordTrigger) return;

        broadcastLog(wss, 'in', `[QQ:${senderId}] ${rawMsg}`);

        if (!config.apiKey) {
            broadcastLog(wss, 'error', "未配置 API Key");
            deps.emitPetEvent?.('error');
            return;
        }
        deps.emitPetEvent?.('attention');

        // 2. 消息清洗。只有图片没有文字时补一个自然语言任务，确保多模态请求仍有意图。
        let cleanText = stripImageSegments(rawMsg.replace(/\[CQ:at,qq=\d+\]/g, '')).trim();
        if (!cleanText && imageSources.length > 0) {
            cleanText = '请理解图片内容并自然回应。';
        }
        if (!cleanText) return;

        // 计算 sessionId 用于队列
        const sessionId = groupId ? `group_${groupId}` : `user_${senderId}`;

        // 并发控制: 同一会话的请求排队执行
        return enqueueSession(sessionId, () => _processMessage(ws, msgObj, cleanText, sessionId, imageSources));
    }

    /**
     * 实际的消息处理逻辑 (在队列中串行执行)
     */
    async function _processMessage(ws, msgObj, cleanText, sessionId, imageSources) {
        const config = getConfig();
        const sessions = memory.getSessions();
        const sessionSummaries = memory.getSummaries();
        const persistentMemory = memory.getPersistentMemory();

        const rawMsg = msgObj.raw_message || "";
        const senderId = msgObj.user_id;
        const groupId = msgObj.group_id;
        const msgType = msgObj.message_type;
        const isAtMe = rawMsg.includes(`[CQ:at,qq=${config.botQQ}]`);
        const isMaster = String(senderId) === String(config.masterQQ);

        // 2.5 管理员指令。群聊清除记忆只允许主人，私聊则只影响发送者自己的 session。
        const isCmd = cleanText === '/reset' || cleanText === '/clear' || cleanText === '重置记忆' || cleanText === '忘记一切';

        if (isCmd) {
            const isAuthorized = isMaster || !groupId;
            if (isAuthorized) {
                sessions[sessionId] = [];
                delete sessionSummaries[sessionId];
                await Promise.all([
                    memory.saveMemoryToDisk(),
                    memory.saveSummariesToDisk(),
                ]);
                broadcastLog(wss, 'system', `🧹 会话 [${sessionId}] 记忆已被指令清除`);
                sendToQQ(ws, "🗑️ 记忆已清空，我们可以重新开始了。", msgType, senderId, groupId, false);
                return;
            }
        }

        // 3. 构建上下文
        if (!sessions[sessionId]) sessions[sessionId] = [];

        const isMsgSenderMaster = String(senderId) === String(config.masterQQ);
        const senderName = msgObj.sender?.nickname || "未知群友";

        // 会话历史只记录图片数量，不保存 URL/data URL，避免临时链接、base64 和隐私内容落盘。
        const imageNote = imageSources.length > 0 ? ` [附带 ${imageSources.length} 张图片]` : '';
        let contentWithIdentity = cleanText + imageNote;
        if (groupId) {
            if (isMsgSenderMaster) {
                contentWithIdentity = `[发送者: 主人/Master (${senderName})] ${cleanText}${imageNote}`;
            } else {
                contentWithIdentity = `[发送者: ${senderName}(${senderId})] ${cleanText}${imageNote}`;
            }
        }

        sessions[sessionId].push({ role: "user", content: contentWithIdentity });

        // --- 智能上下文管理: 短期记忆 + 长期摘要 ---
        // shortMem 以“轮”为单位，因此窗口按 user/assistant 两条一轮换算；longMem 控制
        // 原文保留比例，溢出部分先摘要再裁剪，摘要失败时仍保留最近窗口保证可继续对话。
        const maxMem = config.shortMem || 10;
        const maxWindow = maxMem * 2;
        const longMemRatio = Math.max(0, Math.min(1, Number(config.longMem || 0)));
        const retainWindow = longMemRatio > 0
            ? Math.max(4, Math.floor(maxWindow * longMemRatio))
            : maxWindow;

        if (sessions[sessionId].length > retainWindow) {
            const overflow = sessions[sessionId].slice(0, sessions[sessionId].length - retainWindow);
            if (longMemRatio > 0 && overflow.length >= 4) {
                broadcastLog(wss, 'info', `📝 触发长期记忆摘要 (${overflow.length} 条旧消息)...`);
                const summary = await memory.summarizeMessages(config, overflow);
                if (summary) {
                    sessionSummaries[sessionId] = sessionSummaries[sessionId]
                        ? sessionSummaries[sessionId] + '\n' + summary
                        : summary;
                    await memory.saveSummariesToDisk();
                    broadcastLog(wss, 'info', `📝 摘要已更新`);
                }
                sessions[sessionId] = sessions[sessionId].slice(-retainWindow);
            }
        }

        if (sessions[sessionId].length > maxWindow) {
            sessions[sessionId] = sessions[sessionId].slice(-maxWindow);
        }

        await memory.saveMemoryToDisk();

        // 聊天图片在进入主模型前才下载，且只挂载到当前 user message。
        let visionImages = [];
        if (imageSources.length > 0) {
            broadcastLog(wss, 'info', `🖼️ 正在读取 ${imageSources.length} 张图片...`);
            const prepared = await prepareVisionImages(imageSources);
            visionImages = prepared.images;

            if (prepared.errors.length > 0) {
                broadcastLog(wss, 'error', `图片读取失败: ${prepared.errors.join('；')}`);
            }
            if (visionImages.length === 0) {
                sessions[sessionId].pop();
                await memory.saveMemoryToDisk();
                sendToQQ(ws, '图片读取失败，请重新发送图片后再试。', msgType, senderId, groupId, isAtMe);
                return;
            }
            broadcastLog(wss, 'info', `🖼️ 已加载 ${visionImages.length} 张图片，交给模型理解...`);
        }

        const maxLen = config.maxReplyLength || 1000;
        const finalSystemPrompt = buildConversationSystemPrompt(config, {
            senderId,
            groupId,
            isMaster,
        });

        try {
            broadcastLog(wss, 'info', `思考中 (Len: ${maxLen})...`);
            deps.emitPetEvent?.('thinking');

            const messagesToSend = buildConversationMessages({
                systemPrompt: finalSystemPrompt,
                summary: sessionSummaries[sessionId],
                persistentMemory,
                includePersistentMemory: config.persistMem,
                sessionMessages: sessions[sessionId],
                currentVisionImages: visionImages,
                groupId,
            });
            const completion = await requestChatCompletion(config, messagesToSend);

            const aiReply = completion.choices[0].message.content || "";

            if (!aiReply || aiReply.trim() === "") {
                broadcastLog(wss, 'error', "AI 返回了空内容，已跳过处理。");
                return;
            }

            // --- 生图指令拦截 ---
            // 文本模型负责判断意图；仅在开启优化时使用其场景描述。真正的图片请求由 image-gen.js 完成。
            // 本地角色图始终作为身份基底，当前聊天图片作为次级视觉参考。
            const imgCmdMatch = aiReply.match(/\[CMD:IMAGE_GEN\]\s*(.*)/);

            if (imgCmdMatch) {
                const modelSceneDescription = imgCmdMatch[1] || '';
                const finalPrompt = selectImageGenerationPrompt(
                    config,
                    cleanText,
                    modelSceneDescription
                );
                const promptSource = config.optimizeImgPrompt === true ? '模型优化' : '用户原文';
                broadcastLog(wss, 'info', `📸 触发生图 [${promptSource}]: ${finalPrompt}`);
                deps.emitPetEvent?.('imageGenerating');
                sendToQQ(ws, "正在找角度拍照捏... 📸", msgType, senderId, groupId, false);

                let initImgBase64 = null;
                try {
                    const fileName = config.currentPersonaFileName;
                    if (fileName) {
                        const imgPath = path.join(AVATAR_DIR, fileName);
                        if (fsSync.existsSync(imgPath)) {
                            const imgBuffer = await fs.readFile(imgPath);
                            initImgBase64 = imgBuffer.toString('base64');
                            broadcastLog(wss, 'info', `🖼️ 读取到底图: ${fileName}`);
                        }
                    }
                } catch (e) {
                    console.warn("读取底图出错:", e);
                }

                try {
                    if (visionImages.length > 0) {
                        broadcastLog(wss, 'info', `🖼️ 生图已挂载 ${visionImages.length} 张聊天参考图`);
                    }
                    const imgResult = await generateImage(
                        config,
                        finalPrompt,
                        initImgBase64,
                        visionImages
                    );
                    let cqCode = "";
                    if (imgResult.type === 'url') {
                        cqCode = `[CQ:image,file=${imgResult.data},cache=0]`;
                    } else {
                        cqCode = `[CQ:image,file=base64://${imgResult.data}]`;
                    }
                    sendToQQ(ws, cqCode, msgType, senderId, groupId, false);
                    broadcastLog(wss, 'out', `[照片已发送] URL: ${imgResult.data.substring(0, 30)}...`);
                } catch (e) {
                    sendToQQ(ws, `画不出来了... 原因：${e.message}`, msgType, senderId, groupId, false);
                    broadcastLog(wss, 'error', `生图失败: ${e.message}`);
                }

                // 关闭优化时不把模型擅自改写的英文指令写入历史；用户原始请求已经在上一条。
                const historyEntry = config.optimizeImgPrompt === true
                    ? aiReply
                    : '[已按上一条用户原始要求生成图片]';
                sessions[sessionId].push({ role: "assistant", content: historyEntry });
                await memory.saveMemoryToDisk();
                broadcastLog(wss, 'out', `[指令拦截] 提示词来源=${promptSource}，原文本不发送。`);
                return;
            }

            sessions[sessionId].push({ role: "assistant", content: aiReply });
            await memory.saveMemoryToDisk();

            // 异步提取持久化记忆 (不阻塞主流程)
            memory.extractFacts(config, sessions[sessionId], sessionId, broadcastLog, wss).catch(() => {});

            broadcastLog(wss, 'out', `[AI原始] ${aiReply}`);
            deps.emitPetEvent?.('speaking', {
                duration: Math.max(1.2, Math.min(6, aiReply.length * 0.08)),
            });

            // --- 拟人化分段发送 ---
            if (config.enableSplit) {
                const finalSegments = smartSplit(aiReply);
                let accumulatedDelay = 0;
                finalSegments.forEach((seg, index) => {
                    const typeTime = 500 + (seg.length * 100);
                    accumulatedDelay += typeTime;
                    setTimeout(() => {
                        sendToQQ(ws, seg, msgType, senderId, groupId, index === 0 && isAtMe);
                        broadcastLog(wss, 'out', `[分段${index+1}] ${seg}`);
                    }, accumulatedDelay);
                });
            } else {
                sendToQQ(ws, aiReply, msgType, senderId, groupId, isAtMe);
            }

        } catch (error) {
            broadcastLog(wss, 'error', `API 错误: ${error.message}`);
            deps.emitPetEvent?.('error');
            sessions[sessionId].pop();
            await memory.saveMemoryToDisk().catch(saveError => {
                broadcastLog(wss, 'error', `回滚会话保存失败: ${saveError.message}`);
            });
        }
    }

    return handleQQMessage;
}

/**
 * 统一发送 QQ 消息
 */
function sendToQQ(ws, message, msgType, senderId, groupId, shouldAt) {
    if (!message) return;
    const replyPayload = {
        action: "send_msg",
        params: {
            message_type: msgType,
            user_id: senderId,
            group_id: groupId,
            message: (msgType === 'group' && shouldAt) ? `[CQ:at,qq=${senderId}] ${message}` : message
        }
    };
    ws.send(JSON.stringify(replyPayload));
}

module.exports = { createMessageHandler, sendToQQ };
