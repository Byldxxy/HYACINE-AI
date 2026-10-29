const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rememberMember, memberContext, canContinue, parseContinuation } = require('../lib/group-social');
const { createConversationRuntime } = require('../lib/conversation-runtime');
const { buildConversationMessages } = require('../lib/chat-completion');
const msg = (text, overrides = {}) => ({ senderId: '20', sender: '名片', selfId: '999', sessionId: 'group_10', groupId: '10', text, mentions: [], id: '1', observation: text, ...overrides });
test('member names follow QQ identity; corrections replace aliases and groups remain isolated', () => {
    const facts = [];
    rememberMember(facts, msg('叫我老王')); rememberMember(facts, msg('不要叫我老王，叫我阿王就行', { sender: '新名片', id: '2' }));
    rememberMember(facts, msg('以后叫你阿猫', { mentions: ['30'], id: '3', sender: '新名片' }));
    const roster = memberContext(facts, [], 'group_10');
    assert.deepEqual(roster.find(m => m.id === '20').aliases, ['阿王']); assert.equal(roster[0].name, '新名片');
    assert.deepEqual(roster.find(m => m.id === '30').aliases, ['阿猫']); assert.deepEqual(memberContext(facts, [], 'group_11'), []);
    rememberMember(facts, msg('叫我干什么')); assert.deepEqual(memberContext(facts, [], 'group_10')[0].aliases, ['阿王']);
});
test('topic continuation accepts multiple speakers but excludes directed messages, expired topics and resets', () => {
    let time = 100000; const runtime = createConversationRuntime({ now: () => time });
    runtime.state('group_10').focus = { senderId: '20', seq: 0, time };
    assert.equal(canContinue(runtime, msg('那后来呢')), true);
    assert.equal(canContinue(runtime, msg('那后来呢', { senderId: '30' })), true);
    assert.equal(canContinue(runtime, msg('那后来呢', { mentions: ['30'] })), false);
    assert.equal(canContinue(runtime, msg('那后来呢', { replyTo: '100' })), false);
    time += 180001; assert.equal(canContinue(runtime, msg('那后来呢')), false); time -= 180001;
    runtime.observe(msg('插话', { senderId: '30' })); assert.equal(canContinue(runtime, msg('那后来呢')), true);
    runtime.reset('group_10'); assert.equal(runtime.state('group_10').focus, null);
});
test('continuation rejects malformed output; shared group prompt scopes identity, humor and persona', () => {
    assert.equal(parseContinuation('当然会呀'), ''); assert.equal(parseContinuation('{"respond":false,"reply":"不该发送"}'), '');
    assert.equal(parseContinuation('{"respond":true,"reply":"接住了"}'), '接住了');
    const messages = buildConversationMessages({ systemPrompt: '医护人设', groupId: '10', members: [{ id: '20', aliases: ['阿王'] }], continuation: true });
    const text = JSON.stringify(messages); assert.match(text, /阿王/); assert.match(text, /吃药、看病/); assert.match(text, /反话/); assert.match(text, /不同成员接梗/);
});
