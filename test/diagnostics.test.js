const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiagnosticsReport } = require('../lib/diagnostics');

test('builds diagnostics without secret values, prompts, or chat content', () => {
    const report = buildDiagnosticsReport({
        version: '1.2.3',
        config: {
            configVersion: 1,
            apiEndpoint: 'https://private-provider.example/v1',
            apiKey: 'super-secret-key',
            modelName: 'private-model',
            systemPrompt: 'PRIVATE SYSTEM PROMPT',
            imageModel: 'private-image-model',
        },
        sessions: { group_1: [{ role: 'user', content: 'PRIVATE CHAT CONTENT' }] },
        summaries: { group_1: 'PRIVATE SUMMARY' },
        persistentMemory: [{ fact: 'PRIVATE FACT' }],
        desktopAwareness: { status: 'watching', detail: 'PRIVATE WINDOW TITLE' },
    });
    const serialized = JSON.stringify(report);

    assert.equal(report.configuration.apiKeyConfigured, true);
    assert.equal(report.memory.messageCount, 1);
    assert.equal(report.desktop.observerDetailPresent, true);
    for (const secret of [
        'super-secret-key',
        'private-provider',
        'private-model',
        'PRIVATE SYSTEM PROMPT',
        'PRIVATE CHAT CONTENT',
        'PRIVATE SUMMARY',
        'PRIVATE FACT',
        'PRIVATE WINDOW TITLE',
    ]) {
        assert.equal(serialized.includes(secret), false);
    }
});
