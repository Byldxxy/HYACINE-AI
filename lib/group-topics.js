/** Short-lived conversation threads, scoped to the observations of a single group. */
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const common = new Set('我们 你们 他们 这个 那个 大家 今天 现在 还是 可以 真的 什么 这样 怎么 为什么 一下 已经 刚才 有人 觉得 感觉 不是 就是 好像 知道 明天 一个 但是 因为 所以 没有 那么 一起'.split(' '));
const TOPIC_TTL = 180000;
function topicWords(text) {
    const words = new Set();
    for (const { segment, isWordLike } of segmenter.segment(String(text).slice(0, 500).normalize('NFKC').toLowerCase())) {
        if (isWordLike && segment.length >= 2 && !common.has(segment) && !/^\d+$/.test(segment)) words.add(segment);
        if (words.size === 32) break;
    }
    return [...words];
}

function assignTopic(state, message, now) {
    const recent = state.observations.filter(o => now - o.receivedAt < TOPIC_TTL).slice(-48);
    const words = topicWords(message.text ?? message.observation);
    const fresh = { topic: state.revision, words };
    if (message.replyTo) {
        const quoted = recent.findLast(o => o.id === message.replyTo || o.replyTo === message.replyTo)
            || state.sent.findLast(s => s.messageId === message.replyTo && now - s.time < TOPIC_TTL);
        return { ...fresh, topic: quoted?.topic ?? fresh.topic };
    }
    const mentions = message.mentions.filter(id => id !== message.selfId);
    let best, bestScore = 0;
    for (const other of recent) {
        // A directed exchange can continue its own branch. Naming an unrelated third
        // person explicitly must not borrow the speaker's last conversation.
        if (mentions.length && !mentions.includes(other.senderId) &&
            !(other.senderId === message.senderId && mentions.some(id => other.mentions.includes(id)))) continue;
        const overlap = words.filter(word => other.words?.includes(word)).length;
        const sameSpeaker = other.senderId === message.senderId;
        const addressed = other.mentions.includes(message.senderId);
        const score = Math.min(3, overlap) * 3 + Number(sameSpeaker) * 2 + Number(addressed);
        if (score && score >= bestScore) { best = other; bestScore = score; }
    }
    if (best) return { ...fresh, topic: best.topic };
    // Short, unaddressed follow-ups from a new speaker can answer either branch.
    const length = String(message.text ?? '').replace(/[\p{P}\p{S}\s]/gu, '').length;
    const vague = !mentions.length && !message.atMe && length > 0 && length <= 6;
    return { ...fresh, vague };
}

function candidateCurrent(state, seq, now) {
    const anchor = state.observations.find(o => o.seq === seq);
    if (!anchor || now - anchor.receivedAt >= 120000) return false;
    return !state.observations.some(o => o.seq > seq && (
        o.topic === anchor.topic || o.vague || (anchor.id != null && o.replyTo === anchor.id) ||
        o.mentions.includes(anchor.senderId)
    ));
}

function topicBackground(state, seq, now, continuation) {
    const topic = state.observations.find(o => o.seq === seq)?.topic;
    const prior = state.observations.filter(o => o.seq < seq && now - o.receivedAt < 600000 && (continuation || !o.direct));
    const nearby = prior.slice(-4);
    const related = prior.filter(o => o.topic === topic).slice(-12);
    return [...new Set([...nearby, ...related])].sort((a, b) => a.seq - b.seq).map(o => ({
        id: o.id, sender: o.sender, senderId: o.senderId, text: o.observation, mentions: o.mentions, replyTo: o.replyTo,
        sameTopic: o.topic === topic,
    }));
}

module.exports = { assignTopic, candidateCurrent, topicBackground };
