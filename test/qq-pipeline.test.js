const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMessage } = require('../lib/message-chain');
const { createConversationRuntime, similarReply } = require('../lib/conversation-runtime');
const { createMessageHandler } = require('../lib/message-handler');
const { createProactiveEngine, parseDecision } = require('../lib/proactive');
const { createQQTransport } = require('../lib/qq-transport');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const completion = content => ({ choices: [{ message: { content } }] });
function fixture(extra = {}) {
    let clock = 100000;
    const runtime = createConversationRuntime({ now: () => clock }), sessions = {}, summaries = {}, calls = [], sends = [], logs = [];
    const config = { botQQ: '999', apiKey: 'test-only', shortMem: 10, enableProactive: true, proactiveCooldown: 600, proactiveThreshold: .6, ...extra };
    const memory = { getSessions: () => sessions, getSummaries: () => summaries, getPersistentMemory: () => [],
        setSession: (id, items) => { sessions[id] = structuredClone(items); }, setSummary: (id, s) => { summaries[id] = s; },
        saveMemoryToDisk: async () => {}, saveSummariesToDisk: async () => {}, summarizeMessages: async () => '', extractFacts: async () => {} };
    const ws = { readyState: 1, selfId: '999' };
    const deps = { config, getConfig: () => config, runtime, memory, napcatConnections: [ws], paths: {}, sleep: async () => {},
        broadcastLog: (_w, kind, text) => logs.push({ kind, text }),
        requestChatCompletion: async (_config, messages) => { calls.push(messages); return completion('新的答复。'); },
        sendToQQ: async (_ws, text) => { sends.push(text); return { messageId: String(sends.length + 100) }; } };
    return { deps, runtime, memory, config, ws, sessions, calls, sends, logs, advance: ms => { clock += ms; } };
}
function event(id, text = '问题', at = true, extra = {}) { return { post_type: 'message', message_type: 'group', message_id: id, group_id: 10, user_id: 20, self_id: 999,
    sender: { card: '群名片', nickname: '昵称' }, message: [...(at ? [{ type: 'at', data: { qq: '999' } }] : []), { type: 'text', data: { text } }], ...extra }; }
function observations(f, start = 1) { for (let i = start; i < start + 3; i++) f.runtime.observe(normalizeMessage(event(i, `新的话题${i}`, false), f.config)); }

test('structured chain works without raw_message, CQ fallback preserves escaped text and reply links', () => {
    const m = normalizeMessage(event(1, '你好'), { botQQ: '999' }); assert.equal(m.atMe, true); assert.equal(m.sender, '群名片');
    const cq = normalizeMessage(event(2, '', false, { message: undefined, raw_message: '[CQ:reply,id=31][CQ:at,qq=999] A&#91;B&#93;&amp;C[CQ:image,file=https://example.com/a.png]' }), { botQQ: '999' });
    assert.equal(cq.text, 'A[B]&C'); assert.equal(cq.replyTo, '31'); assert.equal(cq.imageCount, 1); assert.equal(cq.images.length, 1);
    assert.equal(normalizeMessage(event(3, '我自己', true, { user_id: 999 }), {}), null);
    assert.equal(normalizeMessage(event(4, '已发送', true, { post_type: 'message_sent' }), {}), null);
});
test('duplicate events on different sockets and self echoes do not create extra requests or observations', async () => {
    const f = fixture(), handle = createMessageHandler(f.deps);
    await Promise.all([handle(f.ws, event(1)), handle({ ...f.ws }, event(1)), handle(f.ws, event(2, 'echo', true, { user_id: 999 }))]);
    assert.equal(f.calls.length, 1); assert.equal(f.sends.length, 1); assert.equal(f.runtime.state('group_10').revision, 1);
});
test('normal reply includes passive conversation, known quoted replies trigger without @, and metadata stays out of provider messages', async () => {
    const f = fixture(), handle = createMessageHandler(f.deps);
    await handle(f.ws, event(1, '我们在讨论缓存过期', false)); await handle(f.ws, event(2, '怎么办'));
    assert.match(JSON.stringify(f.calls[0]), /缓存过期/);
    await handle(f.ws, event(3, '', false, { message: [{ type: 'reply', data: { id: '101' } }, { type: 'text', data: { text: '具体怎么做' } }] }));
    assert.equal(f.calls.length, 2); assert.ok(f.calls.flat().every(m => Object.keys(m).every(k => ['role', 'content'].includes(k))));
});
test('split delivery holds the queue through acknowledgements, partial failure retains only confirmed content', async () => {
    const f = fixture({ enableSplit: true }), gate = deferred(); let count = 0;
    f.deps.requestChatCompletion = async () => { count++; return completion(count === 1 ? '第一句。第二句。' : '下一轮。'); };
    f.deps.sendToQQ = async (_ws, text) => { f.sends.push(text); if (text === '第一句。') await gate.promise; if (text === '第二句。') throw new Error('发送失败'); return { messageId: f.sends.length }; };
    const handle = createMessageHandler(f.deps), first = handle(f.ws, event(1, '第一个问题')), second = handle(f.ws, event(2, '第二个问题'));
    await tick(); assert.equal(count, 1); assert.equal(f.sessions.group_10, undefined);
    gate.resolve(); await Promise.all([first, second]);
    assert.deepEqual(f.sends, ['第一句。', '第二句。', '下一轮。']);
    assert.deepEqual(f.sessions.group_10.filter(m => m.role === 'assistant').map(m => m.content), ['第一句。', '下一轮。']);
});
test('reset invalidates a model result and pending split segments', async () => {
    const f = fixture(), gate = deferred(); f.deps.requestChatCompletion = async () => gate.promise;
    const pending = createMessageHandler(f.deps)(f.ws, event(1)); await tick(); f.runtime.reset('group_10'); gate.resolve(completion('过期内容')); await pending;
    assert.equal(f.sends.length, 0); assert.equal(f.sessions.group_10, undefined);
    const g = fixture({ enableSplit: true }); let sleeps = 0;
    g.deps.requestChatCompletion = async () => completion('第一句。第二句。');
    g.deps.sleep = async () => { if (++sleeps === 2) g.runtime.reset('group_10'); };
    await createMessageHandler(g.deps)(g.ws, event(1)); assert.deepEqual(g.sends, ['第一句。']);
});
test('image generation failures never write an image-success history entry', async () => {
    const f = fixture(); f.deps.requestChatCompletion = async () => completion('[CMD:IMAGE_GEN] 一个场景'); f.deps.generateImage = async () => { throw new Error('mock failure'); };
    await createMessageHandler(f.deps)(f.ws, event(1, '生成一张图')); assert.equal(f.sessions.group_10, undefined); assert.equal(f.sends.length, 0);
});
test('proactive JSON fails closed, and screenshot-style paraphrases count as repetition', () => {
    assert.equal(parseDecision('会呀，直接问就好啦').reply, ''); assert.equal(parseDecision('{"score":"0.9","reply":"bad"}').reply, '');
    assert.equal(similarReply('会呀，直接问就好啦，风堇看到了会回答的呢。', '会呀，直接问就好啦，我会认真回答的呢。'), true);
});
test('proactive checks cannot overlap or reevaluate an unchanged snapshot, including abstention', async () => {
    const f = fixture(), engine = createProactiveEngine(), gate = deferred(); observations(f);
    f.deps.requestChatCompletion = async () => { f.calls.push('check'); return gate.promise; };
    const check = engine.check(f.deps); await tick(); await engine.check(f.deps); assert.equal(f.calls.length, 1);
    gate.resolve(completion('{"score":0,"reply":""}')); await check; await engine.check(f.deps); assert.equal(f.calls.length, 1);
});
test('normal reply wins over an in-flight proactive candidate and new observations survive', async () => {
    const f = fixture(), engine = createProactiveEngine(), gate = deferred(); observations(f);
    let count = 0; f.deps.requestChatCompletion = async () => ++count === 1 ? gate.promise : completion('直接回答');
    const proactive = engine.check(f.deps); await tick(); const direct = createMessageHandler(f.deps)(f.ws, event(99, '请回答'));
    gate.resolve(completion('{"score":0.9,"reply":"旧插话"}')); await Promise.all([proactive, direct]);
    assert.deepEqual(f.sends, ['直接回答']); observations(f, 100); assert.equal(f.runtime.state('group_10').observations.filter(o => o.seq > f.runtime.state('group_10').consumed).length, 3);
    await engine.check(f.deps); assert.equal(count, 2);
});
test('new human input, config disable and reset all invalidate proactive generation', async () => {
    for (const change of [f => observations(f, 100), f => { f.config.enableProactive = false; }, f => f.runtime.reset('group_10')]) {
        const f = fixture(), engine = createProactiveEngine(), gate = deferred(); observations(f); f.deps.requestChatCompletion = async () => gate.promise;
        const check = engine.check(f.deps); await tick(); change(f); gate.resolve(completion('{"score":0.9,"reply":"outdated"}')); await check; assert.equal(f.sends.length, 0);
    }
});
test('proactive repetition is blocked against ordinary replies already in memory', async () => {
    const f = fixture(), engine = createProactiveEngine(); observations(f); f.sessions.group_10 = [{ role: 'assistant', content: '会呀，直接问就好啦，风堇看到了会回答的呢。' }];
    f.deps.requestChatCompletion = async () => completion('{"score":0.9,"reply":"会呀，直接问就好啦，我会认真回答的呢。"}');
    await engine.check(f.deps); assert.equal(f.sends.length, 0);
});
test('proactive success needs acknowledgement and cannot trigger itself again without new humans', async () => {
    const f = fixture({ proactiveCooldown: 0 }), engine = createProactiveEngine(), gate = deferred(); observations(f);
    f.deps.requestChatCompletion = async () => completion('{"score":0.9,"reply":"缓存可以设置过期时间。"}');
    f.deps.sendToQQ = async (_ws, text) => { f.sends.push(text); return gate.promise; };
    const pending = engine.check(f.deps); await tick(); assert.equal(f.sessions.group_10, undefined); gate.resolve({ messageId: 12 }); await pending;
    f.advance(1000); await engine.check(f.deps); assert.equal(f.sends.length, 1); assert.equal(f.sessions.group_10.length, 1);
});
test('transport encodes text as text segments and only accepts matching socket echo acknowledgements', async () => {
    const t = createQQTransport({ timeoutMs: 100 }), payloads = [], ws = { readyState: 1, send: s => payloads.push(JSON.parse(s)) };
    const promise = t.sendToQQ(ws, '[CQ:at,qq=all]', 'group', '20', '10', true), packet = payloads[0];
    assert.equal(packet.params.message[0].type, 'at'); assert.equal(packet.params.message[2].type, 'text');
    assert.equal(t.handleResponse({}, { echo: packet.echo, status: 'ok', retcode: 0 }), false);
    t.handleResponse(ws, { echo: packet.echo, status: 'ok', retcode: 0, data: { message_id: 51 } }); assert.equal((await promise).messageId, 51);
});
test('transport reports timeout/disconnect as uncertain and never retries', async () => {
    const t = createQQTransport({ timeoutMs: 10 }); let sends = 0; const ws = { readyState: 1, send: () => sends++ };
    await assert.rejects(t.sendToQQ(ws, 'text', 'group', null, 10), { code: 'delivery-unknown' }); assert.equal(sends, 1);
    const pending = t.sendToQQ(ws, 'text', 'group', null, 10); t.disconnect(ws); await assert.rejects(pending, { code: 'delivery-unknown' }); assert.equal(sends, 2);
});

test('local reset works without an API key and newer messages are not invalidated by the reset job', async () => {
    const f = fixture({ apiKey: '', masterQQ: '20' }), handle = createMessageHandler(f.deps);
    f.sessions.group_10 = [{ role: 'assistant', content: 'old' }];
    await handle(f.ws, event(1, '/reset')); assert.deepEqual(f.sessions.group_10, []); assert.deepEqual(f.sends, ['记忆已清空。']);
    f.config.apiKey = 'mock';
    const old = deferred(); f.deps.requestChatCompletion = async () => old.promise;
    const blocked = handle(f.ws, event(2, 'old question')); await tick();
    const reset = handle(f.ws, event(3, '/reset')), newer = handle(f.ws, event(4, 'new question'));
    old.resolve(completion('answer')); await Promise.all([blocked, reset, newer]);
    assert.equal(f.sessions.group_10.length, 2); assert.match(f.sessions.group_10[0].content, /new question/);
});
test('successful inbound message IDs survive restart deduplication through retained history', async () => {
    const f = fixture(); f.sessions.group_10 = [{ role: 'user', content: 'old', messageId: '1' }, { role: 'assistant', content: 'done' }];
    await createMessageHandler(f.deps)(f.ws, event(1)); assert.equal(f.calls.length, 0);
});
