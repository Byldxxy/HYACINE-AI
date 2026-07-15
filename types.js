// types.js - 核心类型定义 (JSDoc)
// 此文件为 TypeScript 渐进迁移的基础，定义项目中的核心类型
// 当完全迁移到 TypeScript 时，此文件将变为 types.ts

/**
 * @typedef {Object} BotConfig
 * @property {string} wsUrl - WebSocket URL (NapCat)
 * @property {string} httpPort - HTTP 端口
 * @property {string} botQQ - 机器人 QQ 号
 * @property {string[]} customKeywords - 自定义唤醒词
 * @property {string} apiEndpoint - OpenAI 兼容 API 端点
 * @property {string} apiKey - API Key (运行时真实值，传输时脱敏)
 * @property {string} modelName - 文本模型名称
 * @property {string} imageEndpoint - 生图 API 端点 (可选)
 * @property {number} temperature - 温度 (0-2)
 * @property {number} maxReplyLength - 最大回复长度
 * @property {boolean} enableSplit - 启用拟人化分段发送
 * @property {string} imageModel - 生图模型名称
 * @property {boolean} optimizeImgPrompt - 智能转译生图提示词
 * @property {string} charName - 角色名称
 * @property {string} masterQQ - 主人 QQ 号
 * @property {string} systemPrompt - 核心人设 System Prompt
 * @property {string[]} interactions - 点击互动台词
 * @property {string} masterPrompt - 遇到主人时追加的提示词
 * @property {string} strangerPrompt - 遇到路人时追加的提示词
 * @property {string} groupPrompt - 群聊环境中追加的提示词
 * @property {number} shortMem - 短期记忆深度 (N 轮对话)
 * @property {number} longMem - 长期摘要保留比例 (0-1, 0 表示关闭)
 * @property {boolean} persistMem - 启用持久化记忆
 * @property {boolean} alwaysReply - 回复所有消息 (危险)
 * @property {boolean} enableProactive - 启用主动发言
 * @property {number} proactiveInterval - 主动发言检查间隔 (秒)
 * @property {number} proactiveCooldown - 主动发言冷却时间 (秒)
 * @property {number} proactiveThreshold - 主动发言置信度阈值
 * @property {number} proactiveContextSize - 主动发言判断使用的最近群消息条数
 * @property {string[]} proactiveTargetGroups - 目标群号列表
 * @property {boolean} enableDesktopAwareness - 启用 Electron 桌面感知
 * @property {number} desktopAwarenessInterval - 桌面视觉分析最短间隔 (秒)
 * @property {number} desktopAwarenessCooldown - 桌面互动发言冷却 (秒)
 * @property {number} desktopAwarenessMaxTokens - 桌面视觉回复最大输出 Token
 * @property {number} desktopAwarenessChangeThreshold - 本地画面变化阈值
 * @property {string[]} desktopAwarenessExcludedTerms - 截图前排除的前台应用关键词
 * @property {boolean} desktopAwarenessHidePetFromCapture - 截图时隐藏桌宠窗口
 * @property {string} currentPersonaId - 当前角色 ID
 * @property {string} currentPersonaFileName - 当前角色图片文件名
 */

/**
 * @typedef {Object} Message
 * @property {'user'|'assistant'|'system'} role - 消息角色
 * @property {string} content - 消息内容
 */

/**
 * @typedef {Object} Session
 * @description 会话数据 (存储在 data/bot-sessions.json)
 * key 格式: "user_{userId}" 或 "group_{groupId}" 或 "test_{scenario}"
 */

/**
 * @typedef {Object} PersistentFact
 * @property {string} fact - 事实内容
 * @property {string} source - 来源 (sessionId 或 "manual")
 * @property {string} time - ISO 时间戳
 */

/**
 * @typedef {Object} Avatar
 * @property {string} id - 头像 ID (文件名)
 * @property {string} name - 显示名称 (文件名去掉扩展名)
 * @property {string} fileName - 文件名
 * @property {string} preview - 预览 URL
 */

/**
 * @typedef {Object} LogEntry
 * @property {'in'|'out'|'info'|'error'|'system'} level - 日志级别
 * @property {string} content - 日志内容
 * @property {string} [time] - 时间戳
 */

/**
 * @typedef {Object} ImageResult
 * @property {'url'|'base64'} type - 图片数据类型
 * @property {string} data - 图片数据 (URL 或 base64 字符串)
 */

/**
 * @typedef {Object} SessionListItem
 * @property {string} id - 会话 ID
 * @property {number} count - 消息数量
 * @property {string} lastUpdate - 最后更新时间
 * @property {string} preview - 最后一条消息预览
 */

/**
 * @typedef {Object} ProactiveObservation
 * @property {string} sender - 发送者名称
 * @property {string} text - 消息文本 (截断到100字)
 * @property {string} time - 时间 (HH:mm:ss)
 */

module.exports = {};
