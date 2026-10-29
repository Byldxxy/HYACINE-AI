const {
    buildConversationMessages,
    buildConversationSystemPrompt,
    requestChatCompletion,
} = require('./chat-completion');
const { selectImageGenerationPrompt } = require('./image-gen');

function createTestConversation({ runtime, memory, getConfig, complete = requestChatCompletion }) {
    const sessionIdFor = scenario => `test_${scenario || 'default'}`;

    function chat({ message, isMaster, scenario }) {
        const sessionId = sessionIdFor(scenario);
        // Capture before enqueueing: reset must also cancel requests still waiting their turn.
        const isCurrent = runtime.token(sessionId);
        const ensureCurrent = () => {
            if (isCurrent()) return;
            const error = new Error('会话已重置，请重新发送消息');
            error.code = 'conversation-reset';
            throw error;
        };

        return runtime.enqueue(sessionId, async () => {
            ensureCurrent();
            const config = getConfig();
            const previous = memory.getSessions()[sessionId];
            const identityPrefix = isMaster
                ? '[发送者: 主人/Master (测试用户)] '
                : '[发送者: 测试用户(000000)] ';
            const sessionMessages = [
                ...(previous || []),
                { role: 'user', content: identityPrefix + message },
            ].slice(-((config.shortMem || 10) * 2));
            const messages = buildConversationMessages({
                systemPrompt: buildConversationSystemPrompt(config, {
                    senderId: '000000',
                    isMaster: Boolean(isMaster),
                }),
                summary: memory.getSummaries()[sessionId],
                persistentMemory: memory.getPersistentMemory(),
                sessionId,
                includePersistentMemory: config.persistMem, memoryRecallMode: config.memoryRecallMode,
                sessionMessages,
            });
            const completion = await complete(config, messages);
            ensureCurrent();

            const aiReply = completion.choices[0]?.message?.content || '(AI 未返回内容)';
            const imageCommand = aiReply.match(/\[CMD:IMAGE_GEN\]\s*(.*)/);
            let result = { reply: aiReply, isImage: false };
            let historyReply = aiReply;
            if (imageCommand) {
                const imagePrompt = selectImageGenerationPrompt(config, message, imageCommand[1]);
                result = {
                    reply: config.optimizeImgPrompt === true ? aiReply : `[CMD:IMAGE_GEN] ${imagePrompt}`,
                    isImage: true,
                    imagePrompt,
                };
                historyReply = config.optimizeImgPrompt === true
                    ? aiReply
                    : '[已按上一条用户原始要求生成图片]';
            }

            memory.setSession(sessionId, [...sessionMessages, { role: 'assistant', content: historyReply }]);
            const committed = memory.getSessions()[sessionId];
            try {
                await memory.saveMemoryToDisk();
            } catch (error) {
                // A failed save must not become context for the next request; a newer reset/edit wins.
                if (isCurrent() && memory.getSessions()[sessionId] === committed) {
                    if (previous === undefined) delete memory.getSessions()[sessionId];
                    else memory.setSession(sessionId, previous);
                }
                throw error;
            }
            ensureCurrent();
            return result;
        });
    }

    async function reset(scenario) {
        const sessionId = sessionIdFor(scenario);
        runtime.reset(sessionId);
        delete memory.getSessions()[sessionId];
        delete memory.getSummaries()[sessionId];
        await Promise.all([memory.saveMemoryToDisk(), memory.saveSummariesToDisk()]);
    }

    return { chat, reset };
}

module.exports = { createTestConversation };
