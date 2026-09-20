const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createMemoryManager } = require('../lib/memory');
async function setup(t, respond) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-facts-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return createMemoryManager({ MEMORY_FILE: path.join(dir, 'sessions.json'), SUMMARY_FILE: path.join(dir, 'summary.json'), PERSISTENT_FILE: path.join(dir, 'facts.json') }, {
        createClient: () => ({ chat: { completions: { create: async p => ({ choices: [{ message: { content: await respond(p) } }] }) } } }),
    });
}
test('summary request merges old context; fact extraction ignores assistant claims and validates facts', async t => {
    const requests = [], manager = await setup(t, async p => { requests.push(p); return requests.length === 1 ? '合并摘要' : '["用户20喜欢茶",42,"",{"fact":"bad"}]'; });
    assert.equal(await manager.summarizeMessages({}, [{ role: 'user', content: '新偏好' }], '旧摘要'), '合并摘要');
    assert.match(requests[0].messages[1].content, /旧摘要/);
    await manager.extractFacts({ persistMem: true }, [{ role: 'user', content: '用户20：我喜欢茶' }, { role: 'assistant', content: 'invented-assistant-fact' }], 'group_1');
    assert.doesNotMatch(requests[1].messages[1].content, /invented-assistant-fact/);
    assert.deepEqual(manager.getPersistentMemory().map(f => f.fact), ['用户20喜欢茶']);
    await manager.extractFacts({ persistMem: true }, [{ role: 'user', content: 'again' }], 'group_1'); assert.equal(requests.length, 2);
});
test('clearing facts while extraction is pending cannot resurrect removed data', async t => {
    let release; const gate = new Promise(resolve => { release = resolve; }); const manager = await setup(t, () => gate);
    const pending = manager.extractFacts({ persistMem: true }, [{ role: 'user', content: 'fact' }], 'group_1');
    manager.setPersistentMemory([]); release('["obsolete"]'); await pending; assert.deepEqual(manager.getPersistentMemory(), []);
});
test('invalidated conversation extraction is discarded and existing manual facts are not pruned', async t => {
    const manager = await setup(t, async () => '["automatic"]');
    const original = Array.from({ length: 1001 }, (_, i) => ({ fact: `manual${i}`, source: 'manual', time: '' })); manager.setPersistentMemory(original);
    await manager.extractFacts({ persistMem: true }, [{ role: 'user', content: 'new' }], 'group_1'); assert.equal(manager.getPersistentMemory().length, 1001);
    manager.setPersistentMemory([]);
    await manager.extractFacts({ persistMem: true }, [{ role: 'user', content: 'new' }], 'group_2', null, null, () => false); assert.deepEqual(manager.getPersistentMemory(), []);
});
