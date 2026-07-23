/**
 * Shared text-chat prompt and completion construction.
 * Both OneBot messages and the WebUI test chat use this module so identity,
 * memory, image-generation instructions, and provider defaults cannot drift.
 */
const OpenAI = require('openai');
const { buildVisionContent } = require('./vision');

function processTemplate(template, { senderId, groupId }) {
    if (!template) return '';
    return template
        .replace(/\$\{senderId\}/g, senderId)
        .replace(/\$\{groupId\}/g, groupId || '私聊');
}

function buildImageGenerationInstruction(config) {
    if (config.optimizeImgPrompt === true) {
        return `
1. Translate and refine the user's request into a concise English scene description.
2. Describe action, expression, background, lighting, and composition.
3. Do not describe the character's fixed appearance; the system provides a character base image.
4. Output only: [CMD:IMAGE_GEN] scene description`;
    }
    return `
1. Preserve the user's requested scene wording inside the command.
2. Output only: [CMD:IMAGE_GEN] user scene request`;
}

function buildConversationSystemPrompt(config, { senderId, groupId = null, isMaster = false }) {
    const context = { senderId: String(senderId || ''), groupId: groupId ? String(groupId) : null };
    let prompt = config.systemPrompt || '你是一个助手。';

    if (isMaster) {
        const template = config.masterPrompt !== undefined
            ? config.masterPrompt
            : '【系统】检测到主人(ID: ${senderId})。';
        if (template) prompt += `\n${processTemplate(template, context)}`;
    } else {
        const template = config.strangerPrompt !== undefined
            ? config.strangerPrompt
            : '【系统】检测到普通用户(ID: ${senderId})。';
        if (template) prompt += `\n${processTemplate(template, context)}`;
    }

    if (groupId) {
        const template = config.groupPrompt || '【环境】当前是群聊(${groupId})。';
        prompt += `\n${processTemplate(template, context)}`;
    }

    const maxLength = Number(config.maxReplyLength) || 1000;
    prompt += `

[System Configuration]
1. Length Constraint: STRICTLY UNDER ${maxLength} CHARACTERS.
2. Style: Concise, oral.

【特殊能力：生图】
如果用户明确要求生成图片、自拍或查看角色形象，只输出以下指令，不要附加解释：
[CMD:IMAGE_GEN] 内容

${buildImageGenerationInstruction(config)}`;
    return prompt;
}

function buildGroupIdentityGuide() {
    return `群聊消息可能以【发送者: 昵称(ID)】或【发送者: 主人/Master】开头。
区分不同发送者和他们说过的话；可在自然时称呼昵称，但不要复读发送者标签。`;
}

function buildConversationMessages({
    systemPrompt,
    summary = '',
    persistentMemory = [],
    includePersistentMemory = false,
    sessionMessages = [],
    currentVisionImages = [],
    groupId = null,
}) {
    const messages = [{ role: 'system', content: systemPrompt }];
    if (summary) messages.push({ role: 'system', content: `[过去的对话摘要]\n${summary}` });
    if (includePersistentMemory && persistentMemory.length > 0) {
        const facts = persistentMemory.map(item => `- ${item.fact}`).join('\n');
        messages.push({ role: 'system', content: `[你长期记住的事实]\n${facts}` });
    }

    const currentUserIndex = sessionMessages.length - 1;
    messages.push(...sessionMessages.map((message, index) => {
        if (index !== currentUserIndex || message.role !== 'user' || currentVisionImages.length === 0) {
            return message;
        }
        return { ...message, content: buildVisionContent(message.content, currentVisionImages) };
    }));
    if (groupId) messages.push({ role: 'system', content: buildGroupIdentityGuide() });
    return messages;
}

async function requestChatCompletion(config, messages, createClient = options => new OpenAI(options)) {
    const client = createClient({
        baseURL: config.apiEndpoint || 'https://api.openai.com/v1',
        apiKey: config.apiKey,
    });
    return client.chat.completions.create({
        model: config.modelName || 'gpt-3.5-turbo',
        messages,
        temperature: Number(config.temperature) || 0.7,
    });
}

module.exports = {
    buildConversationMessages,
    buildConversationSystemPrompt,
    requestChatCompletion,
};
