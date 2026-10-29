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

test('extension media uses acknowledged pipeline and failed media does not invent sent history', async () => {
    const f = fixture({ enableStickers: true, stickers: [{ id: 'smile', meaning: '开心', scope: '', data: 'data:image/png;base64,aGVsbG8=' }] });
    f.deps.requestChatCompletion = async () => completion('好呀 [[sticker:smile]]');
    f.deps.sendToQQ = async (_ws, message) => { f.sends.push(message); if (Array.isArray(message)) throw new Error('delivery failed'); return { messageId: '111' }; };
    await createMessageHandler(f.deps)(f.ws, event(987));
    assert.equal(f.sends.length, 2);
    assert.equal(f.sessions.group_10.at(-1).content, '好呀');
    assert.ok(!JSON.stringify(f.sessions).includes('sticker:'));
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
