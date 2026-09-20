/** OneBot -> normalized chain -> shared session queue -> model -> acknowledged segments -> memory. */
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { smartSplit } = require('./utils');
const { generateImage, selectImageGenerationPrompt } = require('./image-gen');
const { prepareVisionImages } = require('./vision');
const { buildConversationMessages, buildConversationSystemPrompt, requestChatCompletion } = require('./chat-completion');
const { normalizeMessage, isDirect } = require('./message-chain');
const { createConversationRuntime } = require('./conversation-runtime');
const { sendToQQ } = require('./qq-transport');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const limitText = (text, max) => Array.from(text).slice(0, Math.max(1, Number(max) || 1000)).join('');
function replySegments(text, split) {
    if (!split || text.includes('```')) return [text];
    const pieces = smartSplit(text);
    if (pieces.length <= 3) return pieces;
    const size = Math.ceil(pieces.length / 3), result = [];
    for (let i = 0; i < pieces.length; i += size) result.push(pieces.slice(i, i + size).join(''));
    return result;
}
function createMessageHandler(deps) {
    const { getConfig, memory } = deps;
    const runtime = deps.runtime || createConversationRuntime();
    const send = deps.sendToQQ || sendToQQ;
    const log = (type, text) => deps.broadcastLog?.(deps.wss, type, text);
    const complete = deps.requestChatCompletion || requestChatCompletion;
    async function handleQQMessage(ws, event) {
        const config = getConfig(), message = normalizeMessage({ ...event, self_id: event?.self_id || ws?.selfId }, config);
        if (!message) return;
        if (message.id && (memory.getSessions()[message.sessionId] || []).some(item => item.role === 'user' && item.messageId === message.id)) return;
        if (!runtime.accept(message)) return;
        const id = message.sessionId;
        const knownReply = runtime.isReplyToBot(id, message.replyTo) || (message.replyTo && (memory.getSessions()[id] || []).some(m => m.role === 'assistant' && (String(m.messageId) === message.replyTo || m.messageIds?.includes(message.replyTo))));
        const direct = isDirect(message, config, knownReply);
        if (!message.observation) return;
        message.seq = runtime.observe(message, direct);
        if (!direct) return;
        if (['/reset', '/clear', '重置记忆', '忘记一切'].includes(message.text) && (message.type === 'private' || (config.masterQQ && message.senderId === String(config.masterQQ)))) runtime.reset(id);
        const current = runtime.token(id), receivedAt = runtime.now();
        return runtime.enqueue(id, async () => {
            if (!current() || runtime.now() - receivedAt > 120000) { log('info', '已跳过失效或过期的回复任务'); return; }
            return processMessage(ws, message, current);
        }, { direct: true });
    }
    async function processMessage(ws, m, current) {
        const config = getConfig(), id = m.sessionId;
        const isMaster = Boolean(config.masterQQ && m.senderId === String(config.masterQQ));
        const request = { requestId: randomUUID(), source: 'chat' };
        log('in', `[${id} / ${m.senderId}] ${m.observation}`);
        const notify = (text, at = false) => send(ws, text, m.type, m.senderId, m.groupId, at);
        if (['/reset', '/clear', '重置记忆', '忘记一切'].includes(m.text)) {
            if (isMaster || m.type === 'private') {
                memory.setSession(id, []); delete memory.getSummaries()[id];
                await Promise.all([memory.saveMemoryToDisk(), memory.saveSummariesToDisk()]);
                await notify('记忆已清空。'); log('system', `会话 ${id} 已重置`);
            }
            return;
        }
        if (!config.apiKey) { log('error', '未配置 API Key'); return; }
        let assistant = null, committed = false;
        const content = m.text || '请理解图片内容并自然回应。';
        const user = { role: 'user', content: m.groupId ? `[发送者: ${m.sender}(${m.senderId})] ${content}${m.imageCount ? ` [附带 ${m.imageCount} 张图片]` : ''}` : content,
            messageId: m.id, senderId: m.senderId, time: new Date(runtime.now()).toISOString(), kind: 'direct' };
        const maxWindow = Math.max(2, Math.min(2000, (Number(config.shortMem) || 10) * 2));
        let history = [...(memory.getSessions()[id] || [])], summary = memory.getSummaries()[id] || '';
        async function commitSegment(text, receipt) {
            runtime.recordSent(id, text, { messageId: receipt?.messageId, input: content, through: m.seq });
            if (!current()) return;
            if (!committed) {
                memory.setSession(id, [...history, user]);
                assistant = { role: 'assistant', content: '', kind: 'direct', time: new Date(runtime.now()).toISOString(), messageIds: [] };
                memory.getSessions()[id].push(assistant); committed = true;
                if (summary !== (memory.getSummaries()[id] || '')) { memory.setSummary(id, summary); await memory.saveSummariesToDisk(); }
            }
            assistant.content += text;
            if (receipt?.messageId != null) assistant.messageIds.push(String(receipt.messageId));
            memory.getSessions()[id] = memory.getSessions()[id].slice(-maxWindow);
            await memory.saveMemoryToDisk();
        }
        try {
            deps.emitPetEvent?.('attention');
            if (history.length + 1 > maxWindow) {
                const ratio = Math.max(0, Math.min(1, Number(config.longMem) || 0));
                const keep = ratio > 0 ? Math.max(1, Math.floor((maxWindow - 1) * ratio)) : maxWindow - 1;
                const overflow = history.slice(0, -keep);
                if (ratio > 0 && overflow.length) {
                    const result = await memory.summarizeMessages(config, overflow, summary);
                    if (result) summary = result.slice(0, 4000);
                }
                history = history.slice(-keep);
            }
            if (!current()) return;
            let images = [];
            if (m.imageCount) {
                const prepared = await (deps.prepareVisionImages || prepareVisionImages)(m.images);
                images = prepared.images;
                if (!images.length) { if (current()) await notify('图片读取失败，请重新发送图片。', m.atMe); return; }
                if (prepared.errors.length) log('error', `部分图片未能读取: ${prepared.errors.join('；')}`);
            }
            if (!current()) return;
            deps.emitPetEvent?.('thinking', request);
            const systemPrompt = buildConversationSystemPrompt(config, { senderId: m.senderId, groupId: m.groupId, isMaster });
            const messages = buildConversationMessages({ systemPrompt, summary, persistentMemory: memory.getPersistentMemory(), includePersistentMemory: config.persistMem,
                sessionMessages: [...history, user], currentVisionImages: images, groupId: m.groupId, sessionId: id,
                groupContext: m.groupId ? runtime.context(id).filter(o => o.seq <= m.seq).map(o => ({ id: o.id, sender: o.sender, senderId: o.senderId, text: o.observation, mentions: o.mentions, replyTo: o.replyTo })) : [],
                replyTo: m.replyTo ? [...runtime.state(id).sent.filter(s => s.messageId === m.replyTo).map(s => s.text), ...history.filter(h => String(h.messageId) === m.replyTo || h.messageIds?.includes(m.replyTo)).map(h => h.content)].at(-1) : null });
            const completion = await complete(config, messages);
            if (!current()) return;
            const raw = completion.choices?.[0]?.message?.content;
            if (typeof raw !== 'string' || !raw.trim()) { log('error', '模型返回空内容，未发送'); return; }
            const command = raw.trim().match(/^\[CMD:IMAGE_GEN\]\s*([\s\S]*)$/);
            if (command) {
                deps.emitPetEvent?.('imageGenerating', request);
                let base = null;
                const name = config.currentPersonaFileName;
                if (name && path.basename(name) === name && deps.paths?.AVATAR_DIR) {
                    try { base = (await fs.readFile(path.join(deps.paths.AVATAR_DIR, name))).toString('base64'); } catch { /* Optional character image. */ }
                }
                const result = await (deps.generateImage || generateImage)(config, selectImageGenerationPrompt(config, content, command[1]), base, images);
                if (!current()) return;
                const receipt = await notify([{ type: 'image', data: { file: result.type === 'url' ? result.data : `base64://${result.data}`, cache: '0' } }]);
                await commitSegment('[已按本轮要求发送图片]', receipt);
                log('out', `[${id}] 图片发送已确认`);
                return;
            }
            const reply = limitText(raw.trim(), config.maxReplyLength);
            const recent = runtime.state(id).sent;
            if (recent.some(s => runtime.now() - s.time < 30000 && s.input === content && s.text === reply)) { log('info', `[${id}] 已拦截同一问题的短时重复回复`); return; }
            const segments = replySegments(reply, config.enableSplit);
            for (let i = 0; i < segments.length; i++) {
                if (config.enableSplit) await (deps.sleep || wait)(Math.min(1500, 200 + segments[i].length * 25));
                if (!current()) return;
                let receipt;
                try { receipt = await notify(segments[i], i === 0 && m.atMe); }
                catch (error) { if (error.code === 'delivery-unknown') runtime.recordSent(id, segments[i], { kind: 'uncertain', input: content, through: m.seq }); throw error; }
                await commitSegment(segments[i], receipt);
                log('out', `[${id} ${i + 1}/${segments.length} 已确认] ${segments[i]}`);
            }
            if (current() && committed) {
                deps.emitPetEvent?.('speaking', { ...request, duration: Math.max(1.2, Math.min(6, reply.length * .08)) });
                const snapshot = (memory.getSessions()[id] || []).map(item => ({ ...item }));
                void memory.extractFacts(config, snapshot, id, deps.broadcastLog, deps.wss, current).catch(() => {});
            }
        } catch (error) {
            log('error', `[${id}] 回复中止: ${error.message}${committed ? '；已确认的分段保留，不自动重发' : ''}`);
            deps.emitPetEvent?.('error', request);
        } finally { deps.emitPetEvent?.('taskFinished', request); }
    }
    return handleQQMessage;
}
module.exports = { createMessageHandler, sendToQQ, replySegments };
