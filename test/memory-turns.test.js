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
    await manager.extractFacts({ persistMem: true }, [{ role: 'user', content: '用户20：我喜欢茶' }, { role: 'assistant', content: 'invented-assistant-fact' }], 'user_20');
    assert.doesNotMatch(requests[1].messages[1].content, /invented-assistant-fact/);
    assert.deepEqual(manager.getPersistentMemory().map(f => f.fact), ['用户20喜欢茶']);
    await manager.extractFacts({ persistMem: true }, [{ role: 'user', content: 'again' }], 'user_20'); assert.equal(requests.length, 2);
});
test('clearing facts while extraction is pending cannot resurrect removed data', async t => {
    let release; const gate = new Promise(resolve => { release = resolve; }); const manager = await setup(t, () => gate);
    const pending = manager.extractFacts({ persistMem: true }, [{ role: 'user', content: 'fact' }], 'user_1');
    manager.setPersistentMemory([]); release('["obsolete"]'); await pending; assert.deepEqual(manager.getPersistentMemory(), []);
});
test('invalidated conversation extraction is discarded and existing manual facts are not pruned', async t => {
    const manager = await setup(t, async () => '["automatic"]');
    const original = Array.from({ length: 1001 }, (_, i) => ({ fact: `manual${i}`, source: 'manual', time: '' })); manager.setPersistentMemory(original);
    await manager.extractFacts({ persistMem: true }, [{ role: 'user', content: 'new' }], 'user_1'); assert.equal(manager.getPersistentMemory().length, 1001);
    manager.setPersistentMemory([]);
    await manager.extractFacts({ persistMem: true }, [{ role: 'user', content: 'new' }], 'user_2', null, null, () => false); assert.deepEqual(manager.getPersistentMemory(), []);
});

test('structured member memory requires message evidence, persists metadata and rejects unrelated identities', async t => {
    const manager = await setup(t, async () => JSON.stringify([
        '用户40喜欢冒险游戏',
        { memberId: '20', kind: 'preference', value: '喜欢策略游戏', evidenceId: 'm1' },
        { memberId: '30', kind: 'alias', value: '老猫', evidenceId: 'm2' },
        { memberId: '40', kind: 'preference', value: '不存在的成员', evidenceId: 'm1' },
        { memberId: '20', kind: 'alias', value: '无来源', evidenceId: 'missing' }
    ]));
    await manager.extractFacts({ persistMem: true }, [
        { role: 'user', senderId: '20', messageId: 'm1', content: '我喜欢策略游戏' },
        { role: 'user', senderId: '20', messageId: 'm2', mentions: ['30'], content: '老猫来玩' }
    ], 'group_1');
    assert.deepEqual(manager.getPersistentMemory().map(f => f.memberId), ['20', '30']);
    await manager.loadAll(); assert.equal(manager.getPersistentMemory()[0].memberKind, 'preference');
});

test('member updates in another group do not discard in-flight learning', async t => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const manager = await setup(t, () => gate);
    const pending = manager.extractFacts({ persistMem: true }, [
        { role: 'user', senderId: '20', messageId: 'm1', content: '我喜欢策略游戏' }
    ], 'group_1');
    manager.observeMember({ sessionId: 'group_2', groupId: '2', senderId: '30', sender: '阿猫', text: '来了', mentions: [], id: 'm2' });
    await manager.savePersistentMemoryToDisk();
    release(JSON.stringify([{ memberId: '20', kind: 'preference', value: '喜欢策略游戏', evidenceId: 'm1' }]));
    await pending;
    assert.ok(manager.getPersistentMemory().some(f => f.source === 'group_1' && f.memberId === '20' && f.value === '喜欢策略游戏'));
    assert.ok(manager.getPersistentMemory().some(f => f.source === 'group_2' && f.memberId === '30' && f.value === '阿猫'));
});

test('same-group corrections cannot be overwritten by older extraction results', async t => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const manager = await setup(t, () => gate);
    const pending = manager.extractFacts({ persistMem: true }, [
        { role: 'user', senderId: '20', messageId: 'm1', content: '叫我老王' }
    ], 'group_1');
    manager.observeMember({ sessionId: 'group_1', groupId: '1', senderId: '20', sender: '王', text: '叫我阿王', mentions: [], id: 'm2' });
    await manager.savePersistentMemoryToDisk();
    release(JSON.stringify([{ memberId: '20', kind: 'alias', value: '老王', evidenceId: 'm1' }]));
    await pending;
    assert.deepEqual(manager.getPersistentMemory().filter(f => f.memberKind === 'alias').map(f => f.value), ['阿王']);
});

test('learned glossary and stable character preferences persist through the existing memory file', async t => {
    const manager = await setup(t, async () => JSON.stringify([
        { kind: 'slang', subject: '开摆', fact: '开摆：群里表示暂时休息', evidenceIds: ['u'] },
        { kind: 'bot_preference', subject: '游戏', fact: '喜欢解谜游戏', evidenceIds: ['a', 'b'] }
    ]));
    await manager.extractFacts({ persistMem: true }, [
        { role: 'user', senderId: '20', messageId: 'u', content: '记住，我们群开摆是暂时休息' },
        { role: 'assistant', messageIds: ['a'], content: '我喜欢解谜游戏' },
        { role: 'assistant', messageIds: ['b'], content: '我更喜欢解谜，有想通问题的乐趣' }
    ], 'group_1');
    await manager.loadAll(); assert.deepEqual(manager.getPersistentMemory().map(f => f.kind), ['slang', 'bot_preference']);
});
