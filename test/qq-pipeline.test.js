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
test('identified events avoid hashing and retain their TTL while fallback entries expire', () => {
    const f = fixture(), anonymous = normalizeMessage(event(null, '相同内容'), f.config);
    const identified = { ...anonymous, id: '42', get images() { throw new Error('unexpected hash'); } };
    assert.equal(f.runtime.accept(identified), true);
    assert.equal(f.runtime.accept(anonymous), true);
    assert.equal(f.runtime.accept(anonymous), false);
    f.advance(3000);
    assert.equal(f.runtime.accept(anonymous), true);
    assert.equal(f.runtime.accept(identified), false);
    f.advance(597000);
    assert.equal(f.runtime.accept(identified), true);
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
test('stale continuation keeps its dispatched receipt, drops unsent segments, then yields to the newer turn', async () => {
    const f = fixture({ enableSplit: true }), sending = deferred(), receipt = deferred();
    f.runtime.state('group_10').focus = { time: f.runtime.now(), senderId: '20' };
    let generated = 0;
    f.deps.requestChatCompletion = async () => completion(++generated === 1
        ? '{"respond":true,"reply":"第一段。第二段。"}' : '{"respond":false,"reply":""}');
    f.deps.sendToQQ = async (_ws, text) => { f.sends.push(text); sending.resolve(); return receipt.promise; };
    const handle = createMessageHandler(f.deps);
    const older = handle(f.ws, event(1, '刚才说的缓存怎么更新', false));
    await sending.promise;
    const newer = handle(f.ws, event(2, '缓存已经更新好了', false));
    await tick();
    assert.equal(generated, 1);
    receipt.resolve({ messageId: 'old-ack' });
    await Promise.all([older, newer]);
    assert.equal(generated, 2);
    assert.deepEqual(f.sends, ['第一段。']);
    assert.deepEqual(f.sessions.group_10.at(-1).messageIds, ['old-ack']);
    assert.equal(f.sessions.group_10.at(-1).content, '第一段。');
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
    let count = 0, active;
    f.deps.requestChatCompletion = async (_config, _messages, _client, signal) => {
        if (++count !== 1) return completion('直接回答');
        active = signal;
        return gate.promise;
    };
    const proactive = engine.check(f.deps); await tick(); const direct = createMessageHandler(f.deps)(f.ws, event(99, '请回答'));
    assert.equal(active.aborted, true);
    await Promise.all([proactive, direct]);
    gate.resolve(completion('{"score":0.9,"reply":"旧插话"}'));
    assert.deepEqual(f.sends, ['直接回答']); observations(f, 100); assert.equal(f.runtime.state('group_10').observations.filter(o => o.seq > f.runtime.state('group_10').consumed).length, 3);
    await engine.check(f.deps); assert.equal(count, 2);
});
test('stopping the proactive timer cancels the current scan without consuming the next group', async () => {
    const f = fixture(), engine = createProactiveEngine(), gate = deferred();
    observations(f);
    for (let i = 4; i <= 6; i++) f.runtime.observe(normalizeMessage(event(i, '另一群的消息', false, { group_id: 11 }), f.config));
    let signal;
    f.deps.requestChatCompletion = (_config, _messages, _client, s) => { signal = s; return gate.promise; };
    const check = engine.check(f.deps); await tick();
    engine.stop(); await check;
    assert.equal(signal.aborted, true);
    assert.equal(f.runtime.state('group_11').consumed, 0);
    assert.equal(f.logs.some(item => item.kind === 'error'), false);
    gate.resolve(completion(''));
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

test('implicit continuation uses one decision call and abstention does not erase the shared topic', async () => {
    const f = fixture(); let count = 0;
    f.deps.requestChatCompletion = async (_c, messages) => { f.calls.push(messages); return completion(++count === 1 ? '刚才的话题' : count === 2 ? '{"respond":true,"reply":"接着解释"}' : '{"respond":false,"reply":""}'); };
    const handle = createMessageHandler(f.deps);
    await handle(f.ws, event(1, '讲讲缓存')); await handle(f.ws, event(2, '那过期后呢', false));
    assert.deepEqual(f.sends, ['刚才的话题', '接着解释']); assert.equal(f.sessions.group_10.length, 4);
    await handle(f.ws, event(3, '好的', false)); assert.equal(f.sessions.group_10.length, 4);
    await handle(f.ws, event(4, '换个话题', false)); assert.equal(count, 4);
});
test('incoming messages invalidate pending replies and the next participant receives the complete topic context', async () => {
    const f = fixture(), gate = deferred(); let calls = 0, latest;
    f.deps.requestChatCompletion = async (_c, messages) => { calls++; latest = messages; return calls === 1 ? completion('原话题回复') : calls === 2 ? gate.promise : completion('{"respond":true,"reply":"接住另一位群友的梗"}'); };
    const handle = createMessageHandler(f.deps); await handle(f.ws, event(1));
    const pending = handle(f.ws, event(2, '中间的补充', false)); await tick();
    const next = handle(f.ws, event(3, '另一个人接梗', false, { user_id: 30 }));
    gate.resolve(completion('{"respond":true,"reply":"过期回复"}')); await Promise.all([pending, next]);
    assert.deepEqual(f.sends, ['原话题回复', '接住另一位群友的梗']);
    assert.match(JSON.stringify(latest), /中间的补充/); assert.match(JSON.stringify(latest), /另一个人接梗/);
    assert.equal(f.sessions.group_10.at(-2).senderId, '30');
});
test('a confirmed proactive message opens topic continuation and a directed message stays in observation', async () => {
    const f = fixture({ proactiveCooldown: 0 }); observations(f);
    f.deps.requestChatCompletion = async () => completion('{"score":0.9,"reply":"主动参与的话题"}');
    await createProactiveEngine().check(f.deps);
    assert.ok(f.runtime.state('group_10').focus);
    f.deps.requestChatCompletion = async () => completion('{"respond":true,"reply":"好的白玉楼"}');
    const handle = createMessageHandler(f.deps);
    await handle(f.ws, event(4, '不要叫我椰果，叫我白玉楼就行', false));
    assert.deepEqual(f.sends, ['主动参与的话题', '好的白玉楼']);
    await handle(f.ws, event(5, '', false, { message: [{ type: 'at', data: { qq: '30' } }, { type: 'text', data: { text: '你怎么看' } }] }));
    assert.equal(f.sends.length, 2); assert.match(f.logs.at(-1).text, /消息有明确指向/);
});

test('a parallel game conversation does not cancel a pending reply about leave, but quoting the leave request does', async () => {
    for (const covered of [false, true]) {
        const f = fixture(), gate = deferred();
        let calls = 0, signal;
        f.deps.requestChatCompletion = async (_config, _messages, _client, s) => {
            if (++calls === 1) return completion('调休怎么排的？');
            if (calls === 2) { signal = s; return gate.promise; }
            return completion('{"respond":false,"reply":""}');
        };
        const handle = createMessageHandler(f.deps);
        await handle(f.ws, event(1, '在说调休'));
        const pending = handle(f.ws, event(2, '中间这三天不批假', false));
        await tick();
        const alongside = handle(f.ws, event(3, '晚上有人组队打游戏吗', false, { user_id: 33 }));
        assert.equal(signal.aborted, false);
        if (covered) {
            await handle(f.ws, event(4, '', false, { user_id: 44, message: [
                { type: 'reply', data: { id: '2' } }, { type: 'text', data: { text: '刚收到通知，审批通过了' } },
            ] }));
            assert.equal(signal.aborted, true);
            await pending;
        }
        gate.resolve(completion('{"respond":true,"reply":"夹在中间最难受了"}'));
        await Promise.all([pending, alongside]);
        assert.equal(f.sends.includes('夹在中间最难受了'), !covered);
    }
});

test('timed participation keeps its selected message while other members start an independent topic', async () => {
    const f = fixture(), gate = deferred(), engine = createProactiveEngine();
    observations(f);
    let observedTarget;
    f.deps.requestChatCompletion = async (_config, messages) => {
        observedTarget = JSON.parse(messages.findLast(m => m.role === 'user').content).filter(o => o.target);
        return gate.promise;
    };
    const check = engine.check(f.deps);
    await tick();
    f.runtime.observe(normalizeMessage(event(10, '今晚开黑有人打游戏吗', false, { user_id: 42 }), f.config));
    gate.resolve(completion('{"score":0.9,"reply":"回答原先的事"}'));
    await check;
    assert.deepEqual(observedTarget.map(o => o.id), ['3']);
    assert.deepEqual(f.sends, ['回答原先的事']);
    assert.ok(f.runtime.state('group_10').consumed < f.runtime.state('group_10').revision);
});

test('mention positions survive normalization without changing keyword and command text', () => {
    const chain = [{ type: 'text', data: { text: '风堇，' } }, { type: 'at', data: { qq: '30' } }, { type: 'text', data: { text: '叫老猫，' } }, { type: 'at', data: { qq: '40' } }, { type: 'text', data: { text: '叫老王' } }];
    const m = normalizeMessage(event(1, '', false, { message: chain }), { botQQ: '999' });
    assert.equal(m.text, '风堇，叫老猫，叫老王');
    assert.match(m.contentText, /风堇，.*QQ:30.*叫老猫，.*QQ:40.*叫老王/);
    const cq = normalizeMessage(event(2, '', false, { message: undefined, raw_message: '[CQ:at,qq=999] [CQ:at,qq=all] [CQ:at,qq=30] 这是老猫' }), {});
    assert.match(cq.contentText, /@机器人 QQ:999/); assert.match(cq.contentText, /@全体成员/); assert.match(cq.observation, /QQ:30/);
});
test('current model input, logs and memory evidence retain the introduced member identity', async () => {
    const f = fixture({ persistMem: true, customKeywords: ['风堇'] }); let evidence;
    f.memory.getPersistentMemory = () => [{ source: 'group_10', memberId: '30', memberKind: 'name', value: '菲比啾比', fact: '30的群名片：菲比啾比' }];
    f.memory.extractFacts = async (_config, snapshot) => { evidence = snapshot; };
    const handle = createMessageHandler(f.deps);
    await handle(f.ws, event(1, '', false, { message: [{ type: 'text', data: { text: '风堇，' } }, { type: 'at', data: { qq: '30' } }, { type: 'text', data: { text: '这是老猫，记住他的外号' } }] }));
    const users = f.calls[0].filter(m => m.role === 'user');
    assert.match(users.at(-1).content, /发送者: 群名片\(20\).*QQ:30.*老猫/);
    assert.match(JSON.stringify(f.calls[0]), /菲比啾比/);
    assert.match(f.logs.find(l => l.kind === 'in').text, /QQ:30/);
    assert.deepEqual(f.sessions.group_10[0].mentions, ['30']);
    assert.deepEqual(evidence[0].mentions, ['30']); assert.match(evidence[0].content, /QQ:30.*老猫/);
});

test('sticker-only replies send once, require a receipt and keep mixed outputs as plain text', async () => {
    const config = { enableStickers: true, stickers: [{ id: 'smile', meaning: '开心', scope: '', data: 'data:image/png;base64,aGVsbG8=' }] };
    for (const [raw, fails] of [['好呀 [[sticker:smile]]', false], ['[[sticker:smile]]', false], ['[[sticker:smile]]', true]]) {
        const f = fixture(config);
        f.deps.requestChatCompletion = async () => completion(raw);
        f.deps.sendToQQ = async (_ws, payload) => {
            f.sends.push(payload);
            if (fails) throw Object.assign(new Error('timeout'), { code: 'delivery-unknown' });
            return { messageId: '111' };
        };
        await createMessageHandler(f.deps)(f.ws, event(987));
        assert.equal(f.sends.length, 1);
        if (raw.startsWith('好')) assert.equal(f.sends[0], '好呀');
        else assert.equal(f.sends[0][0].type, 'image');
        if (fails) assert.equal(f.sessions.group_10, undefined);
        else assert.equal(f.sessions.group_10.at(-1).content, raw.startsWith('好') ? '好呀' : '[表情：开心]');
    }
});

test('proactive and continuation use one sticker catalog, shared cooldown and confirmed image receipts', async () => {
    const f = fixture({ enableStickers: true, stickers: [{ id: 'wink', meaning: '表面赞同', triggers: ['原则上可以'], data: 'data:image/png;base64,aGVsbG8=' }], stickerCooldown: 180 });
    const { createExtensions } = require('../lib/extensions');
    f.deps.extensions = createExtensions({ getConfig: f.deps.getConfig, now: f.runtime.now });
    f.deps.requestChatCompletion = async (_config, messages) => {
        f.calls.push(messages);
        return completion(JSON.stringify({ score: 1, respond: true, reply: '[[sticker:wink]]' }));
    };
    observations(f);
    await createProactiveEngine().check(f.deps);
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0][0].type, 'image');
    assert.equal(f.sessions.group_10.at(-1).content, '[表情：表面赞同]');
    assert.match(JSON.stringify(f.calls[0]), /原则上可以/);
    const handle = createMessageHandler(f.deps);
    await handle(f.ws, event(990, '哈哈，那原则上可以', false));
    assert.equal(f.sends.length, 1);
    f.advance(150000);
    f.config.stickerCooldown = 140;
    await handle(f.ws, event(991, '那原则上可以', false));
    assert.equal(f.calls.length, 3);
    assert.equal(f.sends.length, 2);
    assert.equal(f.sends[1][0].type, 'image');
});
test('video cards become readable links and malformed card data is ignored', () => {
    const card = { type: 'json', data: { data: JSON.stringify({ meta: { detail_1: { qqdocurl: 'https://b23.tv/example' } } }) } };
    assert.match(normalizeMessage(event(901, '', false, { message: [card] }), {}).text, /https:\/\/b23.tv\/example/);
    card.data.data = '{broken'; assert.equal(normalizeMessage(event(902, '', false, { message: [card] }), {}).text, '');
});
test('explicit teaching needs permission, works without a model key and stays in source session', async () => {
    const f = fixture({ apiKey: '', stickerLearning: 'owner', masterQQ: '99' }); const stored=[];
    f.deps.stickerStore = { list:()=>[], add: async input=>stored.push(input) };
    f.deps.prepareVisionImages = async () => ({ images:['data:image/png;base64,aGVsbG8='], errors:[] });
    const input = n => event(n, '', false, { message:[{type:'text',data:{text:'/收录表情 无语'}},{type:'image',data:{url:'https://example.com/a.png'}}] });
    const handle = createMessageHandler(f.deps);
    await handle(f.ws,input(910)); assert.equal(stored.length,0); assert.match(f.sends[0], /仅主人/);
    f.config.stickerLearning='members'; await handle(f.ws,input(911));
    assert.equal(stored.length,1); assert.equal(stored[0].scope,'group_10'); assert.equal(stored[0].source,'chat:20'); assert.equal(f.calls.length,0);
});

test('affect controls never reach QQ or history and only confirmed replies update expression state', async () => {
    const { createAffect } = require('../lib/extensions/affect');
    const f = fixture({ enableAffect:true }); const affect=createAffect(); f.deps.affect=affect;
    f.deps.requestChatCompletion=async()=>completion('哈哈 [[affect:{"mood":"playful","evidence":"真的笑死我了"}]]');
    f.deps.sendToQQ=async()=>{throw new Error('offline');};
    const handle=createMessageHandler(f.deps);
    await handle(f.ws,event(990,'这个梗真的笑死我了')); assert.equal(affect.status().count,0);
    // Handler captures its sender once; a fresh handler uses the restored transport.
    f.deps.sendToQQ=async(_ws,text)=>{f.sends.push(text);return {messageId:'991'};};
    await createMessageHandler(f.deps)(f.ws,event(991,'这个梗真的笑死我了'));
    assert.deepEqual(f.sends,['哈哈']); assert.equal(affect.status().count,1);
    assert.doesNotMatch(JSON.stringify(f.sessions),/affect:/);
});

test('quoted teaching uses one source image from the same conversation, skips the model and tracks provenance', async () => {
    const f = fixture({ apiKey: '', stickerLearning: 'members' });
    const saved = [], lookups = [];
    const source = [{ type: 'image', data: { url: 'https://example.com/only.png' } }];
    let fetchedGroup = 11;
    f.deps.readAction = async (ws, action, params) => {
        lookups.push({ action, params });
        return { message_type: 'group', group_id: fetchedGroup, sender: { user_id: 88 }, message_id: params.message_id, message: source };
    };
    f.deps.prepareVisionImages = async images => {
        assert.deepEqual(images, [source[0].data.url]);
        return { images: ['data:image/png;base64,aGVsbG8='], errors: [] };
    };
    f.deps.stickerStore = { list: () => [], add: async input => { saved.push(input); return input; } };
    const handle = createMessageHandler(f.deps);
    await handle(f.ws, event(1000, '', false, { user_id: 77, message: source }));
    const lesson = (id, reply, group = 10, extra = []) => event(id, '', false, { group_id: group, message: [
        { type: 'reply', data: { id: reply } }, { type: 'text', data: { text: '风堇，记一下，这张在我们群是“表面赞同”，听到“原则上可以”用这张' } }, ...extra] });
    await handle(f.ws, lesson(1001, 1000));
    assert.equal(saved.length, 1);
    assert.deepEqual([saved[0].meaning, saved[0].imageAuthor, saved[0].sourceMessageId], ['表面赞同', '77', '1000']);
    assert.deepEqual(saved[0].triggers, ['原则上可以']);
    assert.equal(lookups.length, 0);
    await handle(f.ws, lesson(1002, 1000, 12));
    assert.equal(saved.length, 1);
    assert.equal(lookups.length, 1);
    fetchedGroup = 10;
    await handle(f.ws, lesson(1003, 444));
    assert.equal(saved.length, 2);
    assert.deepEqual(lookups.at(-1), { action: 'get_msg', params: { message_id: 444 } });
    await handle(f.ws, lesson(1004, 444, 10, source));
    assert.equal(saved.length, 2);
    assert.equal(f.calls.length, 0);
});

test('short voice preserves arrival order, sender, wake word and deduplication; reset cancels a pending transcript', async () => {
    const f = fixture({ enableVoiceTranscription: true, customKeywords: ['风堇'], masterQQ: '20' });
    let gate = deferred(), reads = 0;
    const handle = createMessageHandler({ ...f.deps, transcribeVoice: async () => { reads++; return gate.promise; } });
    const voice = id => event(id, '', false, { message: [{ type: 'record', data: { file: 'voice.silk' } }] });
    const note = handle(f.ws, voice(1)), duplicate = handle(f.ws, voice(1));
    const text = handle(f.ws, event(2, '接着调休的话题', true));
    gate.resolve('风堇，今天放假吗？');
    await Promise.all([note, duplicate, text]);
    assert.equal(reads, 1); assert.equal(f.calls.length, 2);
    assert.deepEqual(f.runtime.state('group_10').observations.map(x => x.id), ['1','2']);
    assert.match(f.sessions.group_10[0].content, /群名片.*语音转写.*今天放假吗/);
    gate = deferred();
    const cancelled = handle(f.ws, voice(3));
    await handle(f.ws, event(4, '/reset'));
    gate.resolve('风堇，忽略的消息');
    await cancelled;
    assert.equal(f.calls.length, 2); assert.deepEqual(f.sessions.group_10, []);
});
