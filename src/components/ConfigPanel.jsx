/**
 * 管理面板的状态编排容器。
 *
 * 各 tabs 主要负责展示，跨标签共享的配置、记忆编辑、测试对话、日志和桌宠状态集中在
 * 这里。配置表单是“编辑草稿”，只有点击保存才写入后端；记忆管理接口则按操作立即保存。
 * Web 看板娘只是管理面板装饰，与 Electron 桌宠是两套独立显示和状态。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { MessageSquare, Database, Cpu, Save, Heart, FlaskConical, Monitor, Terminal, Eye, EyeOff, Scaling } from 'lucide-react';

// --- Hooks ---
import { useConfig } from '../hooks/useConfig';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDesktopPet } from '../hooks/useDesktopPet';
import { useDesktopAwareness } from '../hooks/useDesktopAwareness';

// --- Components ---
import { Button, IconButton, TabButton } from './UIComponents';
import CharacterDisplay from './CharacterDisplay';
import LogTerminal from './LogTerminal';
import ConnectTab from './tabs/ConnectTab';
import ModelTab from './tabs/ModelTab';
import PersonaTab from './tabs/PersonaTab';
import MemoryTab from './tabs/MemoryTab';
import TestTab from './tabs/TestTab';
import { apiUrl } from '../lib/api';

const CHARACTER_VIEW_KEY = 'hyacine-character-view';
const DEFAULT_CHARACTER_VIEW = { visible: true, scale: 1 };

function loadCharacterView() {
    // 看板娘显隐/缩放属于当前浏览器偏好，不属于机器人配置，也不会同步给其他设备。
    try {
        const saved = JSON.parse(localStorage.getItem(CHARACTER_VIEW_KEY) || '{}');
        const scale = Number(saved.scale);
        return {
            visible: saved.visible !== false,
            scale: Number.isFinite(scale) ? Math.max(0.6, Math.min(1.2, scale)) : 1,
        };
    } catch {
        return DEFAULT_CHARACTER_VIEW;
    }
}

export default function ConfigPanel() {
    const [activeTab, setActiveTab] = useState('connect');
    const [characterMessage, setCharacterMessage] = useState("系统初始化...");
    const [logs, setLogs] = useState([]);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const [characterView, setCharacterView] = useState(loadCharacterView);
    const containerRef = useRef(null);

    const { config, loadConfig, handleChange, saveConfig } = useConfig();
    const desktopPet = useDesktopPet();
    const desktopAwareness = useDesktopAwareness();

    // --- 记忆管理相关的 State ---
    // sessionMessages 是当前选中会话的编辑副本，saveSessionChanges 后才覆盖后端数据。
    const [sessionList, setSessionList] = useState([]);
    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [sessionMessages, setSessionMessages] = useState([]);
    const [editingMsgIndex, setEditingMsgIndex] = useState(-1);
    const [editBuffer, setEditBuffer] = useState("");
    const [currentSummary, setCurrentSummary] = useState("");
    const [persistentMemoryList, setPersistentMemoryList] = useState([]);
    const [newPersistFact, setNewPersistFact] = useState("");
    const [sessionSearch, setSessionSearch] = useState("");

    // --- 测试对话相关 State ---
    // 测试接口使用独立 test_default session，不会混入真实 QQ 群/私聊 session。
    const [testMessages, setTestMessages] = useState([]);
    const [testInput, setTestInput] = useState("");
    const [testIsMaster, setTestIsMaster] = useState(true);
    const [testLoading, setTestLoading] = useState(false);

    // --- 看板娘列表 ---
    const [avatarList, setAvatarList] = useState([]);

    const addLog = useCallback((level, content, time) => {
        // UI 只保留最近 101 条，完整运行日志仍以终端输出为准。
        setLogs(prev => [...prev.slice(-100), { level, content, time }]);
    }, []);

    // WebSocket 连接
    useWebSocket(addLog, setCharacterMessage);

    // 初始化只读取配置与角色参考图；记忆列表在切到记忆页后再按需加载。
    const fetchAvatars = useCallback(() => {
        fetch(apiUrl('/api/avatars'))
            .then(res => res.json())
            .then(data => { setAvatarList(data); addLog('info', `已加载 ${data.length} 个角色形象`); })
            .catch(() => addLog('error', '加载角色列表失败'));
    }, [addLog]);

    useEffect(() => { loadConfig(); fetchAvatars(); }, [loadConfig, fetchAvatars]);

    useEffect(() => {
        try {
            localStorage.setItem(CHARACTER_VIEW_KEY, JSON.stringify(characterView));
        } catch {
            // Keep the controls usable for this session when storage is unavailable.
        }
    }, [characterView]);

    // --- 记忆管理 ---
    const fetchSessionList = () => {
        fetch(apiUrl('/api/memory/list')).then(res => res.json()).then(data => setSessionList(data));
    };

    const selectSession = (id) => {
        setCurrentSessionId(id);
        fetch(apiUrl(`/api/memory/${id}`)).then(res => res.json()).then(data => setSessionMessages(data));
        fetch(apiUrl(`/api/summary/${id}`)).then(res => res.json()).then(data => setCurrentSummary(data.summary || ''));
    };

    const saveSummary = () => {
        if (!currentSessionId) return;
        fetch(apiUrl(`/api/summary/${currentSessionId}`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary: currentSummary })
        }).then(() => addLog('system', `会话 ${currentSessionId} 摘要已更新`));
    };

    const fetchPersistentMemory = () => {
        fetch(apiUrl('/api/persistent-memory')).then(res => res.json()).then(data => setPersistentMemoryList(data));
    };

    const savePersistentMemory = () => {
        fetch(apiUrl('/api/persistent-memory'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(persistentMemoryList)
        }).then(() => addLog('system', '持久化记忆已保存'));
    };

    const addPersistFact = () => {
        if (!newPersistFact.trim()) return;
        setPersistentMemoryList(prev => [...prev, { fact: newPersistFact.trim(), source: 'manual', time: new Date().toISOString() }]);
        setNewPersistFact('');
    };

    const removePersistFact = (index) => {
        setPersistentMemoryList(prev => prev.filter((_, i) => i !== index));
    };

    // --- 测试对话 ---
    const sendTestMessage = async () => {
        if (!testInput.trim() || testLoading) return;
        const userMsg = { role: 'user', content: testInput.trim() };
        setTestMessages(prev => [...prev, userMsg]);
        setTestInput('');
        setTestLoading(true);
        try {
            const res = await fetch(apiUrl('/api/test-chat'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg.content, isMaster: testIsMaster, scenario: 'default' })
            });
            const data = await res.json();
            if (data.error) {
                setTestMessages(prev => [...prev, { role: 'system', content: `错误: ${data.error}` }]);
            } else {
                setTestMessages(prev => [...prev, { role: 'assistant', content: data.reply, isImage: data.isImage, imagePrompt: data.imagePrompt }]);
            }
        } catch (e) {
            setTestMessages(prev => [...prev, { role: 'system', content: `请求失败: ${e.message}` }]);
        }
        setTestLoading(false);
    };

    const clearTestChat = () => {
        setTestMessages([]);
        fetch(apiUrl('/api/test-chat/default'), { method: 'DELETE' });
    };

    const startEdit = (index, content) => { setEditingMsgIndex(index); setEditBuffer(content); };
    const saveEdit = (index) => {
        const newList = [...sessionMessages]; newList[index].content = editBuffer;
        setSessionMessages(newList); setEditingMsgIndex(-1);
    };
    const deleteMsg = (index) => { setSessionMessages(sessionMessages.filter((_, i) => i !== index)); };

    const saveSessionChanges = () => {
        if (!currentSessionId) return;
        fetch(apiUrl(`/api/memory/${currentSessionId}`), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessionMessages)
        }).then(() => { addLog('system', `会话 ${currentSessionId} 记忆已更新`); setCharacterMessage("记忆修改已生效！🧠"); });
    };

    const deleteSession = (id, e) => {
        e.stopPropagation();
        if (!confirm("确定要遗忘这个人的所有事情吗？")) return;
        fetch(apiUrl(`/api/memory/${id}`), { method: 'DELETE' }).then(() => {
            fetchSessionList();
            if (currentSessionId === id) { setCurrentSessionId(null); setSessionMessages([]); }
            addLog('system', `会话 ${id} 已被遗忘`);
        });
    };

    useEffect(() => { if (activeTab === 'memory') { fetchSessionList(); fetchPersistentMemory(); } }, [activeTab]);

    const addKeyword = () => {
        const input = document.getElementById('keyword-input');
        const val = input.value.trim();
        if (val && !config.customKeywords.includes(val)) { handleChange('customKeywords', [...config.customKeywords, val]); input.value = ''; }
    };
    const removeKeyword = (wordToRemove) => { handleChange('customKeywords', config.customKeywords.filter(w => w !== wordToRemove)); };

    useEffect(() => {
        switch (activeTab) {
            case 'persona': setCharacterMessage("..."); break;
            case 'memory': setCharacterMessage("哎呀，是读心术吗？՞⸝⸝'ᜊ'⸝⸝՞ "); break;
            case 'test': setCharacterMessage("来对练一下吧！( •̀ ω •́ )✧"); break;
            case 'connect': setCharacterMessage("准备好连接世界了吗？⌯˃ ᵕ ˂⌯"); break;
            case 'ai': setCharacterMessage("让我猜猜，你是怎么看待我的？( •̀ ω •́ )✧"); break;
        }
    }, [activeTab]);

    const handleInteractionChange = (index, newValue) => {
        const list = [...config.interactions]; list[index] = newValue; handleChange('interactions', list);
    };

    const handleSave = () => {
        // tabs 对 config 的修改都在同一个对象中，底部按钮一次提交完整配置快照。
        saveConfig(addLog, () => setCharacterMessage("我焕然一新啦！✨"));
    };

    const isPersonaTab = activeTab === 'persona';
    const isCharacterHidden = isPersonaTab || !characterView.visible;
    const springTransition = { type: 'spring', stiffness: 520, damping: 48, mass: 1 };

    return (
        <div ref={containerRef} className="app-shell">
            <div className="anime-pattern" aria-hidden="true" />
            <LayoutGroup>
                <div className="app-stage">
                    <CharacterDisplay
                        hidden={isCharacterHidden}
                        scale={characterView.scale}
                        characterMessage={characterMessage}
                        config={config}
                        setCharacterMessage={setCharacterMessage}
                        transition={springTransition}
                    />

                    <motion.main
                        layout
                        transition={springTransition}
                        className={`config-wrap ${isCharacterHidden ? 'config-wrap-wide' : ''}`}
                    >
                        <motion.div layout="position" className="glass-panel">
                            <nav className="panel-tabs">
                                <TabButton active={activeTab} id="connect" icon={Cpu} label="连接" onClick={setActiveTab} />
                                <TabButton active={activeTab} id="ai" icon={MessageSquare} label="模型" onClick={setActiveTab} />
                                <TabButton active={activeTab} id="persona" icon={Heart} label="人设" onClick={setActiveTab} />
                                <TabButton active={activeTab} id="memory" icon={Database} label="记忆" onClick={setActiveTab} />
                                <TabButton active={activeTab} id="test" icon={FlaskConical} label="测试" onClick={setActiveTab} />
                            </nav>

                            <div className="panel-content custom-scrollbar">
                                <AnimatePresence mode="wait">
                                    {activeTab === 'connect' && <ConnectTab key="connect" config={config} handleChange={handleChange} addKeyword={addKeyword} removeKeyword={removeKeyword} desktopAwareness={desktopAwareness} />}
                                    {activeTab === 'ai' && <ModelTab key="ai" config={config} handleChange={handleChange} avatarList={avatarList} fetchAvatars={fetchAvatars} setCharacterMessage={setCharacterMessage} />}
                                    {activeTab === 'persona' && <PersonaTab key="persona" config={config} handleChange={handleChange} handleInteractionChange={handleInteractionChange} />}
                                    {activeTab === 'memory' && <MemoryTab key="memory" config={config} handleChange={handleChange} sessionList={sessionList} sessionSearch={sessionSearch} setSessionSearch={setSessionSearch} currentSessionId={currentSessionId} sessionMessages={sessionMessages} editingMsgIndex={editingMsgIndex} editBuffer={editBuffer} currentSummary={currentSummary} persistentMemoryList={persistentMemoryList} newPersistFact={newPersistFact} fetchSessionList={fetchSessionList} selectSession={selectSession} saveSummary={saveSummary} deleteSession={deleteSession} startEdit={startEdit} saveEdit={saveEdit} deleteMsg={deleteMsg} saveSessionChanges={saveSessionChanges} savePersistentMemory={savePersistentMemory} addPersistFact={addPersistFact} removePersistFact={removePersistFact} setNewPersistFact={setNewPersistFact} setCurrentSummary={setCurrentSummary} setEditBuffer={setEditBuffer} setEditingMsgIndex={setEditingMsgIndex} />}
                                    {activeTab === 'test' && <TestTab key="test" testMessages={testMessages} testInput={testInput} testIsMaster={testIsMaster} testLoading={testLoading} setTestInput={setTestInput} setTestIsMaster={setTestIsMaster} sendTestMessage={sendTestMessage} clearTestChat={clearTestChat} />}
                                </AnimatePresence>
                            </div>

                            <footer className="panel-footer">
                                <div className="flex items-center gap-2">
                                    <div className="character-control" title={isPersonaTab ? '人设页面会自动隐藏看板娘' : 'Web 看板娘显示与尺寸'}>
                                        <IconButton
                                            icon={characterView.visible ? Eye : EyeOff}
                                            label={characterView.visible ? '隐藏 Web 看板娘' : '显示 Web 看板娘'}
                                            disabled={isPersonaTab}
                                            onClick={() => setCharacterView(prev => ({ ...prev, visible: !prev.visible }))}
                                        />
                                        <label className="character-scale-control" title="调整 Web 看板娘立绘大小">
                                            <Scaling aria-hidden="true" />
                                            <input
                                                type="range"
                                                aria-label="Web 看板娘立绘大小"
                                                min="0.6"
                                                max="1.2"
                                                step="0.05"
                                                value={characterView.scale}
                                                disabled={isPersonaTab || !characterView.visible}
                                                onChange={(event) => setCharacterView(prev => ({
                                                    ...prev,
                                                    scale: Number(event.target.value),
                                                }))}
                                            />
                                            <span>{Math.round(characterView.scale * 100)}%</span>
                                        </label>
                                    </div>
                                    <div
                                        className="pet-control"
                                        title={desktopPet.available ? '显示或隐藏 Electron 桌宠窗口' : '仅在 Electron 桌面版中可用'}
                                    >
                                        <Monitor className="h-4 w-4" />
                                        <span>桌宠</span>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-label="桌宠显示开关"
                                            aria-checked={desktopPet.visible}
                                            disabled={!desktopPet.available || desktopPet.loading}
                                            onClick={() => desktopPet.setVisible(!desktopPet.visible)}
                                            className={`ui-switch ${desktopPet.visible ? 'ui-switch-on' : ''}`}
                                        >
                                            <span />
                                        </button>
                                    </div>
                                    <Button icon={Terminal} variant="secondary" onClick={() => setIsLogOpen(true)} className="hidden sm:inline-flex">日志</Button>
                                </div>
                                <Button icon={Save} variant="primary" onClick={handleSave}>保存所有配置</Button>
                            </footer>
                        </motion.div>
                    </motion.main>
                </div>
            </LayoutGroup>

            <LogTerminal logs={logs} isLogOpen={isLogOpen} setIsLogOpen={setIsLogOpen} containerRef={containerRef} />
        </div>
    );
}
