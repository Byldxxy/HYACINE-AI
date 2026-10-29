/** Short-lived expression continuity, never a user diagnosis or durable personality fact. */
const { createHash } = require('node:crypto');
const MOODS = new Set(['calm', 'playful', 'warm', 'concerned', 'curious']);
const LABELS = { calm: '平静', playful: '轻松接梗', warm: '温和亲近', concerned: '认真关切', curious: '好奇' };
function createAffect({ now = Date.now } = {}) {
    const states = new Map(); let epoch = 0;
    const key = (message, config, generation) => JSON.stringify([message.sessionId, message.senderId, generation, createHash('sha256').update(`${config.currentPersonaId || ''}\n${config.systemPrompt || ''}`).digest('hex').slice(0, 16)]);
    return {
        context(message, config, generation) {
            if (!config.enableAffect) return '';
            const previous = states.get(key(message, config, generation));
            const minutes = Math.max(5, Math.min(120, config.affectHalfLife || 30));
            const strength = previous ? Math.pow(.5, Math.max(0, now() - previous.time) / (minutes * 60000)) : 0;
            return `【表达连续性】这只是你与当前成员的短期表达倾向，不代表对方的心理状态，不改变固定人设或长期偏好。${previous && strength >= .25 ? `上一轮倾向：${LABELS[previous.mood]}，影响强度${strength.toFixed(2)}。` : '当前无延续倾向。'}\n理解梗、反话和情绪，认真求助时先回应实际需要；不要凭关键词诊断，不因别人的玩笑赌气，不宣称现实生活经历。只有当前真人原文有明确依据时，可在回复末尾附加 [[affect:{"mood":"calm|playful|warm|concerned|curious","evidence":"当前消息中连续的4至80字原文"}]]；不确定就省略。续聊采用JSON时，把标记放进reply字符串，不改变外层格式。标记是内部控制，不解释给群友。`;
        },
        parse(raw, message) {
            let candidate = null;
            const matches = [...String(raw).matchAll(/\[\[affect:(.{1,512}?)\]\]/g)];
            if (matches.length === 1) {
                try {
                    const value = JSON.parse(matches[0][1]);
                    if (MOODS.has(value.mood) && typeof value.evidence === 'string' && value.evidence.length >= 4 && value.evidence.length <= 80 && message.text.includes(value.evidence)) candidate = { mood: value.mood };
                } catch { /* Invalid controls are removed, not applied. */ }
            }
            const text = String(raw).replace(/\[\[affect:[\s\S]*?(?:\]\]|$)/g, '').trim();
            return { text, candidate };
        },
        commit(candidate, message, config, generation, expectedEpoch = epoch) {
            if (expectedEpoch !== epoch || !config.enableAffect || !candidate || !MOODS.has(candidate.mood)) return;
            const id = key(message, config, generation);
            if (states.size >= 1000 && !states.has(id)) states.delete(states.keys().next().value);
            states.set(id, { mood: candidate.mood, time: now(), sessionId: message.sessionId, senderId: message.senderId });
        },
        generation: () => epoch,
        clear() { epoch++; states.clear(); },
        status() {
            for (const [id, state] of states) if (now() - state.time > 8 * 3600000) states.delete(id);
            return { count: states.size };
        },
    };
}
module.exports = { createAffect };
