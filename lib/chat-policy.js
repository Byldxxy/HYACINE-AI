/** Bounded context and participation policy; no additional model requests. */
function activityPolicy(state, config, now) {
    const all = state.observations.filter(o => now - o.receivedAt < 600000);
    const recent = all.filter(o => now - o.receivedAt < 120000);
    const hot = recent.length >= 6 && new Set(recent.map(o => o.senderId)).size >= 2;
    const mode = hot ? 'active' : recent.length < 3 ? 'quiet' : 'normal';
    const base = Math.max(0, Number(config.proactiveCooldown ?? 600)) * 1000;
    const interval = Math.max(10, Number(config.proactiveInterval) || 300) * 1000;
    return { mode, minNew: hot ? 2 : mode === 'quiet' ? 1 : 3,
        cooldown: hot ? Math.min(base, Math.max(15000, base / 3)) : mode === 'quiet' ? Math.max(base, 120000) : base,
        interval: hot ? Math.min(interval, 15000) : mode === 'quiet' ? Math.max(interval, 120000) : interval,
        threshold: mode === 'quiet' ? Math.max(.8, Number(config.proactiveThreshold) || .6) : Number(config.proactiveThreshold ?? .6) };
}
function topicContext(history, message) {
    const threads = []; let input = null;
    for (const item of history.slice(-24)) {
        if (item.role === 'user') input = item;
        if (item.role !== 'assistant') continue;
        threads.push({ anchor: String(item.messageIds?.[0] || item.messageId || `turn-${threads.length}`),
            senderId: input?.senderId || null, question: String(input?.content || '').slice(0, 700),
            answer: String(item.content || '').slice(0, 700),
            quoted: Boolean(message?.replyTo && (item.messageIds?.includes(message.replyTo) || String(item.messageId) === message.replyTo)) });
        input = null;
    }
    return { currentSender: message?.senderId || null, replyTo: message?.replyTo || null, anchors: threads.slice(-8) };
}
function terms(value) {
    const text = String(value).normalize('NFKC').toLowerCase();
    const words = text.match(/[a-z0-9_]{2,}|[\p{Script=Han}]+/gu) || [];
    return new Set(words.flatMap(word => /^[a-z0-9_]/.test(word) ? [word]
        : Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2))));
}
function memoryContext(records, source, query = '', { maxChars = 5000, maxRecords = 16, mode = 'balanced' } = {}) {
    const text = String(query).normalize('NFKC').toLowerCase(), queryTerms = terms(text);
    const eligible = records.filter(f => f.enabled !== false && !f.memberKind &&
        ((source && f.source === source) || f.source === 'manual' || f.source === 'persona' || !f.source) &&
        (f.kind !== 'slang' || (f.subject && text.includes(f.subject.normalize('NFKC').toLowerCase()))));
    const documents = eligible.map(f => terms(`${f.subject || ''} ${String(f.fact).slice(0, 1000)}`));
    const frequency = new Map();
    for (const doc of documents) for (const term of doc) frequency.set(term, (frequency.get(term) || 0) + 1);
    const average = documents.reduce((sum, doc) => sum + doc.size, 0) / Math.max(1, documents.length) || 1;
    const ranked = eligible.map((record, index) => {
        const doc = documents[index];
        const overlap = [...doc].filter(t => queryTerms.has(t)).reduce((score, term) => score + Math.log(1 + (documents.length - frequency.get(term) + .5) / (frequency.get(term) + .5)) * 2.2 / (1 + 1.2 * (.25 + .75 * doc.size / average)), 0);
        const subjectMatch = record.subject && text.includes(record.subject.normalize('NFKC').toLowerCase());
        return { record, index, relevance: overlap + (subjectMatch ? 8 : 0) };
    })
        .sort((a, b) => Number(Boolean(b.record.locked)) - Number(Boolean(a.record.locked)) ||
            b.relevance - a.relevance || b.index - a.index);
    const selected = [], seen = new Set();
    let remaining = maxChars, fallbackCount = 0;
    for (const { record, relevance } of ranked) {
        const fact = String(record.fact || '').trim().slice(0, 1000);
        const key = fact.normalize('NFKC').toLowerCase();
        if (!fact || seen.has(key)) continue;
        // Keep a small background allowance; unrelated accumulated facts cannot dominate a turn.
        const fallback = !relevance && !record.locked && (record.kind !== 'bot_preference' || mode === 'focused');
        if (fallback && (mode === 'focused' || fallbackCount >= 3)) continue;
        const cost = fact.length + 40;
        if (cost > remaining) continue;
        selected.push({ ...record, fact });
        seen.add(key); remaining -= cost;
        if (fallback) fallbackCount++;
        if (selected.length >= maxRecords) break;
    }
    return selected;
}
function explicitTeaching(text) { return /(?:记住|记一下|外号|绰号|我们(?:群|这里).{0,12}(?:叫|指)|(?:别|不要)叫我|叫我|称呼我)/.test(text); }
module.exports = { activityPolicy, topicContext, memoryContext, explicitTeaching };
