/**
 * 配置读写模块。
 *
 * 运行时以 data/bot-config.json 为持久化来源，WebUI 读取和保存都经过本管理器。
 * API_KEY 可以由 .env 覆盖：覆盖值只存在内存，不会被 WebUI 的脱敏占位符反写到磁盘。
 * 新增配置字段通常无需在这里登记，但应同步更新 types.js 和前端 DEFAULT_CONFIG。
 */
const { atomicWriteJson, readJsonWithBackup } = require('./json-store');
const { normalizeBotConfig } = require('./schemas');
const { invalid, conflict, isObject } = require('./management-edits');
const { isDeepStrictEqual } = require('node:util');
const { randomBytes, createHmac } = require('node:crypto');
const { maskApiKey } = require('./utils');
const secrets = ['apiKey', 'onebotToken', 'snowlumaToken', 'qqBotSecret', 'voiceApiKey'];

/**
 * 创建配置管理器
 * @param {Object} options
 * @param {string} options.configFile - 配置文件路径
 * @returns {Object} 配置管理器实例
 */
function createConfigManager({ configFile }) {
    /** @type {Partial<import('../types').BotConfig>} */
    let config = {};
    let writing = Promise.resolve();
    let hasSnapshot = false;
    const versionKey = randomBytes(32);
    function publicConfig() {
        const view = { ...config, _secretVersions: {} };
        view._revision = createHmac('sha256', versionKey).update(JSON.stringify(config)).digest('hex');
        for (const key of secrets) {
            if (!view[key]) continue;
            view._secretVersions[key] = createHmac('sha256', versionKey).update(key).update('\0').update(view[key]).digest('hex');
            view[key] = key === 'apiKey' ? maskApiKey(view[key]) : '***';
        }
        return view;
    }
    function enqueue(work) {
        const pending = writing.then(work);
        writing = pending.catch(() => {});
        return pending;
    }

    /**
     * 从磁盘加载配置，合并 .env 环境变量
     * @returns {Promise<Partial<import('../types').BotConfig>>}
     */
    async function loadConfig() {
        const loaded = await readJsonWithBackup(configFile, {
            fallback: null,
            validate: normalizeBotConfig,
            label: '机器人配置',
        });
        hasSnapshot = loaded !== null;
        config = normalizeBotConfig(loaded || {});
        if (process.env.API_KEY) {
            config.apiKey = process.env.API_KEY;
        }
        console.log("📚 配置已加载" + (process.env.API_KEY ? " (API Key 来自 .env)" : ""));
        return config;
    }

    /**
     * 保存配置到磁盘（处理 .env 优先级和 apiKey 脱敏）
     * @param {Partial<import('../types').BotConfig>} incoming - 传入的新配置
     * @returns {Promise<Partial<import('../types').BotConfig>>} 最终生效的配置
     */
    async function persist(incoming) {
        const candidate = normalizeBotConfig(incoming);
        delete candidate._secretVersions;
        delete candidate._revision;
        // apiKey 脱敏占位符处理：前端回传 "***" 开头则保留内存值
        if (candidate.apiKey && candidate.apiKey.startsWith('***')) {
            candidate.apiKey = config.apiKey || '';
        }
        for (const field of ['onebotToken', 'snowlumaToken', 'qqBotSecret', 'voiceApiKey']) {
            if (candidate[field]?.startsWith('***')) candidate[field] = config[field] || '';
        }
        // .env 优先级最高
        if (process.env.API_KEY) {
            candidate.apiKey = process.env.API_KEY;
        }

        const nextConfig = normalizeBotConfig(candidate);

        // 写入磁盘时，如果 apiKey 来自 .env 则不写入文件
        const toSave = { ...nextConfig };
        if (process.env.API_KEY) {
            toSave.apiKey = '';
        }
        await atomicWriteJson(configFile, toSave);
        config = nextConfig;
        hasSnapshot = true;
        return config;
    }

    function saveConfig(incoming, options) {
        return enqueue(() => {
            const revision = options?.ifMatch ?? incoming?._revision;
            if (options?.conditional && hasSnapshot && !revision) throw Object.assign(new Error('整表更新配置需要最新的 If-Match 或 _revision'), { code: 'precondition-required' });
            if (revision !== undefined && revision !== publicConfig()._revision) throw conflict('配置已更新，请重新读取');
            return persist(incoming);
        });
    }

    function patchConfig(changes, base, secretVersions = {}) {
        return enqueue(async () => {
            if (!isObject(changes) || (base !== undefined && !isObject(base)) || !isObject(secretVersions)) throw invalid('配置修改格式无效');
            const fields = Object.keys(changes);
            const view = publicConfig();
            for (const key of fields) {
                if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || Object.hasOwn(Object.prototype, key) || ['prototype', 'configVersion', 'httpPort', 'wsUrl'].includes(key)) throw invalid('配置包含只读或无效字段');
                if (base === undefined) continue; // Trusted, single-field IPC updates.
                if (!isDeepStrictEqual(base[key], view[key]) || (secrets.includes(key) && secretVersions[key] !== view._secretVersions[key])) {
                    throw conflict(`配置项 ${key} 已更新，请核对最新值`);
                }
            }
            return fields.length ? persist({ ...config, ...changes }) : config;
        });
    }

    /**
     * 获取当前内存中的配置
     * @returns {Partial<import('../types').BotConfig>}
     */
    function getConfig() {
        return config;
    }

    /**
     * 直接设置内存中的配置（不写盘）
     * @param {Partial<import('../types').BotConfig>} newConfig
     */
    function setConfig(newConfig) {
        config = normalizeBotConfig(newConfig);
    }

    return { loadConfig, saveConfig, patchConfig, publicConfig, getConfig, setConfig };
}

module.exports = { createConfigManager };
