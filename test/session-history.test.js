const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMemoryManager } = require('../lib/memory');
const { createConversationRuntime } = require('../lib/conversation-runtime');
const { registerHistoryApi } = require('../lib/session-history-api');

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-history-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const paths = { MEMORY_FILE: path.join(directory, 'sessions.json'), SUMMARY_FILE: path.join(directory, 'summary.json'), PERSISTENT_FILE: path.join(directory, 'facts.json') };
    return { paths, open: () => createMemoryManager(paths) };
}

test('legacy data imports once, writes touch only the active session, and a clear orders concurrent saves across restart', async t => {
    const { paths, open } = await fixture(t);
    const legacy = {
        group_a: [{ role: 'user', content: '早先消息' }],
        group_b: [{ role: 'assistant', content: '另一群', time: '2026-01-01T10:00:00.000Z' }],
    };
    await fs.writeFile(paths.MEMORY_FILE, JSON.stringify(legacy));
    await fs.writeFile(paths.SUMMARY_FILE + '.bak', JSON.stringify({ group_a: '旧摘要' }));
    const manager = open();
    await manager.loadAll();
    assert.equal(manager.getLastUpdate('group_a'), null);
    assert.equal(manager.getLastUpdate('group_b'), legacy.group_b[0].time);
    assert.equal(manager.getSummaries().group_a, '旧摘要');
    const originalId = manager.getSessionMessages('group_a')[0].rowId;
    manager.getSessions().group_a.push({ role: 'assistant', content: '第一段' });
    await manager.saveMemoryToDisk('group_a');
    const reopened = open();
    await reopened.loadAll();
    assert.equal(reopened.getSessionMessages('group_a')[0].rowId, originalId);
    assert.equal(reopened.getLastUpdate('group_a'), manager.getLastUpdate('group_a'));
    assert.equal(reopened.getLastUpdate('group_b'), legacy.group_b[0].time);
    const root = paths.MEMORY_FILE + '.d';
    const { generation } = JSON.parse(await fs.readFile(path.join(root, 'current.json')));
    const shards = await fs.readdir(path.join(root, generation));
    assert.equal(shards.filter(name => name.endsWith('.bak')).length, 1);
    const earlier = manager.saveMemoryToDisk('group_a');
    const clear = manager.clearHistory();
    manager.setSession('group_new', [{ role: 'user', content: '清空后的消息' }]);
    await Promise.all([earlier, clear, manager.saveMemoryToDisk('group_new')]);
    const fresh = open();
    await fresh.loadAll();
    assert.deepEqual(Object.keys(fresh.getSessions()), ['group_new']);
    assert.equal(fresh.getSessions().group_new[0].content, '清空后的消息');
    assert.deepEqual(fresh.getSummaries(), {});
});

test('history routes merge edits by ID, reject conflicting batches atomically and protect conditional replacements', async t => {
    const { paths, open } = await fixture(t);
    const memory = open(), routes = new Map();
    const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (url, fn) => routes.set(method + url, fn)]));
    registerHistoryApi(app, { memory, runtime: createConversationRuntime(), ready: memory.loadAll(), log() {},
        sendManagementError(res, error) { if (error.code !== 'invalid-data') throw error; res.status(400).json({ error: error.message }); } });
    async function call(method, route, body, query = {}, tag) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; }, set(_, etag) { this.tag = etag; return this; } };
        await routes.get(method + '/api/' + route + '/:sessionId')({ params: { sessionId: 'group_a' }, get: () => tag, body, query }, res);
        return res;
    }
    const original = [{ role: 'user', content: '同文' }, { role: 'assistant', content: '同文' }];
    assert.equal((await call('post', 'memory', original)).code, 200);
    const baseline = await call('get', 'memory');
    const [first, second] = baseline.data;
    assert.notEqual(first.rowId, second.rowId);
    memory.getSessions().group_a.push({ role: 'user', content: '后来消息' });
    await memory.saveMemoryToDisk('group_a');
    assert.equal((await call('post', 'memory', original)).code, 428);
    assert.equal((await call('post', 'memory', original, {}, baseline.tag)).code, 409);
    const patch = operations => call('patch', 'memory', { operations }, { limit: '1', offset: '99' });
    const update = await patch([{ id: first.rowId, before: '同文', after: '已修订' }]);
    assert.equal(update.code, 200);
    assert.equal(update.data.total, 3);
    assert.equal(update.data.offset, 2);
    assert.equal(update.data.messages[0].content, '后来消息');
    const conflict = await patch([{ id: second.rowId, before: '同文', after: null }, { id: first.rowId, before: '同文', after: '过期修改' }]);
    assert.equal(conflict.code, 409);
    assert.deepEqual(memory.getSessions().group_a.map(row => row.content), ['已修订', '同文', '后来消息']);
    assert.equal((await call('patch', 'summary', { before: '', after: '第一版' })).code, 200);
    assert.equal((await call('patch', 'summary', { before: '', after: '过期' })).code, 409);
    const summary = await call('get', 'summary');
    assert.equal((await call('post', 'summary', { summary: '' }, {}, summary.tag)).code, 200);
    assert.equal((await call('delete', 'memory')).code, 200);
    const root = paths.MEMORY_FILE + '.d';
    const { generation } = JSON.parse(await fs.readFile(path.join(root, 'current.json')));
    const active = path.join(root, generation);
    const primary = (await fs.readdir(active)).find(name => name.endsWith('.json'));
    await fs.writeFile(path.join(active, primary), '{');
    await memory.loadAll();
    assert.equal(memory.getSessions().group_a, undefined);
    assert.equal(memory.getSummaries().group_a, undefined);
});
