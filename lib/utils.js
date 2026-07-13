// lib/utils.js - 工具函数模块

/** @typedef {import('../types').ImageResult} ImageResult */

/**
 * 智能分句函数 - 将AI回复拆分为自然的分段
 * @param {string} text - 待分割的文本
 * @returns {string[]} 分割后的文本数组
 */
function smartSplit(text) {
    if (!text) return [];
    const parts = text.split(/([。！？\n!?]+)/);
    const result = [];
    let current = "";

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i % 2 === 1) { 
            current += part;
        } else {
            if (!part.trim()) continue;
            if (current === "") {
                current = part;
            } else {
                const openParens = (current.match(/[（(]/g) || []).length;
                const closeParens = (current.match(/[）)]/g) || []).length;
                const startsWithCloser = /^[））""''!,.]/.test(part);

                if (openParens > closeParens || startsWithCloser) {
                    current += part; 
                } else {
                    result.push(current.trim()); 
                    current = part; 
                }
            }
        }
    }
    if (current.trim()) result.push(current.trim());
    return result;
}

/**
 * API Key 脱敏工具：仅显示后4位
 * @param {string} key - 原始 API Key
 * @returns {string} 脱敏后的字符串
 */
function maskApiKey(key) {
    if (!key || key.length <= 4) return '***';
    return '***' + key.slice(-4);
}

module.exports = { smartSplit, maskApiKey };
