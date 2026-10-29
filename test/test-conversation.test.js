const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createConversationRuntime } = require('../lib/conversation-runtime');
const { createMemoryManager } = require('../lib/memory');
const { createTestConversation } = require('../lib/test-conversation');

const tick = () => new Promise(resolve => setImmediate(resolve));
const completion = content => ({ choices: [{ message: { content } }] });
function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
async function fixture(t, complete, overrides = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-test-chat-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const memory = createMemoryManager({
        MEMORY_FILE: path.join(directory, 'memory.json'),
        SUMMARY_FILE: path.join(directory, 'summary.json'),
        PERSISTENT_FILE: path.join(directory, 'persistent.json'),
    });
    const runtime = createConversationRuntime();
    const config = { apiKey: 'test-only', shortMem: 10, ...overrides };
    const conversation = createTestConversation({ runtime, memory, getConfig: () => config, complete });
    return { memory, runtime, conversation, directory };
}

test('same test session serializes requests while another scenario remains independent', async t => {
    const gate = deferred(), calls = [];
    const f = await fixture(t, async (_config, messages) => {
        calls.push(messages);
        return calls.length === 1 ? gate.promise : completion('后续回答');
    });
    const first = f.conversation.chat({ message: '第一个问题' });
    const second = f.conversation.chat({ message: '第二个问题' });
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(f.memory.getSessions().test_default, undefined);
    await f.conversation.chat({ message: '另一个场景', scenario: 'group' });
    assert.equal(calls.length, 2);
    gate.resolve(completion('第一轮回答'));
    assert.deepEqual(await first, { reply: '第一轮回答', isImage: false });
    await second;
    assert.deepEqual(calls[2].filter(m => m.role !== 'system').map(m => m.content), [
        '[发送者: 测试用户(000000)] 第一个问题', '第一轮回答', '[发送者: 测试用户(000000)] 第二个问题',
    ]);
    assert.equal(f.memory.getSessions().test_default.length, 4);
    await f.memory.loadAll();
    assert.equal(f.memory.getSessions().test_default.length, 4);
    assert.equal(f.memory.getSessions().test_group.length, 2);
});

test('provider failure leaves prior history intact and queued recovery excludes the failed input', async t => {
    const gate = deferred(), calls = [];
    const f = await fixture(t, async (_config, messages) => {
        calls.push(messages);
        return calls.length === 1 ? gate.promise : completion('恢复回答');
    }, { shortMem: 2 });
    const original = [
        { role: 'user', content: '更早问题' }, { role: 'assistant', content: '更早回答' },
        { role: 'user', content: '原问题' }, { role: 'assistant', content: '原回答' },
    ];
    f.memory.setSession('test_default', original);
    const failed = f.conversation.chat({ message: '失败的问题' });
    const failure = assert.rejects(failed, /provider unavailable/);
    const recovery = f.conversation.chat({ message: '重新提问' });
    await tick();
    assert.deepEqual(f.memory.getSessions().test_default, original);
    gate.reject(new Error('provider unavailable'));
    await failure;
    await recovery;
    assert.doesNotMatch(JSON.stringify(calls[1]), /失败的问题/);
    assert.match(JSON.stringify(calls[1]), /原回答/);
    assert.doesNotMatch(JSON.stringify(f.memory.getSessions()), /失败的问题/);

    const empty = await fixture(t, async () => { throw new Error('provider unavailable'); });
    await assert.rejects(empty.conversation.chat({ message: '失败的新会话' }), /provider unavailable/);
    assert.deepEqual(empty.memory.getSessions(), {});
});

test('deletion persists history and summary removal, cancels active and queued work, and allows a fresh turn', async t => {
    const gate = deferred(), calls = [];
    const f = await fixture(t, async (_config, messages) => {
        calls.push(messages);
        return calls.length === 1 ? gate.promise : completion('新会话回答');
    });
    f.memory.setSession('test_group', [{ role: 'assistant', content: '旧历史' }]);
    f.memory.setSummary('test_group', '旧摘要');
    await Promise.all([f.memory.saveMemoryToDisk(), f.memory.saveSummariesToDisk()]);
    const first = f.conversation.chat({ scenario: 'group', message: '正在生成' });
    const second = f.conversation.chat({ scenario: 'group', message: '还在排队' });
    const outdated = Promise.allSettled([first, second]);
    await tick();
    await f.conversation.reset('group');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'memory.json'))), {});
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'summary.json'))), {});
    const fresh = f.conversation.chat({ scenario: 'group', message: '删除后提问' });
    gate.resolve(completion('迟到的旧回答'));
    for (const result of await outdated) {
        assert.equal(result.status, 'rejected');
        assert.equal(result.reason.code, 'conversation-reset');
    }
    await fresh;
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(calls[1]), /旧历史|旧摘要|正在生成|还在排队/);
    await f.memory.loadAll();
    assert.deepEqual(f.memory.getSummaries(), {});
    assert.deepEqual(f.memory.getSessions().test_group.map(m => m.content), [
        '[发送者: 测试用户(000000)] 删除后提问', '新会话回答',
    ]);
});

test('shared runtime reset protects manual edits and global deletion from a pending test response', async t => {
    for (const global of [false, true]) {
        const gate = deferred();
        const f = await fixture(t, async () => gate.promise);
        const pending = f.conversation.chat({ message: '旧问题' });
        const rejected = assert.rejects(pending, { code: 'conversation-reset' });
        await tick();
        f.runtime.reset(global ? undefined : 'test_default');
        if (!global) f.memory.setSession('test_default', [{ role: 'assistant', content: '手动修正' }]);
        gate.resolve(completion('旧回答'));
        await rejected;
        assert.deepEqual(f.memory.getSessions(), global ? {} : {
            test_default: [{ role: 'assistant', content: '手动修正' }],
        });
    }
});

test('failed persistence rolls back the turn without restoring content after a concurrent deletion', async t => {
    for (const reset of [false, true]) {
        const gate = deferred();
        const f = await fixture(t, async () => completion('待保存回答'));
        const original = [{ role: 'assistant', content: '旧记录' }];
        f.memory.setSession('test_default', original);
        const save = f.memory.saveMemoryToDisk;
        let writes = 0;
        f.memory.saveMemoryToDisk = () => ++writes === 1 ? gate.promise : save();
        const pending = f.conversation.chat({ message: '新问题' });
        const rejected = assert.rejects(pending, /disk unavailable/);
        await tick();
        if (reset) await f.conversation.reset('default');
        gate.reject(new Error('disk unavailable'));
        await rejected;
        assert.deepEqual(f.memory.getSessions(), reset ? {} : { test_default: original });
    }
});

test('image commands preserve response fields, original prompt policy, and master identity', async t => {
    for (const optimizeImgPrompt of [false, true]) {
        const reply = '[CMD:IMAGE_GEN] refined English prompt';
        let sentMessages;
        const f = await fixture(t, async (_config, messages) => {
            sentMessages = messages;
            return completion(reply);
        }, { optimizeImgPrompt });
        const result = await f.conversation.chat({ message: '请生成雨中的图片', isMaster: true });
        const expectedPrompt = optimizeImgPrompt ? 'refined English prompt, masterpiece, best quality' : '请生成雨中的图片';
        assert.deepEqual(result, {
            reply: optimizeImgPrompt ? reply : `[CMD:IMAGE_GEN] ${expectedPrompt}`,
            isImage: true,
            imagePrompt: expectedPrompt,
        });
        assert.equal(f.memory.getSessions().test_default.at(-1).content,
            optimizeImgPrompt ? reply : '[已按上一条用户原始要求生成图片]');
        assert.match(sentMessages.at(-1).content, /主人\/Master \(测试用户\)/);
    }
});
