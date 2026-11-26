const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { atomicWriteJson, readJsonWithBackup, prepareJsonWrite } = require('./json-store');
const { parseSessionMessages, parseSessions, parseSummaries } = require('./schemas');

const filenameFor = id => createHash('sha256').update(id).digest('hex') + '.json';
const generationPattern = /^[0-9a-f-]{36}$/;
const isSafeId = id => typeof id === 'string' && id.length > 0 && id.length <= 500 && !Object.hasOwn(Object.prototype, id);
const apiError = (status, message) => Object.assign(new Error(message), { status, code: status === 400 ? 'invalid-data' : 'session-conflict' });

function withRowIds(messages) {
    const seen = new Set();
    for (const message of messages) {
        if (typeof message.rowId !== 'string' || !generationPattern.test(message.rowId) || seen.has(message.rowId)) message.rowId = randomUUID();
        seen.add(message.rowId);
    }
    return messages;
}
function lastMessageTime(messages) {
    const value = messages?.at(-1)?.time;
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
async function inBatches(items, fn) {
    for (let i = 0; i < items.length; i += 16) await Promise.all(items.slice(i, i + 16).map(fn));
}

function createHistoryStore(memoryFile, summaryFile) {
    const root = memoryFile + '.d';
    const manifest = path.join(root, 'current.json');
    const pending = new Set();
    let directory;
    const generationPath = name => path.join(root, name);

    async function initialize() {
        const pointer = await readJsonWithBackup(manifest, { fallback: null, strict: true, validate: value => {
            if (!generationPattern.test(value?.generation)) throw new Error('无效的会话存储版本');
            return value;
        } });
        if (pointer) {
            const active = generationPath(pointer.generation);
            await fs.access(active);
            return active;
        }
        const [sessions, summaries] = await Promise.all([
            readJsonWithBackup(memoryFile, { fallback: {}, strict: true, validate: parseSessions }),
            readJsonWithBackup(summaryFile, { fallback: {}, strict: true, validate: parseSummaries }),
        ]);
        const generation = randomUUID(), active = generationPath(generation);
        await fs.mkdir(active, { recursive: true });
        const ids = [...new Set([...Object.keys(sessions), ...Object.keys(summaries)])];
        await inBatches(ids.filter(isSafeId), async id => {
            const messages = Object.hasOwn(sessions, id) ? withRowIds(sessions[id]) : null;
            await atomicWriteJson(path.join(active, filenameFor(id)), {
                id, messages, summary: summaries[id] ?? null, lastUpdate: lastMessageTime(messages),
            }, { createBackup: false });
        });
        // Publish only after all legacy sessions have been imported.
        await atomicWriteJson(manifest, { generation }, { mirrorBackup: true });
        return active;
    }
    function activeDirectory() {
        if (!directory) directory = initialize().catch(error => { directory = undefined; throw error; });
        return directory;
    }

    async function load() {
        const active = await activeDirectory();
        const names = (await fs.readdir(active)).filter(name => /^[a-f0-9]{64}\.json(?:\.bak)?$/.test(name));
        const sessions = {}, summaries = {}, timestamps = new Map();
        await inBatches([...new Set(names.map(name => name.replace(/\.bak$/, '')))], async name => {
            const record = await readJsonWithBackup(path.join(active, name), { fallback: null, validate: value => {
                if (!isSafeId(value?.id) || filenameFor(value.id) !== name) throw new Error('会话编号不符');
                const messages = value.messages === null ? null : withRowIds(parseSessionMessages(value.messages));
                const summary = value.summary === null ? null : parseSummaries({ [value.id]: value.summary })[value.id];
                return { id: value.id, messages, summary, lastUpdate: value.lastUpdate || lastMessageTime(messages) };
            } });
            if (!record) return;
            if (record.messages !== null) sessions[record.id] = record.messages;
            if (record.summary !== null) summaries[record.id] = record.summary;
            if (record.messages !== null || record.summary !== null) timestamps.set(record.id, record.lastUpdate);
        });
        return { sessions, summaries, timestamps };
    }
    function write(id, messages, summary, lastUpdate) {
        if (!isSafeId(id)) throw apiError(400, '无效的会话编号');
        // Capture now: another segment can mutate the same assistant record before I/O starts.
        const persist = prepareJsonWrite({ id, messages: messages === null ? null : parseSessionMessages(withRowIds(messages)), summary, lastUpdate });
        // A recovery after an acknowledged reset must not restore its deleted conversation.
        const cleared = !messages?.length && !summary;
        const task = activeDirectory().then(active => persist(path.join(active, filenameFor(id)), { mirrorBackup: cleared }));
        pending.add(task);
        task.finally(() => pending.delete(task)).catch(() => {});
        return task;
    }
    function clear() {
        const previous = activeDirectory(), earlierWrites = [...pending];
        const task = previous.then(async old => {
            await Promise.allSettled(earlierWrites);
            const generation = randomUUID(), active = generationPath(generation);
            await fs.mkdir(active, { recursive: true });
            await atomicWriteJson(manifest, { generation }, { mirrorBackup: true });
            // The pointer is committed. Only this manager's superseded directory is eligible for cleanup.
            try {
                await fs.rm(old, { recursive: true, force: true });
            } catch (error) { console.warn('旧会话存储清理失败:', error.message); }
            return active;
        });
        directory = task.catch(() => previous);
        return task;
    }
    return { load, write, clear };
}

function applyMessageEdits(messages, operations) {
    if (!Array.isArray(operations) || operations.length > 5000) throw apiError(400, '无效的消息编辑列表');
    const byId = new Map(messages.map(row => [row.rowId, row]));
    const edits = new Map();
    for (const op of operations) {
        if (!op || typeof op.id !== 'string' || typeof op.before !== 'string' || !(op.after === null || typeof op.after === 'string' && op.after.length <= 200000) || edits.has(op.id)) {
            throw apiError(400, '无效或重复的消息操作');
        }
        if (byId.get(op.id)?.content !== op.before) throw apiError(409, '消息已被修改或移除，请刷新后重试');
        edits.set(op.id, op.after);
    }
    return messages.flatMap(row => !edits.has(row.rowId) ? [row] : edits.get(row.rowId) === null ? [] : [{ ...row, content: edits.get(row.rowId) }]);
}

module.exports = { createHistoryStore, withRowIds, isSafeId, lastMessageTime, applyMessageEdits, apiError };
