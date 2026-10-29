/** Character budgets for optional context. Current input and configured persona stay intact. */
const CONTEXT_LIMITS = Object.freeze({ history: 16000, memory: 5000, background: 4000, members: 3000, topics: 2400 });

function recentHistory(messages, budget = CONTEXT_LIMITS.history) {
    if (!messages.length) return [];
    // The final message is the request (including structured proactive observations).
    const current = messages.at(-1);
    const selected = [];
    let remaining = budget, truncated = false;
    for (let i = messages.length - 2; i >= 0; i--) {
        const length = String(messages[i].content || '').length;
        if (length > remaining) { truncated = true; break; }
        selected.unshift(messages[i]);
        remaining -= length;
    }
    // Do not introduce an old assistant answer after dropping its question.
    if (truncated) while (selected[0]?.role === 'assistant') selected.shift();
    return [...selected, current];
}

function boundedRecords(records, budget, { newestFirst = false } = {}) {
    const selected = [];
    let remaining = budget - 2;
    for (const record of newestFirst ? [...records].reverse() : records) {
        const cost = JSON.stringify(record).length + 1;
        if (cost > remaining) continue;
        selected.push(record);
        remaining -= cost;
    }
    return newestFirst ? selected.reverse() : selected;
}

module.exports = { CONTEXT_LIMITS, recentHistory, boundedRecords };
