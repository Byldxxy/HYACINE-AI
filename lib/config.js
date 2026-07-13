// lib/config.js - 配置读写模块
const fs = require('fs').promises;
const fsSync = require('fs');

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
        try {
            if (fsSync.existsSync(configFile)) {
                const data = await fs.readFile(configFile, 'utf-8');
                config = JSON.parse(data);
                if (process.env.API_KEY) {
                    config.apiKey = process.env.API_KEY;
                }
                console.log("📚 配置已加载" + (process.env.API_KEY ? " (API Key 来自 .env)" : ""));
            } else {
                console.log("⚠️ 未找到配置，使用默认值");
                config = {};
            }
        } catch (_error) {
            config = {};
        }
        return config;
    }

    /**
     * 保存配置到磁盘（处理 .env 优先级和 apiKey 脱敏）
     * @param {Partial<import('../types').BotConfig>} incoming - 传入的新配置
     * @returns {Promise<Partial<import('../types').BotConfig>>} 最终生效的配置
     */
    async function saveConfig(incoming) {
        // apiKey 脱敏占位符处理：前端回传 "***" 开头则保留内存值
        if (incoming.apiKey && incoming.apiKey.startsWith('***')) {
            incoming.apiKey = config.apiKey || '';
        }
        // .env 优先级最高
        if (process.env.API_KEY) {
            incoming.apiKey = process.env.API_KEY;
        }

        config = incoming;

        // 写入磁盘时，如果 apiKey 来自 .env 则不写入文件
        const toSave = { ...config };
        if (process.env.API_KEY) {
            toSave.apiKey = '';
        }
        await fs.writeFile(configFile, JSON.stringify(toSave, null, 2), 'utf-8');
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
        config = newConfig;
    }

    return { loadConfig, saveConfig, getConfig, setConfig };
}

module.exports = { createConfigManager };
