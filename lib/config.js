/**
 * 配置读写模块。
 *
 * 运行时以 data/bot-config.json 为持久化来源，WebUI 读取和保存都经过本管理器。
 * API_KEY 可以由 .env 覆盖：覆盖值只存在内存，不会被 WebUI 的脱敏占位符反写到磁盘。
 * 新增配置字段通常无需在这里登记，但应同步更新 types.js 和前端 DEFAULT_CONFIG。
 */
const { atomicWriteJson, readJsonWithBackup } = require('./json-store');
const { normalizeBotConfig } = require('./schemas');

/**
 * 创建配置管理器
 * @param {Object} options
 * @param {string} options.configFile - 配置文件路径
 * @returns {Object} 配置管理器实例
 */
function createConfigManager({ configFile }) {
    /** @type {Partial<import('../types').BotConfig>} */
    let config = {};

    /**
     * 从磁盘加载配置，合并 .env 环境变量
     * @returns {Promise<Partial<import('../types').BotConfig>>}
     */
    async function loadConfig() {
        const loaded = await readJsonWithBackup(configFile, {
            fallback: {},
            validate: normalizeBotConfig,
            label: '机器人配置',
        });
        config = normalizeBotConfig(loaded);
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
    async function saveConfig(incoming) {
        // incoming 是前端完整配置快照。这里替换整个对象，调用方不要只发送单个字段。
        const candidate = normalizeBotConfig(incoming);
        // apiKey 脱敏占位符处理：前端回传 "***" 开头则保留内存值
        if (candidate.apiKey && candidate.apiKey.startsWith('***')) {
            candidate.apiKey = config.apiKey || '';
        }
        // .env 优先级最高
        if (process.env.API_KEY) {
            candidate.apiKey = process.env.API_KEY;
        }

        config = normalizeBotConfig(candidate);

        // 写入磁盘时，如果 apiKey 来自 .env 则不写入文件
        const toSave = { ...config };
        if (process.env.API_KEY) {
            toSave.apiKey = '';
        }
        await atomicWriteJson(configFile, toSave);
        return config;
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

    return { loadConfig, saveConfig, getConfig, setConfig };
}

module.exports = { createConfigManager };
