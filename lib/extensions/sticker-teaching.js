const { parseCq } = require('../message-chain');
const { extractImageSources } = require('../vision');
const { readAction } = require('../qq-transport');

const CACHE_TTL = 10 * 60_000;
const CACHE_BYTES = 4 * 1024 * 1024;
const stripPunctuation = text => text.replace(/^[\s，,、：:。]+/, '');

// Requiring a teaching verb, an image reference and a meaning keeps casual remarks out of the library.
function stickerLesson(message, config) {
    if (message.transcribed) return null;
    let text = message.text.trim();
    const name = [config.charName || '风堇', ...(config.customKeywords || [])]
        .filter(Boolean).find(alias => text.startsWith(alias));
    if (name) text = stripPunctuation(text.slice(name.length));
    const example = /(?:^|[，,；;。\s]+)(?:以后)?(?:听到|看到)[“‘「『"]([^”’」』"\n]{1,60})[”’」』"](?:时)?(?:就)?(?:用|发)这张(?:图|表情)?[。！!]?$/u.exec(text);
    const triggers = example ? [example[1].trim()].filter(Boolean) : [];
    if (example) text = text.slice(0, example.index);
    if (/^\/收录表情(?:\s|$)/.test(text)) return { meaning: text.replace(/^\/收录表情\s*/, '').trim(), triggers };
    if (!name && !message.atMe && message.type !== 'private') return null;
    if (!message.replyTo && !message.imageCount) return null;
    if ((!text || ['记一下', '记住'].includes(text)) && triggers.length) return { meaning: `回应「${triggers[0]}」`, triggers };
    const match = /^(?:记一下|记住|收下|收录)(?:这[个张]表情包?)?[，,、\s]*(?:这张(?:图|表情包?)?|这个表情包?)(?:在(?:我们|本|这个)?群(?:里)?)?[，,、\s]*(?:的意思是|含义是|意思是|表示|代表|是|叫|用来表达)[：:\s]*(.+)$/su.exec(text);
    if (!match) return null;
    return { triggers, meaning: match[1].trim().replace(/[。！!]+$/u, '').replace(/^[“‘「『"](.+)[”’」』"]$/su, '$1').trim() };
}

function createStickerReferences({ now = Date.now, lookup = readAction } = {}) {
    const cache = new Map();
    let bytes = 0;
    const key = (m, id) => JSON.stringify([m.selfId, m.sessionId, id]);
    function remove(k) { bytes -= cache.get(k).size; cache.delete(k); }
    function prune() {
        for (const [k, record] of cache) {
            if (now() - record.time < CACHE_TTL && cache.size <= 200 && bytes <= CACHE_BYTES) break;
            remove(k);
        }
    }
    function remember(m) {
        if (!m.selfId || !m.id || m.imageCount !== 1 || m.images.length !== 1) return;
        const size = Buffer.byteLength(m.images[0]);
        if (size > 704 * 1024) return;
        const k = key(m, m.id);
        if (cache.has(k)) remove(k);
        cache.set(k, { image: m.images[0], author: m.senderId, size, time: now() });
        bytes += size; prune();
    }
    async function resolve(ws, m) {
        if (!m.replyTo) return m.imageCount === 1 && m.images.length === 1
            ? { image: m.images[0], author: m.senderId, messageId: m.id } : null;
        if (m.imageCount || !m.selfId) return null;
        prune();
        const cached = cache.get(key(m, m.replyTo));
        if (cached) return { image: cached.image, author: cached.author, messageId: m.replyTo };
        if (m.selfId.startsWith('qbot_') || ws?.sendOfficial || !/^-?\d{1,16}$/.test(m.replyTo) || !Number.isSafeInteger(Number(m.replyTo))) return null;
        if (ws?.selfId && String(ws.selfId) !== m.selfId) return null;
        const data = await lookup(ws, 'get_msg', { message_id: Number(m.replyTo) });
        if (!data || String(data.message_id) !== m.replyTo || data.message_type !== m.type ||
            (data.self_id != null && String(data.self_id) !== m.selfId)) return null;
        if (m.type === 'group' && String(data.group_id) !== m.groupId) return null;
        const author = String(data.sender?.user_id ?? data.user_id ?? '');
        if (!/^\d+$/.test(author)) return null;
        if (m.type === 'private') {
            // A bot-authored private message needs both endpoints to identify its conversation.
            const peer = author === m.selfId ? String(data.target_id ?? '') : author;
            if (peer !== m.senderId) return null;
        }
        const segments = Array.isArray(data.message) ? data.message : parseCq(typeof data.message === 'string' ? data.message : String(data.raw_message || ''));
        const imageCount = segments.filter(segment => segment?.type === 'image').length;
        const images = extractImageSources({ message: segments });
        if (imageCount !== 1 || images.length !== 1) return null;
        remember({ selfId: m.selfId, sessionId: m.sessionId, id: m.replyTo, imageCount, images, senderId: author });
        return { image: images[0], author, messageId: m.replyTo };
    }
    return { remember, resolve };
}

module.exports = { stickerLesson, createStickerReferences };
