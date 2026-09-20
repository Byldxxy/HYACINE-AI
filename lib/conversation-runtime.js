const { createHash } = require('node:crypto');
const normalizeReply = text => String(text).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
function similarReply(a, b) {
    a = normalizeReply(a); b = normalizeReply(b);
    if (!a || !b) return false;
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 10) return false;
    const grams = s => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
    const x = grams(a), y = grams(b), overlap = [...x].filter(g => y.has(g)).length;
    return 2 * overlap / (x.size + y.size) >= 0.6;
}
function createConversationRuntime({ now = Date.now } = {}) {
    const states = new Map(), seen = new Map(), queues = new Map(); let epoch = 0;
    function state(id) {
        if (!states.has(id)) {
            // Bound idle group bookkeeping without evicting an active conversation.
            if (states.size >= 1000) for (const key of states.keys()) { if (!queues.has(key)) { states.delete(key); break; } }
            states.set(id, { revision: 0, consumed: 0, observations: [], sent: [], lastSent: 0, directPending: 0, generation: 0 });
        }
        return states.get(id);
    }
    function accept(message) {
        const time = now();
        for (const [key, expiry] of seen) if (expiry <= time) seen.delete(key);
        const fallback = createHash('sha256').update(JSON.stringify([message.senderId, message.time, message.observation, message.images])).digest('hex');
        const key = `${message.selfId}:${message.sessionId}:${message.id ?? fallback}`;
        if (seen.has(key)) return false;
        seen.set(key, time + (message.id == null ? 3000 : 10 * 60_000));
        while (seen.size > 10000) seen.delete(seen.keys().next().value);
        return true;
    }
    function observe(message, direct = false) {
        const s = state(message.sessionId); s.revision++;
        s.observations.push({ id: message.id, senderId: message.senderId, sender: message.sender, selfId: message.selfId, mentions: message.mentions.slice(0, 50), replyTo: message.replyTo, observation: message.observation.slice(0, 2000), seq: s.revision, receivedAt: now(), direct });
        s.observations = s.observations.filter(o => now() - o.receivedAt < 600_000).slice(-100);
        if (direct) s.consumed = s.revision;
        return s.revision;
    }
    function enqueue(id, fn, { direct = false } = {}) {
        const s = state(id);
        if (direct && s.directPending >= 20) return Promise.resolve({ skipped: 'queue-full' });
        if (direct) s.directPending++;
        const previous = queues.get(id) || Promise.resolve();
        const next = previous.then(fn, fn);
        const guarded = next.catch(() => {}).finally(() => { if (direct) s.directPending--; if (queues.get(id) === guarded) queues.delete(id); });
        queues.set(id, guarded); return next;
    }
    function recordSent(id, text, { messageId = null, kind = 'direct', input = '', through = null } = {}) {
        const s = state(id); s.lastSent = now(); s.consumed = Math.max(s.consumed, through ?? s.revision);
        s.sent.push({ text, messageId: messageId == null ? null : String(messageId), kind, input, time: now() }); s.sent = s.sent.slice(-20);
    }
    function token(id) { const generation = state(id).generation, currentEpoch = epoch; return () => currentEpoch === epoch && state(id).generation === generation; }
    function reset(id) { if (id) { const s = state(id); s.generation++; s.observations = []; s.sent = []; s.consumed = s.revision; } else { epoch++; for (const key of states.keys()) reset(key); } }
    return { now, state, states, accept, observe, enqueue, recordSent, token, reset,
        isBusy: id => queues.has(id),
        isReplyToBot: (id, messageId) => Boolean(messageId && state(id).sent.some(s => s.messageId === messageId)),
        context: id => state(id).observations.filter(o => !o.direct && now() - o.receivedAt < 600_000).slice(-16),
        isRepetition: (id, text, history = []) => [...state(id).sent.map(s => s.text), ...history.filter(m => m.role === 'assistant').slice(-8).map(m => m.content)].some(old => similarReply(old, text)),
    };
}
module.exports = { createConversationRuntime, similarReply };
