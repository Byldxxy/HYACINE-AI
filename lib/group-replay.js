/** Feed a saved group scene to the production message handler, with isolated memory and delivery. */
const { createConversationRuntime } = require('./conversation-runtime');
const { normalizeMessage, isDirect } = require('./message-chain');
const { createMessageHandler } = require('./message-handler');
const { requestChatCompletion } = require('./chat-completion');

const BOT = '80000001';
const GROUP = '80000002';
const SESSION = 'group_' + GROUP;
const invalid = text => Object.assign(new Error(text), { code: 'invalid-data' });

function readScene(transcript, botName) {
    if (typeof transcript !== 'string' || transcript.length > 12000) throw invalid('片段限 12000 字');
    const lines = transcript.trim().split(/\r?\n/).filter(line => line.trim());
    if (!lines.length || lines.length > 32) throw invalid('每个片段需要 1–32 条消息');
    const members = new Map([['机器人', BOT], [botName, BOT]]);
    const rows = lines.map((line, index) => {
        const match = /^([^：:\n]{1,32})[：:]\s*(?:\[#(\d+)\]\s*)?(.+)$/u.exec(line.trim());
        if (!match || !match[1].trim() || !match[3].trim()) throw invalid('第 ' + (index + 1) + ' 行请填写“成员：消息”');
        const [, rawName, quote, value] = match;
        const name = rawName.trim(), text = value.trim();
        if (text.length > 1500 || (quote && (Number(quote) < 1 || Number(quote) > index))) throw invalid('第 ' + (index + 1) + ' 行过长或引用行号无效');
        if (!members.has(name)) members.set(name, String(81000000 + members.size));
        return { name, sender: members.get(name), quote: quote ? String(Number(quote)) : null, text };
    });
    const mentions = [...members.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^$()|[\]\\]/g, '\\$&'));
    const mention = new RegExp('@(' + mentions.join('|') + ')(?=$|[\\s，。！？、:：,.!?])', 'gu');
    return rows.map((row, index) => {
        const message = row.quote ? [{ type: 'reply', data: { id: row.quote } }] : [];
        let offset = 0;
        for (const m of row.text.matchAll(mention)) {
            if (m.index > offset) message.push({ type: 'text', data: { text: row.text.slice(offset, m.index) } });
            message.push({ type: 'at', data: { qq: members.get(m[1]) } });
            offset = m.index + m[0].length;
        }
        if (offset < row.text.length) message.push({ type: 'text', data: { text: row.text.slice(offset) } });
        return { ...row, event: { post_type: 'message', message_type: 'group', self_id: BOT, user_id: row.sender,
            group_id: GROUP, message_id: String(index + 1), sender: { card: row.name }, message } };
    });
}

async function replayGroupScene(input, { config, stickerStore, complete = requestChatCompletion, signal }) {
    const rows = readScene(input?.transcript, config.charName || '风堇');
    const targetLine = input.targetLine ?? rows.length;
    if (!Number.isInteger(targetLine) || targetLine < 1 || targetLine > rows.length) throw invalid('目标行号超出片段范围');
    const target = rows[targetLine - 1];
    if (target.sender === BOT) throw invalid('请选择群成员发出的消息');
    const arrivals = rows.slice(targetLine);
    if (arrivals.some(row => row.sender === BOT)) throw invalid('目标行之后请只保留等待回复期间到达的群友发言');
    const scope = input.scope ?? '';
    if (typeof scope !== 'string' || scope.length > 150) throw invalid('表情素材范围无效');
    const settings = { ...config, qqProvider: 'napcat', botQQ: BOT, masterQQ: '', enableSplit: false, persistMem: false,
        longMem: 0, stickerLearning: 'off', enableBilibili: false, stickers: [] };
    const runtime = createConversationRuntime();
    const sessions = { [SESSION]: [] };
    const memory = { getSessions: () => sessions, getSummaries: () => ({}), getPersistentMemory: () => [],
        setSession: (id, history) => { sessions[id] = history; }, saveMemoryToDisk: async () => {}, extractFacts: async () => {} };
    const seen = new Map();
    let lastUser;
    for (const row of rows.slice(0, targetLine - 1)) {
        const id = row.event.message_id;
        if (row.sender === BOT) {
            const turn = (row.quote ? seen.get(row.quote) : lastUser) || null;
            if (turn) sessions[SESSION].push({ role: 'user', senderId: turn.senderId, messageId: turn.id,
                content: '[' + turn.sender + '] ' + turn.contentText, replyTo: turn.replyTo, mentions: turn.mentions });
            sessions[SESSION].push({ role: 'assistant', content: row.text, messageIds: [id] });
            runtime.recordSent(SESSION, row.text, { messageId: id, input: turn?.contentText || '', through: turn?.seq });
            runtime.state(SESSION).focus = { time: runtime.now(), senderId: turn?.senderId, seq: turn?.seq ?? runtime.state(SESSION).revision };
            lastUser = null;
        } else {
            const m = normalizeMessage(row.event, settings);
            m.seq = runtime.observe(m, isDirect(m, settings, runtime.isReplyToBot(SESSION, m.replyTo)));
            seen.set(id, m);
            lastUser = m;
        }
    }

    const outputs = [];
    let selectedImage = null, failure = '', modelCalled = false;
    const library = stickerStore && {
        list: () => stickerStore.list().filter(s => !s.scope || (scope && s.scope === scope)).map(s => ({ ...s, scope: s.scope ? SESSION : '' })),
        image: async id => { const image = await stickerStore.image(id); selectedImage = id; return image; },
    };
    const handle = createMessageHandler({
        getConfig: () => settings, memory, runtime, stickerStore: library,
        requestChatCompletion: async (saved, messages, _client, turnSignal) => {
            const requestSignal = signal && turnSignal ? AbortSignal.any([signal, turnSignal]) : signal || turnSignal;
            requestSignal?.throwIfAborted();
            modelCalled = true;
            if (!saved.apiKey) throw new Error('请先保存聊天模型的 API Key');
            const pending = complete(saved, messages, undefined, requestSignal);
            // Only this turn is generated. Later human messages advance the same live candidate guard.
            for (const row of arrivals) {
                const m = normalizeMessage(row.event, settings);
                runtime.observe(m, isDirect(m, settings, runtime.isReplyToBot(SESSION, m.replyTo)));
            }
            const result = await pending;
            signal?.throwIfAborted();
            return result;
        },
        generateImage: async () => ({ type: 'url', data: 'replay-image' }),
        sendToQQ: async (_ws, message) => {
            signal?.throwIfAborted();
            for (const part of Array.isArray(message) ? message : [{ type: 'text', data: { text: message } }]) {
                if (part.type === 'image') outputs.push(selectedImage ? { type: 'sticker', id: selectedImage } : { type: 'image' });
                else if (part.type === 'text' && part.data.text.trim()) outputs.push({ type: 'text', text: part.data.text });
            }
            return { messageId: 'preview-' + outputs.length };
        },
        broadcastLog: (_ws, type, text) => { if (type === 'error') failure = text; },
    });
    await handle(null, target.event);
    signal?.throwIfAborted();
    if (failure && !outputs.length) throw new Error(failure);
    const kind = outputs.some(o => o.type !== 'sticker') ? 'reply' : outputs.length ? 'sticker' : 'silent';
    return { kind, outputs, modelCalled };
}
module.exports = { replayGroupScene };
