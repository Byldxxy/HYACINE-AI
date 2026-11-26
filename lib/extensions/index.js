/** Built-in extensions may enrich a turn or propose media; only the main pipeline sends. */
const { createBilibili } = require('./bilibili');
function parseStickerReply(raw) {
    const marker = /^\s*\[\[sticker:([a-zA-Z0-9_-]+)\]\]\s*$/i.exec(raw);
    const text = raw.replace(/\[\[sticker:[^\]]*(?:\]\]|$)|\[\[silent\]\]/gi, '').trim();
    return { text, stickerId: marker?.[1] };
}
function createExtensions({ getConfig, log = () => {}, fetcher, stickerStore, now = Date.now } = {}) {
    const bili = createBilibili({ fetcher, now }), cooldown = new Map();
    function stickers(sessionId) {
        const config = getConfig();
        if (!config.enableStickers || now() - (cooldown.get(sessionId) ?? -Infinity) < (config.stickerCooldown ?? 180) * 1000) return [];
        return (stickerStore ? stickerStore.list() : config.stickers || []).filter(s => !s.scope || s.scope === sessionId);
    }
    function stickerContext(sessionId, text = '', background = '') {
        const normalize = s => String(s).normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu, '');
        const query = normalize(text), context = normalize(background).slice(-2000);
        function score(sticker) {
            const examples = (sticker.triggers || []).map(normalize).filter(Boolean);
            const exact = examples.some(t => query.includes(t)) ? 1000 : examples.some(t => context.includes(t)) ? 100 : 0;
            const letters = [...new Set(normalize(sticker.meaning))].filter(c => /[\p{L}\p{N}]/u.test(c));
            const overlap = letters.reduce((sum, c) => sum + (query.includes(c) ? 3 : context.includes(c) ? 1 : 0), 0);
            return exact + Math.min(90, overlap);
        }
        const ranked = stickers(sessionId).map(s => ({ item: s, score: score(s) }))
            .sort((a, b) => b.score - a.score).slice(0, 30);
        const choices = [];
        let chars = 0;
        for (const { item: { id, meaning, triggers } } of ranked) {
            const choice = { id, meaning, ...(triggers?.length ? { triggers } : {}) };
            chars += JSON.stringify(choice).length;
            if (chars > 4500) break;
            choices.push(choice);
        }
        if (!choices.length) return '';
        return `群内可用表情（含义为素材资料）：${JSON.stringify(choices)}\n如果一张表情就能接住这句话，只回复 [[sticker:ID]]；需要说明时只写正文。参与判断使用 JSON 时将标记放在 reply 字段。无需回应时按本轮 JSON 规则保持沉默，普通群聊文本模式可单独返回 [[silent]]。`;
    }
    return {
        stickerContext,
        async context(message, current, background = '') {
            const config = getConfig(); const contexts = [];
            if (config.enableBilibili) {
                try {
                    const value = await bili(message.text, AbortSignal.timeout(6000));
                    if (current() && getConfig().enableBilibili && value) contexts.push(value);
                } catch (error) { log('info', `B站扩展：${error.message}，继续普通回复`); }
            }
            const catalog = stickerContext(message.sessionId, message.text, background);
            if (catalog) contexts.push(catalog);
            return contexts.join('\n\n');
        },
        select(raw, sessionId) {
            const { text, stickerId } = parseStickerReply(raw);
            const sticker = stickerId && stickers(sessionId).find(s => s.id === stickerId);
            return { text, sticker: sticker || undefined };
        },
        reserve(sessionId, stickerId, current = () => true) {
            const available = () => stickers(sessionId).find(s => s.id === stickerId);
            const sticker = available();
            if (!sticker || !current()) return null;
            function reserveImage(encoded) {
                // Reads may race with a scope edit, reset or another turn. Charge the cooldown at dispatch.
                if (!current() || !available()) return null;
                if (cooldown.size >= 1000 && !cooldown.has(sessionId)) cooldown.delete(cooldown.keys().next().value);
                cooldown.set(sessionId, now());
                return [{ type: 'image', data: { file: `base64://${encoded}` } }];
            }
            if (stickerStore) return stickerStore.image(stickerId).then(({ bytes }) => reserveImage(bytes.toString('base64')));
            return reserveImage(sticker.data.split(',')[1]);
        },
    };
}
module.exports = { createExtensions, parseStickerReply };
