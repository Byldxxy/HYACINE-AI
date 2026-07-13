// components/ConfigPanel.jsx - 面板容器
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { MessageSquare, Database, Cpu, Save, Heart, FlaskConical, Monitor, Terminal } from 'lucide-react';

// --- Hooks ---
import { useConfig } from '../hooks/useConfig';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDesktopPet } from '../hooks/useDesktopPet';

// --- Components ---
import { Button, TabButton } from './UIComponents';
import CharacterDisplay from './CharacterDisplay';
import LogTerminal from './LogTerminal';
import ConnectTab from './tabs/ConnectTab';
import ModelTab from './tabs/ModelTab';
import PersonaTab from './tabs/PersonaTab';
import MemoryTab from './tabs/MemoryTab';
import TestTab from './tabs/TestTab';
import { apiUrl } from '../lib/api';

export default function ConfigPanel() {
    const [activeTab, setActiveTab] = useState('connect');
    const [characterMessage, setCharacterMessage] = useState("系统初始化...");
    const [logs, setLogs] = useState([]);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const containerRef = useRef(null);

    const { config, loadConfig, handleChange, saveConfig } = useConfig();
    const desktopPet = useDesktopPet();

    // --- 记忆管理相关的 State ---
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
    const [testMessages, setTestMessages] = useState([]);
    const [testInput, setTestInput] = useState("");
    const [testIsMaster, setTestIsMaster] = useState(true);
    const [testLoading, setTestLoading] = useState(false);

    // --- 看板娘列表 ---
    const [avatarList, setAvatarList] = useState([]);

    const addLog = useCallback((level, content, time) => {
        setLogs(prev => [...prev.slice(-100), { level, content, time }]);
    }, []);

    // WebSocket 连接
    useWebSocket(addLog, setCharacterMessage);

    // 初始化加载
    const fetchAvatars = useCallback(() => {
        fetch(apiUrl('/api/avatars'))
            .then(res => res.json())
            .then(data => { setAvatarList(data); addLog('info', `已加载 ${data.length} 个角色形象`); })
            .catch(() => addLog('error', '加载角色列表失败'));
    }, [addLog]);

    useEffect(() => { loadConfig(); fetchAvatars(); }, [loadConfig, fetchAvatars]);

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
        saveConfig(addLog, () => setCharacterMessage("我焕然一新啦！✨"));
    };

    const isPersonaTab = activeTab === 'persona';
    const springTransition = { type: 'spring', stiffness: 520, damping: 48, mass: 1 };

    return (
        <div ref={containerRef} className="app-shell">
            <div className="anime-pattern" aria-hidden="true" />
            <LayoutGroup>
                <div className="app-stage">
                    <CharacterDisplay
                        hidden={isPersonaTab}
                        characterMessage={characterMessage}
                        config={config}
                        setCharacterMessage={setCharacterMessage}
                        transition={springTransition}
                    />

                    <motion.main
                        layout
                        transition={springTransition}
                        className={`config-wrap ${isPersonaTab ? 'config-wrap-wide' : ''}`}
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
                                    {activeTab === 'connect' && <ConnectTab key="connect" config={config} handleChange={handleChange} addKeyword={addKeyword} removeKeyword={removeKeyword} />}
                                    {activeTab === 'ai' && <ModelTab key="ai" config={config} handleChange={handleChange} avatarList={avatarList} fetchAvatars={fetchAvatars} setCharacterMessage={setCharacterMessage} />}
                                    {activeTab === 'persona' && <PersonaTab key="persona" config={config} handleChange={handleChange} handleInteractionChange={handleInteractionChange} />}
                                    {activeTab === 'memory' && <MemoryTab key="memory" config={config} handleChange={handleChange} sessionList={sessionList} sessionSearch={sessionSearch} setSessionSearch={setSessionSearch} currentSessionId={currentSessionId} sessionMessages={sessionMessages} editingMsgIndex={editingMsgIndex} editBuffer={editBuffer} currentSummary={currentSummary} persistentMemoryList={persistentMemoryList} newPersistFact={newPersistFact} fetchSessionList={fetchSessionList} selectSession={selectSession} saveSummary={saveSummary} deleteSession={deleteSession} startEdit={startEdit} saveEdit={saveEdit} deleteMsg={deleteMsg} saveSessionChanges={saveSessionChanges} savePersistentMemory={savePersistentMemory} addPersistFact={addPersistFact} removePersistFact={removePersistFact} setNewPersistFact={setNewPersistFact} setCurrentSummary={setCurrentSummary} setEditBuffer={setEditBuffer} setEditingMsgIndex={setEditingMsgIndex} />}
                                    {activeTab === 'test' && <TestTab key="test" testMessages={testMessages} testInput={testInput} testIsMaster={testIsMaster} testLoading={testLoading} setTestInput={setTestInput} setTestIsMaster={setTestIsMaster} sendTestMessage={sendTestMessage} clearTestChat={clearTestChat} />}
                                </AnimatePresence>
                            </div>

                            <footer className="panel-footer">
                                <div className="flex items-center gap-2">
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
