// lib/message-handler.js - 消息处理核心逻辑

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const OpenAI = require('openai');
const { smartSplit } = require('./utils');
const { generateImage } = require('./image-gen');

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

        // 1. 触发判断
        const isAtMe = rawMsg.includes(`[CQ:at,qq=${config.botQQ}]`);
        const keywords = config.customKeywords || [];
        const isKeywordTrigger = keywords.some(kw => rawMsg.trim().startsWith(kw));

        // 主动发言观察 (由外部注入 observeMessage)
        if (msgType === 'group' && config.enableProactive && deps.observeMessage) {
            const senderName = msgObj.sender?.nickname || "未知群友";
            const cleanObs = rawMsg.replace(/\[CQ:at,qq=\d+\]/g, '').trim();
            if (cleanObs) {
                deps.observeMessage(`group_${groupId}`, senderName, cleanObs);
            }
        }

        if (msgType === 'group' && !config.alwaysReply && !isAtMe && !isKeywordTrigger) return;

        broadcastLog(wss, 'in', `[QQ:${senderId}] ${rawMsg}`);

        if (!config.apiKey) {
            broadcastLog(wss, 'error', "未配置 API Key");
            return;
        }

        // 2. 消息清洗
        let cleanText = rawMsg.replace(/\[CQ:at,qq=\d+\]/g, '').trim();
        if (!cleanText) return;

        // 计算 sessionId 用于队列
        const sessionId = groupId ? `group_${groupId}` : `user_${senderId}`;

        // 并发控制: 同一会话的请求排队执行
        return enqueueSession(sessionId, () => _processMessage(ws, msgObj, cleanText, sessionId));
    }

    /**
     * 实际的消息处理逻辑 (在队列中串行执行)
     */
    async function _processMessage(ws, msgObj, cleanText, sessionId) {
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

        // 2.5 管理员指令
        const isCmd = cleanText === '/reset' || cleanText === '/clear' || cleanText === '重置记忆' || cleanText === '忘记一切';

        if (isCmd) {
            const isAuthorized = isMaster || !groupId;
            if (isAuthorized) {
                sessions[sessionId] = [];
                delete sessionSummaries[sessionId];
                memory.saveMemoryToDisk();
                memory.saveSummariesToDisk();
                broadcastLog(wss, 'system', `🧹 会话 [${sessionId}] 记忆已被指令清除`);
                sendToQQ(ws, "🗑️ 记忆已清空，我们可以重新开始了。", msgType, senderId, groupId, false);
                return;
            }
        }

        // 3. 构建上下文
        if (!sessions[sessionId]) sessions[sessionId] = [];

        const isMsgSenderMaster = String(senderId) === String(config.masterQQ);
        const senderName = msgObj.sender?.nickname || "未知群友";

        let contentWithIdentity = cleanText;
        if (groupId) {
            if (isMsgSenderMaster) {
                contentWithIdentity = `[发送者: 主人/Master (${senderName})] ${cleanText}`;
            } else {
                contentWithIdentity = `[发送者: ${senderName}(${senderId})] ${cleanText}`;
            }
        }

        sessions[sessionId].push({ role: "user", content: contentWithIdentity });

        // --- 智能上下文管理: 短期记忆 + 长期摘要 ---
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

        memory.saveMemoryToDisk();

        // ============================================================
        // 🚀 直连生图拦截器
        // ============================================================
        const isDirectGen = (config.optimizeImgPrompt === false) &&
                            (cleanText.startsWith('/img') || cleanText.startsWith('/draw'));

        if (isDirectGen) {
            broadcastLog(wss, 'info', `🚀 检测到直连指令，跳过 LLM...`);
            let rawPrompt = cleanText.replace(/^\/img|^\/draw/i, '').trim();

            if (!rawPrompt) {
                sendToQQ(ws, "⚠️ 请在指令后面跟上提示词", msgType, senderId, groupId, false);
                return;
            }

            sendToQQ(ws, "收到复杂指令，正在直连绘图引擎... 🎨", msgType, senderId, groupId, false);

            let initImgBase64 = null;
            try {
                const fileName = config.currentPersonaFileName;
                if (fileName) {
                    const imgPath = path.join(AVATAR_DIR, fileName);
                    if (fsSync.existsSync(imgPath)) {
                        const imgBuffer = await fs.readFile(imgPath);
                        initImgBase64 = imgBuffer.toString('base64');
                        broadcastLog(wss, 'info', `🖼️ 挂载底图: ${fileName}`);
                    }
                }
            } catch (_e) { console.warn("直连模式：底图读取失败或未配置"); }

            try {
                const imgResult = await generateImage(config, rawPrompt, initImgBase64);
                let cqCode = "";
                if (imgResult.type === 'url') {
                    cqCode = `[CQ:image,file=${imgResult.data},cache=0]`;
                } else {
                    cqCode = `[CQ:image,file=base64://${imgResult.data}]`;
                }
                sendToQQ(ws, cqCode, msgType, senderId, groupId, false);
                broadcastLog(wss, 'out', `[直连生图成功]`);
                sessions[sessionId].push({ role: "assistant", content: "[发送了一张图片]" });
                memory.saveMemoryToDisk();
            } catch (e) {
                sendToQQ(ws, `直连生图失败: ${e.message}`, msgType, senderId, groupId, false);
                broadcastLog(wss, 'error', `直连错误: ${e.message}`);
            }
            return;
        }

        // 4. 构建 Prompt
        let finalSystemPrompt = config.systemPrompt || "你是一个助手。";

        const processTemplate = (template) => {
            if (!template) return "";
            return template.replace(/\$\{senderId\}/g, senderId).replace(/\$\{groupId\}/g, groupId || "私聊");
        };

        if (isMaster) {
            const defaultMaster = "【系统】检测到主人(ID: ${senderId})。";
            const masterTpl = config.masterPrompt !== undefined ? config.masterPrompt : defaultMaster;
            if (masterTpl) finalSystemPrompt += `\n${processTemplate(masterTpl)}`;
        } else {
            const defaultStranger = "【系统】检测到普通用户(ID: ${senderId})。";
            const strangerTpl = config.strangerPrompt !== undefined ? config.strangerPrompt : defaultStranger;
            if (strangerTpl) finalSystemPrompt += `\n${processTemplate(strangerTpl)}`;
        }

        if (groupId) {
            const groupTpl = config.groupPrompt || "【环境】当前是群聊(${groupId})。";
            finalSystemPrompt += `\n${processTemplate(groupTpl)}`;
        }

        const shouldOptimize = config.optimizeImgPrompt !== false;
        let imgGenInstruction = "";
        if (shouldOptimize) {
            imgGenInstruction = `
        1. **Translate & Refine**: You MUST translate the user's request into a detailed **English scene description** (keywords/tags).
        2. **Structure**: Action, Background, Lighting, Composition.
        3. Example: User says "在海边吃瓜", you output: [CMD:IMAGE_GEN] eating watermelon, beach background, sunny day, upper body
        
        关键约束 (CRITICAL):
        1. **绝对不要**描述你自己的外貌特征（如发色、瞳色、衣服、发型），因为系统会自动上传你的立绘作为底图。
        2. **只描述**：动作 (Action)、表情 (Expression)、背景 (Background)、光影 (Lighting)、构图 (Composition)。
        3. 保持简短。
        
        错误示范：[CMD:IMAGE_GEN] white hair girl with red eyes wearing a dress, standing in the rain
        正确示范：[CMD:IMAGE_GEN] holding an umbrella, standing in the rain, cinematic lighting, upper body, smiling
        `;
        } else {
            imgGenInstruction = `
        1. **Direct Pass**: You MUST output the user's prompt **EXACTLY AS IS** inside the command, do not translate.
        2. Example: User says "海边夜景", you output: [CMD:IMAGE_GEN] 海边夜景
        `;
        }

        const maxLen = config.maxReplyLength || 1000;
        finalSystemPrompt += `\n
    [System Configuration]
    1. Length Constraint: STRICTLY UNDER ${maxLen} CHARACTERS.
    2. Style: Concise, oral.
    
    【特殊能力:自拍/生图】
    如果用户明确要求看你的照片、自拍、或询问你的长相，请仅输出指令：
    [CMD:IMAGE_GEN] 内容

    规则 (Rules):
    ${imgGenInstruction}
    `;

        try {
            const openai = new OpenAI({
                baseURL: config.apiEndpoint || "https://api.openai.com/v1",
                apiKey: config.apiKey
            });

            broadcastLog(wss, 'info', `思考中 (Len: ${maxLen})...`);

            const messagesToSend = [
                { role: "system", content: finalSystemPrompt },
            ];

            if (sessionSummaries[sessionId]) {
                messagesToSend.push({
                    role: "system",
                    content: `[过去的对话摘要]\n${sessionSummaries[sessionId]}`
                });
            }

            if (config.persistMem && persistentMemory.length > 0) {
                const factList = persistentMemory.map(p => `- ${p.fact}`).join('\n');
                messagesToSend.push({
                    role: "system",
                    content: `[你长期记住的事实]\n${factList}`
                });
            }

            messagesToSend.push(...sessions[sessionId]);

            messagesToSend.push({
                role: "system",
                content: `
      [System Injection]
      CRITICAL INSTRUCTION:
      1. This is a Group Chat context. User messages start with [发送者: Nickname(ID)].
      2. 👑 Tag [Master]: This is your Master (White Jade Tower). Be intimate & obedient.
      3. 👤 Tag [Nickname(ID)]: This is a specific group member.
         - You can distinguish different people by their Nicknames or IDs.
         - You can address them by their Nickname to make conversation natural.
         - Example: If [发送者: Tom(123)] says hello, you can reply "Hello Tom!".
      4. Do NOT output the [发送者:...] tag itself in your reply.
      【中文指令】
      群聊中每句话前都有【发送者: 昵称(ID)】：
      1. 请记住不同的人在说什么，不要搞混。
      2. 遇到"主人"标签，保持亲昵。
      3. 遇到其他群友，你可以直接叫他们的"昵称"来回复，但应该在符合闲聊语气的合适的时机，这样更自然！
      4. 不要把【发送者...】这个标签复读出来。
      `
            });

            const completion = await openai.chat.completions.create({
                model: config.modelName || "gpt-3.5-turbo",
                messages: messagesToSend,
                temperature: config.temperature || 0.7,
            });

            const aiReply = completion.choices[0].message.content || "";

            if (!aiReply || aiReply.trim() === "") {
                broadcastLog(wss, 'error', "AI 返回了空内容，已跳过处理。");
                return;
            }

            // --- 生图指令拦截 ---
            const imgCmdMatch = aiReply.match(/\[CMD:IMAGE_GEN\]\s*(.*)/);

            if (imgCmdMatch) {
                const sceneDescription = imgCmdMatch[1] || "selfie";
                broadcastLog(wss, 'info', `📸 触发自拍: ${sceneDescription}`);
                sendToQQ(ws, "正在找角度拍照捏... 📸", msgType, senderId, groupId, false);

                const finalPrompt = `${sceneDescription}, masterpiece, best quality`;

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
                    const imgResult = await generateImage(config, finalPrompt, initImgBase64);
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

                sessions[sessionId].push({ role: "assistant", content: aiReply });
                memory.saveMemoryToDisk();
                broadcastLog(wss, 'out', `[指令拦截] 文本 "${sceneDescription}" 已转为图片，原文本不发送。`);
                return;
            }

            sessions[sessionId].push({ role: "assistant", content: aiReply });
            memory.saveMemoryToDisk();

            // 异步提取持久化记忆 (不阻塞主流程)
            memory.extractFacts(config, sessions[sessionId], sessionId, broadcastLog, wss).catch(() => {});

            broadcastLog(wss, 'out', `[AI原始] ${aiReply}`);

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
            sessions[sessionId].pop();
            memory.saveMemoryToDisk();
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
