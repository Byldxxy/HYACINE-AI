const { explicitTeaching } = require('./chat-policy');
function mergeLearnedMemory(records, value, evidence, source, now) {
    if (!value || !['slang', 'knowledge', 'bot_preference'].includes(value.kind)) return 0;
    const subject = String(value.subject || '').trim(), fact = typeof value.fact === 'string' ? value.fact.trim() : '';
    if (!subject || subject.length > 80 || !fact || fact.length > 600) return 0;
    const ids = [...new Set((Array.isArray(value.evidenceIds) ? value.evidenceIds : [value.evidenceId]).filter(id => id != null).map(String))].slice(0, 8);
    const proofs = ids.map(id => evidence.find(e => e.id != null && String(e.id) === id)).filter(Boolean);
    if (!proofs.length || proofs.length !== ids.length || proofs.some(p => p.replyTo)) return 0;
    const persona = value.kind === 'bot_preference';
    if (persona) {
        // A user's instruction alone cannot manufacture the bot's personal taste.
        if (proofs.length < 2 || proofs.some(p => p.role !== 'assistant' || !/我.{0,6}(?:喜欢|偏爱|不喜欢|讨厌|倾向)/.test(p.text))) return 0;
    } else {
        if (proofs.some(p => p.role !== 'user')) return 0;
        if (value.kind === 'slang' && !proofs.some(p => explicitTeaching(p.text)) && proofs.filter(p => p.text.includes(subject)).length < 2) return 0;
        if (value.kind === 'knowledge' && !proofs.some(p => explicitTeaching(p.text))) return 0;
    }
    const target = persona ? 'persona' : source;
    const prior = records.find(f => f.source === target && f.kind === value.kind && f.subject === subject);
    if (prior?.locked || prior?.enabled === false || prior?.fact === fact) return 0;
    // Existing taste cannot be rewritten by reinterpreting the same old replies.
    if (persona && prior && ids.filter(id => !(prior.evidenceIds || []).includes(id)).length < 2) return 0;
    const next = { fact, kind: value.kind, subject, source: target, evidenceSource: source, evidenceIds: ids, time: new Date(now).toISOString(), enabled: true };
    if (prior) Object.assign(prior, next);
    else if (records.length < 1000) records.push(next);
    else return 0;
    return 1;
}
module.exports = { mergeLearnedMemory };
