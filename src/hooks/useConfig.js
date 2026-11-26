/** WebUI drafts keep separate display defaults and the exact masked server snapshot. */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { apiRequest } from '../lib/api';
import { configPatch, equal, mergeConfig } from '../lib/editorDrafts.mjs';

const DEFAULT_CONFIG = {
    enableAffect: false,
    affectHalfLife: 30,
    memoryRecallMode: 'balanced',
    enableBilibili: false,
    enableStickers: false,
    enableVoiceTranscription: false,
    voiceModel: 'whisper-1',
    voiceEndpoint: '',
    voiceApiKey: '',
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
    temperature: 0.7,
    maxReplyLength: 1000,
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
    shortMem: 10,
    longMem: 0,
    persistMem: false,
    alwaysReply: false,
    enableProactive: false,
    proactiveInterval: 300,
    proactiveCooldown: 600,
    proactiveThreshold: 0.6,
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

function displayConfig(server) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) throw new Error('配置数据格式不正确');
    const result = { ...DEFAULT_CONFIG, ...server };
    delete result._secretVersions;
    delete result._revision;
    return result;
}

export function useConfig() {
    const [state, setState] = useState({ config: DEFAULT_CONFIG, baseline: DEFAULT_CONFIG, server: {}, conflicts: [], loading: false, saving: false, error: '', loaded: false });
    const current = useRef(state), loadingRequest = useRef(null), savingRequest = useRef(null), mounted = useRef(true);
    const update = useCallback(change => {
        const next = change(current.current);
        current.current = next;
        if (mounted.current) setState(next);
    }, []);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; loadingRequest.current?.abort(); savingRequest.current?.abort(); };
    }, []);

    const setConfig = useCallback(value => update(s => ({ ...s, config: typeof value === 'function' ? value(s.config) : value })), [update]);
    const handleChange = useCallback((key, value) => setConfig(previous => ({ ...previous, [key]: value })), [setConfig]);
    const acceptServer = useCallback((server, snapshot) => {
        const remote = displayConfig(server);
        update(s => ({ ...s, ...mergeConfig({ draft: s.config, previous: snapshot || s.baseline, remote, oldServer: s.server,
            server, conflicts: s.conflicts, acknowledge: Boolean(snapshot) || !s.loaded }), server, baseline: remote, loaded: true }));
    }, [update]);
    const loadConfig = useCallback(async () => {
        if (savingRequest.current) return false;
        loadingRequest.current?.abort();
        const controller = new AbortController(); loadingRequest.current = controller;
        update(s => ({ ...s, loading: true, error: '' }));
        try {
            const server = await apiRequest('/api/config', { signal: controller.signal });
            if (controller.signal.aborted) return false;
            acceptServer(server);
            return true;
        } catch (error) {
            if (!controller.signal.aborted) update(s => ({ ...s, error: error.message || '配置加载失败' }));
            return false;
        } finally {
            if (loadingRequest.current === controller) { loadingRequest.current = null; update(s => ({ ...s, loading: false })); }
        }
    }, [acceptServer, update]);

    const saveConfig = useCallback(async (addLog, onSuccess) => {
        const { loaded, config, baseline, server, conflicts } = current.current;
        if (savingRequest.current || conflicts.length) return false;
        if (!loaded) { update(s => ({ ...s, error: '请先加载配置。' })); return false; }
        const snapshot = structuredClone(config), body = configPatch(snapshot, baseline, server);
        if (!Object.keys(body.changes).length) return true;
        loadingRequest.current?.abort();
        const controller = new AbortController(); savingRequest.current = controller;
        update(s => ({ ...s, saving: true, error: '' }));
        let conflict = false;
        try {
            const result = await apiRequest('/api/config', { method: 'PATCH', body, signal: controller.signal, expectSuccess: true });
            if (controller.signal.aborted) return false;
            acceptServer(result.config, snapshot);
            addLog?.('system', '配置已保存'); onSuccess?.();
            return true;
        } catch (error) {
            if (!controller.signal.aborted) {
                conflict = error.status === 409;
                if (!conflict) { update(s => ({ ...s, error: error.message })); addLog?.('error', error.message); }
            }
            return false;
        } finally {
            if (savingRequest.current === controller) { savingRequest.current = null; update(s => ({ ...s, saving: false })); }
            if (conflict) await loadConfig();
        }
    }, [acceptServer, loadConfig, update]);
    const resolveConflict = (key, useServer) => update(s => ({ ...s, config: useServer ? { ...s.config, [key]: s.baseline[key] } : s.config,
        conflicts: s.conflicts.filter(field => field !== key) }));
    const resetDraft = useCallback(() => update(s => ({ ...s, config: structuredClone(s.baseline), conflicts: [], error: '' })), [update]);
    const isDirty = useMemo(() => !equal(state.config, state.baseline), [state.config, state.baseline]);
    return { config: state.config, baseline: state.baseline, conflicts: state.conflicts, resolveConflict, setConfig, loadConfig, handleChange, saveConfig,
        loading: state.loading, saving: state.saving, error: state.error, isDirty, resetDraft };
}
