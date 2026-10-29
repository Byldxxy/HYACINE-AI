/**
 * WebUI 配置状态的唯一入口。
 *
 * DEFAULT_CONFIG 负责首次启动和旧配置缺字段时的前端默认值；后端返回的数据以浅合并
 * 覆盖这些默认值。保存时发送完整快照，与 lib/config.js 的替换式保存语义保持一致。
 * 新增配置项时应同步更新 DEFAULT_CONFIG、types.js、对应表单和后端使用点。
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { apiRequest } from '../lib/api';

const DEFAULT_CONFIG = {
    enableAffect: false,
    affectHalfLife: 30,
    memoryRecallMode: 'balanced',
    enableBilibili: false,
    enableStickers: false,
    stickerLearning: 'off',
    stickerCooldown: 180,
    stickers: [],
    qqProvider: 'napcat',
    onebotToken: '',
    snowlumaUrl: '',
    snowlumaToken: '',
    qqBotAppId: '',
    qqBotSecret: '',
    qqBotMasterId: '',
    qqBotSandbox: false,
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

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function useConfig() {
    const [state, setState] = useState({ config: DEFAULT_CONFIG, baseline: DEFAULT_CONFIG, loading: false, saving: false, error: '', loaded: false });
    const current = useRef(state), loadingRequest = useRef(null), savingRequest = useRef(null), mounted = useRef(true);
    const update = useCallback(change => {
        const next = typeof change === 'function' ? change(current.current) : change;
        current.current = next;
        if (mounted.current) setState(next);
    }, []);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; loadingRequest.current?.abort(); savingRequest.current?.abort(); };
    }, []);

    const setConfig = useCallback(value => update(s => ({ ...s, config: typeof value === 'function' ? value(s.config) : value })), [update]);
    const handleChange = useCallback((key, value) => setConfig(previous => ({ ...previous, [key]: value })), [setConfig]);
    const loadConfig = useCallback(async () => {
        if (current.current.saving) return false;
        if (current.current.loaded && !equal(current.current.config, current.current.baseline)) {
            update(s => ({ ...s, error: '有未保存的配置，刷新前请先保存或重置草稿。' }));
            return false;
        }
        loadingRequest.current?.abort();
        const controller = new AbortController(); loadingRequest.current = controller;
        update(s => ({ ...s, loading: true, error: '' }));
        try {
            const data = await apiRequest('/api/config', { signal: controller.signal });
            if (controller.signal.aborted || loadingRequest.current !== controller) return false;
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('配置数据格式不正确');
            const loaded = { ...DEFAULT_CONFIG, ...data };
            update(s => {
                const draft = { ...loaded };
                for (const key of Object.keys(s.config)) {
                    if (!equal(s.config[key], s.baseline[key])) draft[key] = s.config[key];
                }
                return { ...s, config: draft, baseline: loaded, loaded: true };
            });
            return true;
        } catch (error) {
            if (!controller.signal.aborted) update(s => ({ ...s, error: error.message || '配置加载失败' }));
            return false;
        } finally {
            if (loadingRequest.current === controller) { loadingRequest.current = null; update(s => ({ ...s, loading: false })); }
        }
    }, [update]);

    const saveConfig = useCallback(async (addLog, onSuccess) => {
        if (savingRequest.current) return false;
        if (!current.current.loaded) {
            update(s => ({ ...s, error: '请先成功加载配置，再保存修改。' }));
            return false;
        }
        loadingRequest.current?.abort();
        const snapshot = structuredClone(current.current.config), controller = new AbortController();
        savingRequest.current = controller;
        update(s => ({ ...s, saving: true, error: '' }));
        try {
            await apiRequest('/api/config', { method: 'POST', body: snapshot, signal: controller.signal, expectSuccess: true });
            if (controller.signal.aborted) return false;
            // Edits made while saving remain in config; only the acknowledged snapshot becomes the baseline.
            update(s => ({ ...s, baseline: snapshot }));
            addLog?.('system', '配置已保存');
            onSuccess?.();
            return true;
        } catch (error) {
            if (!controller.signal.aborted) {
                update(s => ({ ...s, error: error.message || '配置保存失败' }));
                addLog?.('error', error.message || '配置保存失败');
            }
            return false;
        } finally {
            if (savingRequest.current === controller) { savingRequest.current = null; update(s => ({ ...s, saving: false })); }
        }
    }, [update]);
    const resetDraft = useCallback(() => update(s => ({ ...s, config: structuredClone(s.baseline), error: '' })), [update]);
    return { config: state.config, setConfig, loadConfig, handleChange, saveConfig, loading: state.loading, saving: state.saving,
        error: state.error, isDirty: !equal(state.config, state.baseline), resetDraft };
}
