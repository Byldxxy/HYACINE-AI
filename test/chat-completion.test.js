const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildConversationMessages,
    buildConversationSystemPrompt,
    requestChatCompletion,
} = require('../lib/chat-completion');

test('builds the same identity and image-generation prompt for chat entry points', () => {
    const prompt = buildConversationSystemPrompt({
        systemPrompt: '保持角色口吻。',
        masterPrompt: '主人编号 ${senderId}',
        groupPrompt: '群号 ${groupId}',
        maxReplyLength: 120,
        optimizeImgPrompt: true,
    }, { senderId: '123', groupId: '456', isMaster: true });

    assert.match(prompt, /保持角色口吻/);
    assert.match(prompt, /主人编号 123/);
    assert.match(prompt, /群号 456/);
    assert.match(prompt, /120 CHARACTERS/);
    assert.match(prompt, /CMD:IMAGE_GEN/);
});

test('attaches vision only to the current user message and injects shared memory', () => {
    const messages = buildConversationMessages({
        systemPrompt: 'system',
        summary: 'summary',
        persistentMemory: [{ fact: 'likes tea' }],
        includePersistentMemory: true,
        sessionMessages: [
            { role: 'user', content: 'old' },
            { role: 'assistant', content: 'reply' },
            { role: 'user', content: 'current' },
        ],
        currentVisionImages: ['data:image/png;base64,AQID'],
        groupId: '456',
    });

    assert.equal(messages[1].content, '[过去的对话摘要]\nsummary');
    assert.match(messages[2].content, /likes tea/);
    assert.equal(messages[3].content, 'old');
    assert.equal(Array.isArray(messages[5].content), true);
    assert.match(messages.at(-1).content, /发送者/);
});

test('uses an injected OpenAI-compatible client for completion requests', async () => {
    let received;
    const completion = await requestChatCompletion(
        { apiEndpoint: 'https://example.com/v1', apiKey: 'key', modelName: 'model', temperature: 0.5 },
        [{ role: 'user', content: 'hello' }],
        options => {
            received = { options };
            return {
                chat: {
                    completions: {
                        create: async payload => {
                            received.payload = payload;
                            return { choices: [{ message: { content: 'ok' } }] };
                        },
                    },
                },
            };
        }
    );

    assert.equal(received.options.baseURL, 'https://example.com/v1');
    assert.equal(received.payload.model, 'model');
    assert.equal(completion.choices[0].message.content, 'ok');
});
