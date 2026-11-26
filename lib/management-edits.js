const { isDeepStrictEqual } = require('node:util');

function invalid(message) {
    return Object.assign(new Error(message), { code: 'invalid-data' });
}

function conflict(message) {
    return Object.assign(new Error(message), { code: 'conflict' });
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Apply the batch to a detached index. A failed comparison cannot commit earlier edits.
function editFacts(items, operations) {
    if (!Array.isArray(operations) || operations.length > 10000) throw invalid('长期记忆修改格式无效');
    const rows = new Map(items.map(row => [row.rowId, row]));
    const touched = new Set();
    for (const op of operations) {
        if (!isObject(op) || typeof op.id !== 'string' || !/^[\w-]{1,128}$/.test(op.id) || touched.has(op.id) ||
            (op.before == null && op.after == null) ||
            [op.before, op.after].some(row => row != null && (!isObject(row) || row.rowId !== op.id))) throw invalid('长期记忆条目标识无效');
        touched.add(op.id);
        const current = rows.get(op.id);
        if (!isDeepStrictEqual(current, op.before ?? undefined)) throw conflict('这条长期记忆已更新，请核对最新内容');
        if (op.after == null) rows.delete(op.id);
        else rows.set(op.id, op.after);
    }
    return [...rows.values()];
}

module.exports = { conflict, invalid, isObject, editFacts };
