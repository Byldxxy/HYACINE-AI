const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activityPolicy, topicContext, memoryContext } = require('../lib/chat-policy');
const { mergeLearnedMemory } = require('../lib/learned-memory');
const { buildConversationMessages } = require('../lib/chat-completion');
test('activity adjusts opportunities without allowing stale context to initiate a topic', () => {
    const now = 1000000, config = { proactiveCooldown: 600, proactiveInterval: 300, proactiveThreshold: .6 };
    const quiet = activityPolicy({ observations: [{ receivedAt: now, senderId: '1' }] }, config, now);
    const hot = activityPolicy({ observations: Array.from({ length: 6 }, (_, i) => ({ receivedAt: now - i * 1000, senderId: String(i % 2) })) }, config, now);
    assert.equal(quiet.mode, 'quiet'); assert.equal(quiet.minNew, 1); assert.ok(quiet.threshold >= .8);
    assert.equal(hot.mode, 'active'); assert.equal(hot.minNew, 2); assert.ok(hot.cooldown < quiet.cooldown); assert.equal(hot.interval, 15000);
});
test('topic anchors preserve different speakers, original questions and explicit references', () => {
    const topics = topicContext([{ role: 'user', senderId: '1', content: '今天加班' }, { role: 'assistant', content: '几点下班', messageIds: ['a'] }, { role: 'user', senderId: '2', content: '游戏卡关' }, { role: 'assistant', content: '哪一关', messageIds: ['b'] }], { senderId: '1', replyTo: 'a' });
    assert.equal(topics.anchors[0].senderId, '1'); assert.equal(topics.anchors[0].quoted, true); assert.equal(topics.anchors[1].senderId, '2'); assert.equal(topics.anchors[1].quoted, false);
});
test('slang requires teaching or repeated evidence and stays group-scoped', () => {
    const records = [], one = [{ id: '1', role: 'user', text: '冲塔了', senderId: '20' }];
    const candidate = { kind: 'slang', subject: '冲塔', fact: '冲塔：本群指主动挑战高难关卡', evidenceIds: ['1'] };
    assert.equal(mergeLearnedMemory(records, candidate, one, 'group_1', 1), 0);
    one[0].text = '记住，我们群冲塔是挑战高难关卡'; assert.equal(mergeLearnedMemory(records, candidate, one, 'group_1', 1), 1);
    assert.equal(memoryContext(records, 'group_2', '冲塔').length, 0); assert.equal(memoryContext(records, 'group_1', '天气').length, 0); assert.equal(memoryContext(records, 'group_1', '冲塔').length, 1);
});
test('bot taste needs two confirmed assistant statements; fixed edits and disabled entries survive learning', () => {
    const records = [], evidence = [{ id: 'a', role: 'assistant', text: '我更喜欢策略游戏，能慢慢想' }, { id: 'b', role: 'assistant', text: '我喜欢有规划空间的策略游戏' }];
    const value = { kind: 'bot_preference', subject: '游戏品味', fact: '偏爱策略游戏，喜欢规划', evidenceIds: ['a', 'b'] };
    assert.equal(mergeLearnedMemory(records, value, [{ ...evidence[0], role: 'user' }, evidence[1]], 'group_1', 1), 0);
    assert.equal(mergeLearnedMemory(records, value, evidence, 'group_1', 1), 1); assert.equal(records[0].source, 'persona');
    records[0].locked = true; records[0].fact = '偏爱解谜游戏';
    assert.equal(mergeLearnedMemory(records, value, evidence, 'group_1', 1), 0); assert.equal(records[0].fact, '偏爱解谜游戏');
    const prompt = buildConversationMessages({ systemPrompt: '角色', sessionId: 'group_2', includePersistentMemory: true, persistentMemory: records });
    assert.match(JSON.stringify(prompt), /角色偏好/); assert.match(JSON.stringify(prompt), /解谜/);
    records[0].enabled = false; assert.equal(memoryContext(records, 'group_2').length, 0);
});
