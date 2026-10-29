const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recentHistory, CONTEXT_LIMITS } = require('../lib/context-budget');
const { memoryContext } = require('../lib/chat-policy');
const { buildConversationMessages } = require('../lib/chat-completion');

test('history budget preserves the current input and avoids an orphaned old answer', () => {
    const history = [{ role: 'user', content: 'question'.repeat(10) }, { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'recent question' }, { role: 'assistant', content: 'recent answer' },
        { role: 'user', content: 'current'.repeat(100) }];
    const selected = recentHistory(history, 40);
    assert.deepEqual(selected, history.slice(2));
    assert.equal(selected.at(-1), history.at(-1));
    assert.equal(history.length, 5);
    // Proactive requests intentionally include standalone confirmed bot replies.
    assert.deepEqual(recentHistory(history.slice(3)), history.slice(3));
});

test('memory retrieval keeps older relevant and fixed facts ahead of noisy recent entries', () => {
    const records = [
        { fact: '冲塔是挑战高难关卡', subject: '冲塔', kind: 'slang', source: 'group_1' },
        { fact: '偏爱解谜游戏', kind: 'bot_preference', source: 'persona', locked: true },
        ...Array.from({ length: 80 }, (_, i) => ({ fact: `无关记录 ${i}`, source: 'group_1' })),
        { fact: 'other group secret', source: 'group_2' },
        { fact: 'disabled', source: 'group_1', enabled: false },
    ];
    const selected = memoryContext(records, 'group_1', '今天还冲塔吗');
    assert.equal(selected[0].fact, '偏爱解谜游戏');
    assert.ok(selected.some(f => f.subject === '冲塔'));
    assert.ok(selected.length <= 5);
    assert.doesNotMatch(JSON.stringify(selected), /other group secret|disabled/);
    assert.equal(records[0].subject, '冲塔');
    assert.ok(!memoryContext(records, 'group_1', '天气').some(f => f.kind === 'slang'));
    assert.deepEqual(memoryContext([{ fact: 'private', source: 'user_1' }], null), []);
});

test('large optional context is bounded without changing the current question or image', () => {
    const current = { role: 'user', content: '完整当前问题'.repeat(4000) };
    const messages = buildConversationMessages({
        systemPrompt: 'persona', groupId: '1', sessionId: 'group_1', includePersistentMemory: true,
        persistentMemory: Array.from({ length: 100 }, (_, i) => ({ fact: `${i} ${'长记忆'.repeat(800)}`, source: 'manual', locked: true })),
        sessionMessages: [...Array.from({ length: 30 }, () => [{ role: 'user', content: 'old'.repeat(1000) }, { role: 'assistant', content: 'reply'.repeat(600) }]).flat(), current],
        groupContext: Array.from({ length: 16 }, (_, i) => ({ senderId: String(i), observation: '背景'.repeat(900) })),
        currentVisionImages: ['data:image/png;base64,AQID'],
    });
    const memory = messages.find(m => typeof m.content === 'string' && m.content.startsWith('[你长期'));
    assert.ok(memory.content.length < CONTEXT_LIMITS.memory + 30);
    const history = messages.filter(m => typeof m.content === 'string' && /^(old|reply)/.test(m.content));
    assert.ok(history.reduce((n, m) => n + m.content.length, 0) <= CONTEXT_LIMITS.history);
    const visual = messages.find(m => Array.isArray(m.content));
    assert.equal(visual.content[0].text, current.content);
    assert.equal(visual.content[1].image_url.url, 'data:image/png;base64,AQID');
});

test('member context prioritizes the current speaker and mentioned person within its budget', () => {
    const messages = buildConversationMessages({
        systemPrompt: 'persona', groupId: '1',
        sessionMessages: [{ role: 'user', senderId: 'current', mentions: ['target'], content: '这是我朋友' }],
        members: [...Array.from({ length: 40 }, (_, i) => ({ id: String(i), traits: ['背景'.repeat(100)] })),
            { id: 'current', name: '白玉楼' }, { id: 'target', name: '群友' }],
    });
    const roster = messages.find(m => typeof m.content === 'string' && m.content.startsWith('[当前群成员'));
    assert.match(roster.content, /白玉楼/); assert.match(roster.content, /群友/);
    assert.ok(roster.content.length <= CONTEXT_LIMITS.members + 50);
});
