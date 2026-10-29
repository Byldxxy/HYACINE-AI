const { isChatIdentity } = require('./qq-identity');
/** Group-local member identities and conservative conversation continuation. */
const clean = value => typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').trim().slice(0, 80) : '';
function rememberMember(facts, message, now = Date.now()) {
    if (!message.groupId) return false;
    const source = message.sessionId, memberId = message.senderId;
    let changed = false;
    function put(id, kind, value, replace = false) {
        value = clean(value); if (!value) return;
        const prior = facts.filter(f => f.source === source && f.memberId === id && f.memberKind === kind);
        if (prior.some(f => f.locked || f.enabled === false || f.value === value)) return;
        if (replace) for (const item of prior) facts.splice(facts.indexOf(item), 1);
        if (facts.length >= 1000 || (!replace && prior.length >= 5)) return;
        facts.push({ source, memberId: id, memberKind: kind, value, fact: `${id}的${kind === 'name' ? '群名片' : '称呼'}：${value}`, evidenceId: message.id, time: new Date(now).toISOString() });
        changed = true;
    }
    put(memberId, 'name', message.sender, true);
    // Explicit forms only. Ambiguous nicknames are resolved by the model using the roster.
    const self = message.text.match(/^(?:以后)?(?:请)?(?:叫我|称呼我)([^，。！？!?\n]{1,20})[。！!]?$/);
    const correction = message.text.match(/^(?:别|不要|不用|别再)叫我[^，。！？!?\n]{1,20}[，, ]+(?:以后)?叫我([^，。！？!?\n]{1,20})[。！!]?$/);
    if ((self || correction) && !/(?:什么|干嘛|为什么|怎么|吗|呢)/.test((correction || self)[1])) put(memberId, 'alias', (correction || self)[1].replace(/(?:就行|就好|即可|吧)$/, '').trim(), true);
    const other = message.text.match(/^(?:以后)?(?:大家)?(?:就)?叫(?:你|他|她)([^，。！？!?\n]{1,20})[。！!]?$/);
    const targets = message.mentions.filter(id => id !== message.selfId && isChatIdentity(id));
    if (other && targets.length === 1) put(targets[0], 'alias', other[1]);
    return changed;
}
function memberContext(facts, observations, source) {
    const members = new Map();
    for (const o of observations.slice(-40)) members.set(o.senderId, { id: o.senderId, name: o.sender, aliases: [], traits: [] });
    const scoped = facts.filter(f => f.enabled !== false && f.source === source && isChatIdentity(f.memberId));
    for (const f of scoped.slice(-100)) {
        if (!members.has(f.memberId) && members.size < 40) members.set(f.memberId, { id: f.memberId, name: f.memberId, aliases: [], traits: [] });
        const member = members.get(f.memberId); if (!member) continue;
        if (f.memberKind === 'name' && member.name === member.id) member.name = clean(f.value);
        if (f.memberKind === 'alias') member.aliases.push(clean(f.value));
        if (f.memberKind === 'preference') member.traits.push(clean(f.value));
    }
    return [...members.values()].slice(-40).map(m => ({ ...m, aliases: [...new Set(m.aliases)].slice(-5), traits: [...new Set(m.traits)].slice(-5) }));
}
function continuationReason(runtime, message) {
    const focus = runtime.state(message.sessionId).focus;
    if (!message.groupId || !focus) return '无近期参与话题';
    if (runtime.now() - focus.time > 180000) return '话题参与窗口已过期';
    if (message.replyTo || message.mentions.length) return '消息有明确指向，转入旁听';
    if (!message.text) return '无可判断的文字内容';
    return '';
}
function canContinue(runtime, message) { return continuationReason(runtime, message) === ''; }
function parseContinuation(raw) {
    try {
        const value = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        return value.respond === true && typeof value.reply === 'string' ? value.reply.trim() : '';
    } catch { return ''; }
}
module.exports = { rememberMember, memberContext, canContinue, continuationReason, parseContinuation };
