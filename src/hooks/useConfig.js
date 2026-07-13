// hooks/useConfig.js - 配置管理 hook
import { useState, useCallback } from 'react';
import { apiUrl } from '../lib/api';

const DEFAULT_CONFIG = {
    wsUrl: "ws://127.0.0.1:3001",
    httpPort: "3001",
    botQQ: "",
    customKeywords: [],
    apiEndpoint: "https://api.qhaigc.net/v1",
    apiKey: "",
    modelName: "gemini-3.5-flash",
    temperature: 1.5,
    maxReplyLength: 120,
    enableSplit: false,
    imageModel: "gemini-3-pro-image-preview",
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
    proactiveTargetGroups: [],
    currentPersonaId: "",
    currentPersonaFileName: "",
    personaTags: ""
};

export function useConfig() {
    const [config, setConfig] = useState(DEFAULT_CONFIG);

    const loadConfig = useCallback(() => {
        return fetch(apiUrl('/api/config')).then(res => res.json()).then(data => {
            if (Object.keys(data).length > 0) setConfig(prev => ({ ...prev, ...data }));
        });
    }, []);

    const handleChange = useCallback((key, value) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    }, []);

    const saveConfig = useCallback((addLog, onSuccess) => {
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
