/**
 * WebUI 配置状态的唯一入口。
 *
 * DEFAULT_CONFIG 负责首次启动和旧配置缺字段时的前端默认值；后端返回的数据以浅合并
 * 覆盖这些默认值。保存时发送完整快照，与 lib/config.js 的替换式保存语义保持一致。
 * 新增配置项时应同步更新 DEFAULT_CONFIG、types.js、对应表单和后端使用点。
 */
import { useState, useCallback } from 'react';
import { apiUrl } from '../lib/api';

const DEFAULT_CONFIG = {
    wsUrl: "ws://127.0.0.1:3001",
    httpPort: "3001",
    botQQ: "",
    customKeywords: [],
    apiEndpoint: "",
    apiKey: "",
    modelName: "",
    temperature: 1.5,
    maxReplyLength: 120,
    enableSplit: false,
    imageModel: "",
    imageEndpoint: "",
    optimizeImgPrompt: false,
    charName: "AI 助手",
    masterQQ: "",
    systemPrompt: "",
    interactions: [],
    masterPrompt: "",
    strangerPrompt: "",
    groupPrompt: "",
    shortMem: 50,
    longMem: 0.75,
    persistMem: false,
    alwaysReply: false,
    enableProactive: true,
    proactiveInterval: 300,
    proactiveCooldown: 300,
    proactiveThreshold: 0.3,
    proactiveContextSize: 30,
    proactiveTargetGroups: [],
    enableDesktopAwareness: false,
    desktopAwarenessInterval: 120,
    desktopAwarenessCooldown: 300,
    desktopAwarenessMaxTokens: 4000,
    desktopAwarenessMaxReplyLength: 300,
    desktopAwarenessChangeThreshold: 0.08,
    desktopAwarenessExcludedTerms: ["1Password", "Bitwarden", "KeePass", "Password", "密码", "银行", "支付", "Wallet"],
    desktopAwarenessHidePetFromCapture: true,
    currentPersonaId: "",
    currentPersonaFileName: ""
};

export function useConfig() {
    const [config, setConfig] = useState(DEFAULT_CONFIG);

    const loadConfig = useCallback(() => {
        // 空对象代表首次启动，保留全部默认值；旧配置则只覆盖它实际包含的字段。
        return fetch(apiUrl('/api/config')).then(res => res.json()).then(data => {
            if (Object.keys(data).length > 0) setConfig(prev => ({ ...prev, ...data }));
        });
    }, []);

    const handleChange = useCallback((key, value) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    }, []);

    const saveConfig = useCallback((addLog, onSuccess) => {
        // 后端会处理 API Key 脱敏占位符以及 .env 的最高优先级。
        if (addLog) addLog('info', '正在保存配置...');
        fetch(apiUrl('/api/config'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        }).then(() => {
            if (onSuccess) onSuccess();
        });
    }, [config]);

    return { config, setConfig, loadConfig, handleChange, saveConfig };
}
