import { qqConnectionLabel } from '../lib/qqChannels';
/** Workspace shell. Data ownership lives in hooks; pages retain their editing state. */
import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { AlertCircle, Cable, Check, ChevronRight, Database, Eye, EyeOff, Heart, LayoutDashboard, LoaderCircle, MessageCircle, Monitor, RefreshCw, RotateCcw, Save, Search, Settings2, Terminal, WandSparkles, X } from 'lucide-react';
import { useConfig } from '../hooks/useConfig';
import { useMemory } from '../hooks/useMemory';
import { useTestChat } from '../hooks/useTestChat';
import { useWebSocket } from '../hooks/useWebSocket';
import { useRuntimeStatus } from '../hooks/useRuntimeStatus';
import { useDesktopPet } from '../hooks/useDesktopPet';
import { useDesktopAwareness } from '../hooks/useDesktopAwareness';
import { apiRequest } from '../lib/api';
import { Button, IconButton } from './UIComponents';
import PinkSelect from './PinkSelect';
import CharacterDisplay from './CharacterDisplay';
import OverviewTab from './OverviewTab';
import CommandPalette from './CommandPalette';
import '../styles/workspace.css';
import '../styles/atelier.css';
import ArtEmblem from './ArtEmblem';

const ExtensionsTab = lazy(() => import('./tabs/ExtensionsTab'));
const ConnectTab = lazy(() => import('./tabs/ConnectTab'));
const ModelTab = lazy(() => import('./tabs/ModelTab'));
const PersonaTab = lazy(() => import('./tabs/PersonaTab'));
const MemoryTab = lazy(() => import('./tabs/MemoryTab'));
const TestTab = lazy(() => import('./tabs/TestTab'));
const LogTerminal = lazy(() => import('./LogTerminal'));
const PAGES = [
    { id: 'overview', label: '工作台', icon: LayoutDashboard, keywords: 'home dashboard' },
    { id: 'test', label: '对话', icon: MessageCircle, keywords: 'chat 测试' },
    { id: 'memory', label: '记忆', icon: Database, keywords: 'memory 摘要 黑话' },
    { id: 'persona', label: '人设', icon: Heart, keywords: '风堇 persona 角色' },
    { id: 'ai', label: '模型', icon: WandSparkles, keywords: 'AI api key 生图' },
    { id: 'extensions', label: '扩展', icon: Settings2, keywords: '表情 B站 bilibili 插件' },
    { id: 'connect', label: '连接', icon: Cable, keywords: 'QQ NapCat SnowLuma 官方 Webhook 主动发言' },
];
const VIEW_KEY = 'hyacine-character-view';
function readView() {
    try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); return { visible: v.visible !== false, animated: v.animated !== false, scale: Math.max(.6, Math.min(1.2, Number(v.scale) || 1)), art: typeof v.art === 'string' ? v.art : '' }; }
    catch { return { visible: true, animated: true, scale: 1, art: '' }; }
}
function ConfirmDialog({ value, onClose }) {
    const ref = useRef(null), [pending, setPending] = useState(false);
    useEffect(() => { if (!value) return; const previous = document.activeElement, element = ref.current; element.showModal(); return () => { element.close(); previous?.focus?.(); }; }, [value]);
    return <dialog ref={ref} className="confirm-dialog" aria-labelledby="confirm-title" onCancel={e => { if (pending) e.preventDefault(); else onClose(); }}>
        <h2 id="confirm-title">{value?.title}</h2><p>{value?.detail}</p><div className="flex justify-end gap-2"><Button disabled={pending} onClick={onClose}>取消</Button><Button variant="primary" disabled={pending} onClick={async () => { setPending(true); try { const result = await value.run(); if (result !== false) onClose(); } finally { setPending(false); } }}>{pending ? '处理中…' : '确认'}</Button></div>
    </dialog>;
}
function LoadingPage() { return <div className="workspace-loading" role="status"><LoaderCircle className="animate-spin" size={22} /><span>正在加载</span></div>; }

export default function ConfigPanel() {
    const [activeTab, setActiveTab] = useState('overview'), [visited, setVisited] = useState(['overview']);
    const [logs, setLogs] = useState([]), [isLogOpen, setIsLogOpen] = useState(false);
    const [palette, setPalette] = useState(false), [confirmation, setConfirmation] = useState(null);
    const [toast, setToast] = useState(null), [characterView, setCharacterView] = useState(readView);
    const [characterMessage, setCharacterMessage] = useState(''), [avatarList, setAvatarList] = useState([]);
    const containerRef = useRef(null), logId = useRef(0), panelRef = useRef(null), avatarRequest = useRef(null);
    const addLog = useCallback((level, content, time) => {
        const entry = { id: ++logId.current, level, content: String(content), time: time || new Date().toLocaleTimeString('zh-CN', { hour12: false }) };
        setLogs(prev => [...prev.slice(-199), entry]);
        if (level === 'error' || level === 'system') setToast({ id: entry.id, level, content: entry.content });
    }, []);
    const settings = useConfig(), memory = useMemory(addLog), chat = useTestChat(addLog);
    const { config, handleChange, loadConfig, saveConfig } = settings;
    const { load: loadMemory } = memory;
    const runtime = useRuntimeStatus(), desktopPet = useDesktopPet(), desktopAwareness = useDesktopAwareness();
    const { refresh: refreshStatus } = runtime;
    useWebSocket(addLog);
    const fetchAvatars = useCallback(async () => { avatarRequest.current?.abort(); const controller = new AbortController(); avatarRequest.current = controller; try { const data = await apiRequest('/api/avatars', { signal: controller.signal }); if (!controller.signal.aborted) setAvatarList(Array.isArray(data) ? data : []); } catch (e) { if (!controller.signal.aborted) addLog('error', e.message); } }, [addLog]);
    useEffect(() => { const timer = setTimeout(() => { void loadConfig(); void fetchAvatars(); }, 0); return () => { clearTimeout(timer); avatarRequest.current?.abort(); }; }, [loadConfig, fetchAvatars]);
    useEffect(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(characterView)); } catch { /* Browser preference is optional. */ } }, [characterView]);
    useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.level === 'error' ? 7000 : 3500); return () => clearTimeout(timer); }, [toast]);
    const navigate = useCallback(id => { setVisited(previous => previous.includes(id) ? previous : [...previous, id]); setActiveTab(id); }, []);
    const handleSave = useCallback(async () => { const ok = await saveConfig(addLog); if (ok) void refreshStatus(); return ok; }, [saveConfig, addLog, refreshStatus]);
    useEffect(() => { if (activeTab !== 'memory') return; const timer = setTimeout(() => { void loadMemory(); }, 0); return () => clearTimeout(timer); }, [activeTab, loadMemory]);
    useEffect(() => { panelRef.current?.scrollTo({ top: 0 }); }, [activeTab]);
    useEffect(() => {
        const keyDown = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(v => !v); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!settings.loading) void handleSave(); } };
        window.addEventListener('keydown', keyDown); return () => window.removeEventListener('keydown', keyDown);
    }, [handleSave, settings.loading]);
    useEffect(() => { if (!settings.isDirty && !memory.dirty?.any) return; const warn = event => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [settings.isDirty, memory.dirty?.any]);
    const discard = () => setConfirmation({ title: '还原配置草稿？', detail: '恢复为上一次保存的配置。记忆编辑不受影响。', run: () => settings.resetDraft() });
    const commands = [...PAGES.map(page => ({ ...page, run: () => navigate(page.id) })), { label: '保存配置', icon: Save, run: handleSave }, { label: '查看实时日志', icon: Terminal, run: () => setIsLogOpen(true) }];
    const currentPage = PAGES.find(page => page.id === activeTab);
    const status = runtime.status;
    const shapeOptions = [{ value: '', label: '风堇 · 动态姿势' }, { value: '@original', label: '本地原始立绘' }, ...avatarList.map(a => ({ value: a.fileName, label: a.name }))];
    if (characterView.art && !shapeOptions.some(a => a.value === characterView.art)) shapeOptions.push({ value: characterView.art, label: characterView.art });
    return <MotionConfig reducedMotion="user"><div className="workspace atelier" data-scene={activeTab} data-motion={characterView.animated ? "on" : "off"} ref={containerRef}>
        <div className="scene-atmosphere" aria-hidden="true"><div className="scene-orbit" /><ArtEmblem className="scene-flower" /><i className="scene-petal petal-one" /><i className="scene-petal petal-two" /><i className="scene-petal petal-three" /></div><a className="skip-link" href="#workspace-content">跳到主要内容</a>
        <header className="workspace-topbar"><a href="#" className="workspace-brand" onClick={e => { e.preventDefault(); navigate('overview'); }}><span className="brand-symbol"><ArtEmblem name="overview" /></span><span>HYACINE<span className="brand-ai"> AI</span><small>风堇 · 控制台</small></span></a>
            <div className="workspace-breadcrumb">工作空间<ChevronRight size={13} /><strong>{currentPage.label}</strong></div>
            <div className="topbar-actions"><span className="connection-pill" title={runtime.error || '后端服务状态，不代表 QQ 或模型连接'}><span className={`status-dot ${status?.ready ? 'is-online' : ''}`} />{runtime.loading && !status ? '连接中' : status?.ready ? '后端在线' : '后端离线'}</span><button type="button" className="command-trigger" aria-label="快速跳转" onClick={() => setPalette(true)}><Search size={16} /><span>快速跳转</span><kbd>⌘ K</kbd></button><IconButton icon={characterView.visible ? Eye : EyeOff} label="显示或隐藏看板娘" className="portrait-toggle" onClick={() => setCharacterView(v => ({ ...v, visible: !v.visible }))} /></div>
        </header>
        <div className={`workspace-layout ${characterView.visible ? '' : 'portrait-hidden'}`}>
            <nav className="workspace-nav" aria-label="主导航"><span className="nav-group-label">工作空间</span>{PAGES.map(({ id, label }) => <button type="button" key={id} title={label} className={`workspace-nav-item ${activeTab === id ? 'is-active' : ''}`} aria-current={activeTab === id ? 'page' : undefined} onClick={() => navigate(id)}>{id !== 'extensions' && <ArtEmblem name={id} />}<span>{label}</span>{id === 'memory' && memory.dirty?.any && <i aria-label="未保存" />}</button>)}<div className="nav-bottom"><button type="button" className="workspace-nav-item" onClick={() => setIsLogOpen(true)}><Terminal size={18} /><span>运行日志</span>{logs.some(l => l.level === 'error') && <i className="error-dot" />}</button><span className="nav-version">{status?.version ? `VERSION ${status.version}` : 'HYACINE-AI'}</span></div></nav>
            <main className="workspace-main" id="workspace-content" tabIndex={-1}>
                {settings.error && <div className="workspace-error" role="alert"><AlertCircle size={17} /><span>{settings.error}</span><Button size="sm" onClick={() => loadConfig()}>重试</Button></div>}
                <div ref={panelRef} className={`workspace-content custom-scrollbar ${activeTab === 'test' ? 'is-chat' : ''}`}>
                    {settings.loading && !config.charName ? <LoadingPage /> : visited.map(id => <div key={id} className={`workspace-page ${id === 'test' ? 'chat-page' : ''}`} hidden={activeTab !== id}><Suspense fallback={<LoadingPage />}>
                        {id === 'overview' && <OverviewTab config={config} status={status} statusError={runtime.error} loading={runtime.loading} onNavigate={navigate} onLogs={() => setIsLogOpen(true)} logs={logs} dirty={settings.isDirty} />}
                        {id === 'extensions' && <ExtensionsTab config={config} handleChange={handleChange} />}
                        {id === 'connect' && <ConnectTab config={config} handleChange={handleChange} removeKeyword={word => handleChange('customKeywords', config.customKeywords.filter(k => k !== word))} desktopAwareness={desktopAwareness} onLog={addLog} runtimeStatus={status} />}
                        {id === 'ai' && <ModelTab config={config} handleChange={handleChange} avatarList={avatarList} fetchAvatars={fetchAvatars} setCharacterMessage={setCharacterMessage} />}
                        {id === 'persona' && <PersonaTab config={config} handleChange={handleChange} handleInteractionChange={(i, value) => handleChange('interactions', config.interactions.map((text, index) => index === i ? value : text))} />}
                        {id === 'memory' && <><MemoryTab {...memory} config={config} handleChange={handleChange} deleteSession={(sessionId, event) => { event?.stopPropagation(); setConfirmation({ title: '删除此会话？', detail: '删除会话记录和摘要，长期记忆将保留。', run: () => memory.deleteSession(sessionId) }); }} /></>}
                        {id === 'test' && <TestTab {...chat} charName={config.charName === 'AI 助手' ? '风堇' : config.charName} configDirty={settings.isDirty} onSaveConfig={handleSave} />}
                    </Suspense></div>)}
                </div>
                <footer className="workspace-savebar"><div className="savebar-state" role="status">{settings.saving ? <LoaderCircle size={16} className="animate-spin" /> : settings.isDirty ? <span className="dirty-mark" /> : <Check size={16} />}<span>{settings.loading ? '读取配置中' : settings.error ? '配置未同步' : settings.saving ? '正在保存' : settings.isDirty ? '配置有未保存修改' : '配置已同步'}</span>{memory.dirty?.any && <button type="button" onClick={() => navigate('memory')}>记忆待保存</button>}</div><div className="flex items-center gap-2">{settings.isDirty && <IconButton icon={RotateCcw} label="还原配置草稿" disabled={settings.saving} onClick={discard} />}<Button variant="primary" icon={settings.saving ? LoaderCircle : Save} disabled={settings.loading || settings.saving || !settings.isDirty} onClick={handleSave}>保存配置</Button></div></footer>
            </main>
            {characterView.visible && <div className="workspace-character"><CharacterDisplay hidden={false} config={config} scale={characterView.scale} imageSrc={characterView.art === '@original' ? '/character.png' : characterView.art ? `/api/avatars/${encodeURIComponent(characterView.art)}` : ''} page={activeTab} thinking={activeTab === 'test' && (chat.testLoading || Boolean(chat.testInput.trim()))} animated={characterView.animated} characterMessage={characterMessage} setCharacterMessage={setCharacterMessage} onChat={() => navigate('test')} />
                <details className="portrait-settings"><summary aria-label="看板娘设置"><Settings2 size={16} /></summary><div><label className="field-group"><span className="field-label">看板娘形象</span><PinkSelect label="看板娘形象" value={characterView.art} options={shapeOptions} onChange={art => setCharacterView(v => ({ ...v, art }))} /></label><label className="field-group"><span className="field-label">立绘大小 <span>{Math.round(characterView.scale * 100)}%</span></span><input aria-label="立绘大小" type="range" min=".6" max="1.2" step=".05" value={characterView.scale} onChange={e => setCharacterView(v => ({ ...v, scale: Number(e.target.value) }))} /></label><div className="portrait-pet-toggle"><span>动态效果</span><button type="button" className={`ui-switch ${characterView.animated ? 'ui-switch-on' : ''}`} role="switch" aria-label="动态效果" aria-checked={characterView.animated} onClick={() => setCharacterView(v => ({ ...v, animated: !v.animated }))}><span /></button></div><div className="portrait-pet-toggle"><Monitor size={16} /><span>桌宠</span><button type="button" className={`ui-switch ${desktopPet.available && desktopPet.visible ? 'ui-switch-on' : ''}`} role="switch" aria-label="显示桌宠" aria-checked={desktopPet.available && desktopPet.visible} disabled={!desktopPet.available || desktopPet.loading} onClick={() => desktopPet.setVisible(!desktopPet.visible)}><span /></button></div></div></details>
                <button type="button" className="portrait-status" onClick={() => { void runtime.refresh(); }}><RefreshCw size={12} />{qqConnectionLabel(status?.qq)}</button>
            </div>}
        </div>
        <Suspense fallback={null}>{isLogOpen && <LogTerminal logs={logs} isLogOpen={isLogOpen} setIsLogOpen={setIsLogOpen} containerRef={containerRef} />}</Suspense>
        {palette && <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />}
        <ConfirmDialog value={confirmation} onClose={() => setConfirmation(null)} />
        {toast && <div className={`workspace-toast ${toast.level === 'error' ? 'is-error' : ''}`} role={toast.level === 'error' ? 'alert' : 'status'}>{toast.level === 'error' ? <AlertCircle size={17} /> : <Check size={17} />}<span>{toast.content}</span><button type="button" aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div></MotionConfig>;
}
