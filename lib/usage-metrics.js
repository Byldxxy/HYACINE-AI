const { atomicWriteJson, readJsonWithBackup } = require('./json-store');

const kinds = ['direct', 'continuation', 'proactive', 'learning', 'summary'];
const outcomes = ['sent', 'silent', 'stale', 'error', 'completed'];
const counters = ['turns', 'calls', 'unknownUsage', 'inputTokens', 'outputTokens', 'queued', 'queueMs', 'modelMs', 'deliveries', 'deliveryMs', ...outcomes];
const zero = () => Object.fromEntries(counters.map(key => [key, 0]));
const dayOf = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

// One row per calendar day, group and task type. Never store prompts, responses or member IDs.
function createUsageMetrics({ file, now = Date.now } = {}) {
    const days = new Map();
    let timer, dirty = false, pending = Promise.resolve();
    function prune() {
        const date = new Date(now());
        const today = dayOf(date);
        date.setDate(date.getDate() - 6);
        const oldest = dayOf(date);
        for (const day of days.keys()) if (day < oldest || day > today) days.delete(day);
    }
    function bucket(day, group, kind) {
        if (!days.has(day)) days.set(day, new Map());
        const groups = days.get(day);
        if (groups.size >= 256 && !groups.has(group)) group = 'other';
        if (!groups.has(group)) groups.set(group, new Map());
        const entries = groups.get(group);
        if (!entries.has(kind)) entries.set(kind, zero());
        return entries.get(kind);
    }
    function snapshot() {
        prune();
        const rows = [];
        for (const [date, groups] of days) for (const [group, entries] of groups) {
            for (const [kind, totals] of entries) rows.push({ date, group, kind, ...totals });
        }
        return { today: dayOf(new Date(now())), rows };
    }
    async function load() {
        if (!file) return;
        const rows = await readJsonWithBackup(file, { fallback: [], validate(value) {
            if (!Array.isArray(value) || value.length > 10000 || !value.every(row => row && /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
                typeof row.group === 'string' && row.group.length <= 256 && kinds.includes(row.kind) &&
                counters.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0))) throw new Error('调用统计格式无效');
            return value;
        } });
        for (const row of rows) {
            const totals = bucket(row.date, row.group, row.kind);
            for (const key of counters) totals[key] += row[key];
        }
        prune();
    }
    function schedule() {
        if (!file || timer) return;
        timer = setTimeout(() => { timer = undefined; void flush().catch(error => console.warn('调用统计保存失败:', error.message)); }, 15000);
        timer.unref?.();
    }
    function flush() {
        clearTimeout(timer); timer = undefined;
        if (!file || !dirty) return pending;
        dirty = false;
        pending = atomicWriteJson(file, snapshot().rows).catch(error => { dirty = true; schedule(); throw error; });
        return pending;
    }
    function start(kind, sessionId, queuedAt) {
        if (!kinds.includes(kind)) throw new Error('未知调用类型');
        const begun = now();
        let group = 'private';
        if (sessionId?.startsWith('group_')) group = /^group_[A-Za-z0-9_-]{1,250}$/.test(sessionId) ? sessionId : 'other';
        const delta = zero();
        if (Number.isFinite(queuedAt)) { delta.queued = 1; delta.queueMs = Math.max(0, begun - queuedAt); }
        let finished = false;
        return {
            async model(work) {
                const at = now();
                delta.calls++;
                let reported = false;
                try {
                    const result = await work();
                    const usage = result?.usage;
                    const input = usage?.prompt_tokens ?? usage?.input_tokens, output = usage?.completion_tokens ?? usage?.output_tokens;
                    if (Number.isSafeInteger(input) && input >= 0) delta.inputTokens += input;
                    if (Number.isSafeInteger(output) && output >= 0) delta.outputTokens += output;
                    reported = [input, output].every(n => Number.isSafeInteger(n) && n >= 0);
                    return result;
                } finally {
                    if (!reported) delta.unknownUsage++;
                    delta.modelMs += Math.max(0, now() - at);
                }
            },
            async delivery(work) {
                const at = now(); delta.deliveries++;
                try { return await work(); }
                finally { delta.deliveryMs += Math.max(0, now() - at); }
            },
            finish(outcome) {
                if (finished) return;
                finished = true;
                delta.turns++; delta[outcomes.includes(outcome) ? outcome : 'error']++;
                const totals = bucket(dayOf(new Date(begun)), group, kind);
                for (const key of counters) totals[key] += delta[key];
                dirty = true; schedule();
            },
        };
    }
    return { start, snapshot, load, flush };
}

module.exports = { createUsageMetrics };
