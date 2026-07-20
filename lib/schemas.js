/** Runtime schemas for data accepted from disk and management APIs. */
const { z } = require('zod');

const CURRENT_CONFIG_VERSION = 1;
const optionalString = (max = 20_000) => z.string().max(max).optional();
const optionalIdentifier = z.union([z.string().max(64), z.number().finite()])
    .transform(value => String(value))
    .optional();
const optionalBoolean = z.boolean().optional();
const optionalNumber = (min, max) => z.number().finite().min(min).max(max).optional();
const stringList = (maxItems = 100, maxLength = 500) => z.array(z.string().max(maxLength)).max(maxItems).optional();

const botConfigSchema = z.object({
    configVersion: z.number().int().min(1).optional(),
    wsUrl: optionalString(2_000),
    httpPort: optionalIdentifier,
    botQQ: optionalIdentifier,
    customKeywords: stringList(100, 200),
    apiEndpoint: optionalString(2_000),
    apiKey: optionalString(10_000),
    modelName: optionalString(500),
    temperature: optionalNumber(0, 2),
    maxReplyLength: optionalNumber(1, 20_000),
    enableSplit: optionalBoolean,
    imageModel: optionalString(500),
    imageEndpoint: optionalString(2_000),
    optimizeImgPrompt: optionalBoolean,
    charName: optionalString(200),
    masterQQ: optionalIdentifier,
    systemPrompt: optionalString(100_000),
    interactions: stringList(500, 2_000),
    masterPrompt: optionalString(50_000),
    strangerPrompt: optionalString(50_000),
    groupPrompt: optionalString(50_000),
    shortMem: optionalNumber(1, 1_000),
    longMem: optionalNumber(0, 1),
    persistMem: optionalBoolean,
    alwaysReply: optionalBoolean,
    enableProactive: optionalBoolean,
    proactiveInterval: optionalNumber(10, 86_400),
    proactiveCooldown: optionalNumber(0, 86_400),
    proactiveThreshold: optionalNumber(0, 1),
    proactiveContextSize: optionalNumber(3, 50),
    proactiveTargetGroups: stringList(500, 100),
    enableDesktopAwareness: optionalBoolean,
    desktopAwarenessInterval: optionalNumber(30, 900),
    desktopAwarenessCooldown: optionalNumber(60, 3_600),
    desktopAwarenessMaxTokens: optionalNumber(256, 10_000),
    desktopAwarenessMaxReplyLength: optionalNumber(80, 800),
    desktopAwarenessChangeThreshold: optionalNumber(0.02, 0.5),
    desktopAwarenessExcludedTerms: stringList(50, 500),
    desktopAwarenessHidePetFromCapture: optionalBoolean,
    currentPersonaId: optionalString(500),
    currentPersonaFileName: optionalString(1_000),
}).catchall(z.unknown());

const messageSchema = z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(200_000),
}).catchall(z.unknown());
const sessionMessagesSchema = z.array(messageSchema).max(5_000);
const sessionsSchema = z.record(z.string().max(500), sessionMessagesSchema);
const summariesSchema = z.record(z.string().max(500), z.string().max(500_000));
const persistentFactSchema = z.object({
    fact: z.string().trim().min(1).max(20_000),
    source: z.string().max(500).optional().default('manual'),
    time: z.string().max(100).optional().default(''),
}).catchall(z.unknown());
const persistentMemorySchema = z.array(persistentFactSchema).max(10_000);

class DataValidationError extends Error {
    constructor(label, issues) {
        const details = issues
            .slice(0, 8)
            .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ');
        super(`${label} 校验失败: ${details}`);
        this.name = 'DataValidationError';
        this.code = 'invalid-data';
        this.issues = issues;
    }
}

function parseSchema(schema, value, label) {
    const result = schema.safeParse(value);
    if (!result.success) throw new DataValidationError(label, result.error.issues);
    return result.data;
}

function normalizeBotConfig(value) {
    const config = parseSchema(botConfigSchema, value, '配置');
    // Removed after v1.1.0. Dropping it here migrates existing files on next save.
    delete config.personaTags;
    return { ...config, configVersion: CURRENT_CONFIG_VERSION };
}

module.exports = {
    CURRENT_CONFIG_VERSION,
    DataValidationError,
    normalizeBotConfig,
    parsePersistentMemory: value => parseSchema(persistentMemorySchema, value, '持久化记忆'),
    parseSessionMessages: value => parseSchema(sessionMessagesSchema, value, '会话消息'),
    parseSessions: value => parseSchema(sessionsSchema, value, '会话记忆'),
    parseSummaries: value => parseSchema(summariesSchema, value, '会话摘要'),
};
