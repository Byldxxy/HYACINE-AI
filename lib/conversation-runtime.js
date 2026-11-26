const { createHash } = require('node:crypto');
const { assignTopic, candidateCurrent, topicBackground } = require('./group-topics');
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
    const states = new Map(), queues = new Map(), activeTurns = new Map(); let epoch = 0;
    const seenIds = new Map(), seenFallbacks = new Map();
    function state(id) {
        if (!states.has(id)) {
            // Bound idle group bookkeeping without evicting an active conversation.
            if (states.size >= 1000) for (const key of states.keys()) { if (!queues.has(key)) { states.delete(key); break; } }
            states.set(id, { revision: 0, consumed: 0, observations: [], sent: [], lastSent: 0, directPending: 0, explicitPending: 0, generation: 0 });
        }
        return states.get(id);
    }
    function accept(message) {
        const time = now();
        // Each map has a single TTL and preserves arrival order. Only visit expired heads.
        for (const [entries, ttl] of [[seenIds, 600000], [seenFallbacks, 3000]]) {
            for (const [key, arrived] of entries) {
                if (time - arrived < ttl) break;
                entries.delete(key);
            }
        }
        const seen = message.id == null ? seenFallbacks : seenIds;
        const identity = message.id ?? createHash('sha256').update(JSON.stringify([message.senderId, message.time, message.observation, message.images, message.voiceFile])).digest('hex');
        const key = `${message.selfId}:${message.sessionId}:${identity}`;
        if (seen.has(key)) return false;
        seen.set(key, time);
        if (seenIds.size + seenFallbacks.size > 10000) {
            const oldest = (seenIds.values().next().value ?? Infinity) <= (seenFallbacks.values().next().value ?? Infinity) ? seenIds : seenFallbacks;
            oldest.delete(oldest.keys().next().value);
        }
        return true;
    }
    function observe(message, direct = false) {
        const s = state(message.sessionId); s.revision++;
        const receivedAt = now(), topic = message.groupId || message.sessionId.startsWith('group_') ? assignTopic(s, message, receivedAt) : {};
        s.observations.push({ id: message.id, senderId: message.senderId, sender: message.sender, selfId: message.selfId, mentions: message.mentions.slice(0, 50), replyTo: message.replyTo, observation: message.observation.slice(0, 2000), seq: s.revision, receivedAt, direct, ...topic });
        s.observations = s.observations.filter(o => now() - o.receivedAt < 600_000).slice(-100);
        if (direct) s.consumed = s.revision;
        activeTurns.get(message.sessionId)?.refresh();
        return s.revision;
    }
    function enqueue(id, fn, { direct = false, explicit = direct } = {}) {
        const s = state(id);
        if (direct && s.directPending >= 20) return Promise.resolve({ skipped: 'queue-full' });
        if (direct) s.directPending++;
        if (explicit) s.explicitPending++;
        if (explicit) activeTurns.get(id)?.refresh();
        const previous = queues.get(id) || Promise.resolve();
        const next = previous.then(fn, fn);
        const guarded = next.catch(() => {}).finally(() => { if (direct) s.directPending--; if (explicit) s.explicitPending--; if (queues.get(id) === guarded) queues.delete(id); });
        queues.set(id, guarded); return next;
    }
    function enqueueTurn(id, { kind, metrics, valid, expiresAt, stopSignal }, fn) {
        const queuedAt = Date.now(), receivedAt = now();
        return enqueue(id, async () => {
            const stats = metrics?.start(kind, id, queuedAt);
            const controller = new AbortController();
            const signal = stopSignal ? AbortSignal.any([controller.signal, stopSignal]) : controller.signal;
            let proposedReply = '';
            const refresh = () => {
                if (!signal.aborted && !valid(proposedReply)) controller.abort();
                return !signal.aborted;
            };
            const timer = expiresAt == null ? null : setTimeout(() => controller.abort(), Math.max(0, expiresAt - now()));
            timer?.unref();
            activeTurns.set(id, { refresh });
            let outcome = 'silent';
            // Race read-only stages even for adapters that ignore AbortSignal. A dispatched
            // delivery, however, must settle its receipt before releasing the session queue.
            async function pending(work) {
                signal.throwIfAborted();
                let cancel;
                const stopped = new Promise((_, reject) => { cancel = () => reject(signal.reason); });
                signal.addEventListener('abort', cancel, { once: true });
                try { return await Promise.race([stopped, Promise.resolve().then(() => { signal.throwIfAborted(); return work(); })]); }
                finally { signal.removeEventListener('abort', cancel); }
            }
            const turn = {
                signal, pending, current: refresh, failed: () => { outcome = 'error'; },
                propose(text) { proposedReply = text; return refresh(); },
                model: work => stats ? stats.model(() => pending(work)) : pending(work),
                async delivery(work) {
                    try {
                        const receipt = await (stats ? stats.delivery(work) : work());
                        outcome = 'sent';
                        return receipt;
                    } catch (error) { outcome = 'error'; throw error; }
                },
            };
            try {
                if (now() - receivedAt > 120000) controller.abort();
                if (refresh()) return await fn(turn);
            }
            catch (error) {
                if (signal.aborted && error === signal.reason) return;
                outcome = 'error'; throw error;
            } finally {
                activeTurns.delete(id);
                clearTimeout(timer);
                stats?.finish(outcome === 'silent' && !refresh() ? 'stale' : outcome);
            }
        }, { direct: kind !== 'proactive', explicit: kind === 'direct' });
    }
    function recordSent(id, text, { messageId = null, kind = 'direct', input = '', through = null, targetSeq = through } = {}) {
        const s = state(id); s.lastSent = now(); s.consumed = Math.max(s.consumed, through ?? s.revision);
        const topic = s.observations.find(o => o.seq === targetSeq)?.topic;
        s.sent.push({ text, messageId: messageId == null ? null : String(messageId), kind, input, topic, time: now() }); s.sent = s.sent.slice(-20);
    }
    function token(id) { const generation = state(id).generation, currentEpoch = epoch; return () => currentEpoch === epoch && state(id).generation === generation; }
    function reset(id) { if (id) { const s = state(id); s.generation++; s.focus = null; s.observations = []; s.sent = []; s.consumed = s.revision; activeTurns.get(id)?.refresh(); } else { epoch++; for (const key of states.keys()) reset(key); } }
    return { now, state, states, accept, observe, enqueue, enqueueTurn, recordSent, token, reset,
        candidateCurrent: (id, seq, proposedReply = '') => {
            const s = state(id);
            return candidateCurrent(s, seq, now()) && (!proposedReply ||
                !s.observations.some(o => o.seq > seq && similarReply(proposedReply, o.observation)));
        },
        topicBackground: (id, seq, continuation) => topicBackground(state(id), seq, now(), continuation),
        isBusy: id => queues.has(id),
        isReplyToBot: (id, messageId) => Boolean(messageId && state(id).sent.some(s => s.messageId === messageId)),
        context: id => state(id).observations.filter(o => !o.direct && now() - o.receivedAt < 600_000).slice(-16),
        isRepetition: (id, text, history = []) => [...state(id).sent.map(s => s.text), ...history.filter(m => m.role === 'assistant').slice(-8).map(m => m.content)].some(old => similarReply(old, text)),
    };
}
module.exports = { createConversationRuntime, similarReply };
