/**
 * 记忆查看与人工编辑页。
 *
 * 近期会话、长期摘要和持久化事实分别对应三个后端数据源。编辑消息和摘要使用本地副本，
 * 需点击各自保存按钮；删除会话和持久化事实的最终保存路径由 ConfigPanel 编排。
 */
import React, { useMemo } from 'react';
import {
    BookOpen,
    Brain,
    Check,
    Database,
    Edit2,
    MessageSquare,
    Plus,
    RefreshCw,
    Save,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import {
    Button,
    IconButton,
    PageHeader,
    RangeField,
    Section,
    TabContent,
    Toggle,
} from '../UIComponents';

export default function MemoryTab({
    config, handleChange,
    sessionList, sessionSearch, setSessionSearch, currentSessionId, sessionMessages, editingMsgIndex, editBuffer,
    currentSummary, persistentMemoryList, newPersistFact,
    fetchSessionList, selectSession, saveSummary, deleteSession,
    startEdit, saveEdit, deleteMsg, saveSessionChanges,
    savePersistentMemory, addPersistFact, removePersistFact,
    setNewPersistFact, setCurrentSummary, setEditBuffer, setEditingMsgIndex
}) {
    const filteredSessions = useMemo(() => {
        if (!sessionSearch.trim()) return sessionList;
        const query = sessionSearch.toLowerCase();
        return sessionList.filter((session) => (
            session.id.toLowerCase().includes(query) || session.preview.toLowerCase().includes(query)
        ));
    }, [sessionList, sessionSearch]);

    return (
        <TabContent>
            <PageHeader
                icon={Database}
                title="记忆管理"
                description="查看会话上下文、摘要以及跨会话持久化事实。"
                actions={<Button icon={RefreshCw} onClick={fetchSessionList}>刷新</Button>}
            />

            <Section title="会话记忆" description={`${filteredSessions.length} 个活跃会话`}>
                <div className="grid min-h-[520px] overflow-hidden rounded-2xl border border-pink-100 bg-white/40 lg:grid-cols-[280px_minmax(0,1fr)]">
                    <aside className="flex min-h-[240px] flex-col border-b border-pink-100 bg-pink-50/35 lg:border-b-0 lg:border-r">
                        <div className="border-b border-pink-100 p-3">
                            <div className="flex h-9 items-center gap-2 rounded-xl border border-pink-100 bg-white/80 px-2.5">
                                <Search className="h-4 w-4 text-gray-400" />
                                <input
                                    type="text"
                                    value={sessionSearch}
                                    onChange={(e) => setSessionSearch(e.target.value)}
                                    placeholder="搜索会话"
                                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                                />
                                {sessionSearch && <IconButton icon={X} label="清除搜索" onClick={() => setSessionSearch('')} className="h-6 w-6" />}
                            </div>
                        </div>
                        <div className="custom-scrollbar flex-1 overflow-y-auto p-2">
                            {filteredSessions.length === 0 && <div className="px-3 py-10 text-center text-sm text-gray-400">没有匹配的会话</div>}
                            {filteredSessions.map((session) => {
                                const selected = currentSessionId === session.id;
                                return (
                                    <button
                                        type="button"
                                        key={session.id}
                                        onClick={() => selectSession(session.id)}
                                        className={`mb-1 w-full rounded-xl border px-3 py-2.5 text-left transition-all ${selected ? 'border-pink-200 bg-white shadow-sm' : 'border-transparent hover:bg-white/70'}`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className={`truncate text-sm font-medium ${selected ? 'text-pink-700' : 'text-gray-700'}`}>{session.id}</div>
                                                <div className="mt-1 truncate text-xs text-gray-500">{session.preview}</div>
                                            </div>
                                            <IconButton icon={Trash2} label="删除会话" variant="ghost" onClick={(e) => deleteSession(session.id, e)} className="text-gray-400 hover:text-red-600" />
                                        </div>
                                        <div className="mt-2 text-[11px] text-gray-400">{session.count} 条记录</div>
                                    </button>
                                );
                            })}
                        </div>
                    </aside>

                    <div className="flex min-w-0 flex-col bg-white">
                        {currentSessionId ? (
                            <>
                                <div className="flex min-h-[54px] items-center justify-between gap-3 border-b border-pink-100 bg-white/30 px-4">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-gray-900">{currentSessionId}</div>
                                        <div className="text-xs text-gray-400">{sessionMessages.length} 条上下文记录</div>
                                    </div>
                                    <Button icon={Save} size="sm" variant="primary" onClick={saveSessionChanges}>保存会话</Button>
                                </div>

                                <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
                                    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                                                <BookOpen className="h-4 w-4" />长期摘要
                                            </div>
                                            <Button size="sm" onClick={saveSummary}>保存摘要</Button>
                                        </div>
                                        <textarea
                                            className="ui-textarea min-h-20 bg-white"
                                            value={currentSummary}
                                            onChange={(e) => setCurrentSummary(e.target.value)}
                                            placeholder="当前会话暂无摘要"
                                        />
                                    </div>

                                    {sessionMessages.map((message, index) => (
                                        <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`group relative max-w-[86%] rounded-2xl border px-3 py-2.5 text-sm ${message.role === 'user' ? 'rounded-tr-md border-pink-200 bg-pink-50 text-pink-950' : 'rounded-tl-md border-sky-100 bg-sky-50/60 text-gray-700'}`}>
                                                <div className="mb-1 text-[10px] font-semibold uppercase text-gray-400">{message.role}</div>
                                                {editingMsgIndex === index ? (
                                                    <div className="space-y-2">
                                                        <textarea className="ui-textarea min-h-24 bg-white" value={editBuffer} onChange={(e) => setEditBuffer(e.target.value)} />
                                                        <div className="flex justify-end gap-2">
                                                            <Button size="sm" variant="ghost" onClick={() => setEditingMsgIndex(-1)}>取消</Button>
                                                            <Button icon={Check} size="sm" variant="primary" onClick={() => saveEdit(index)}>完成</Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <p className="whitespace-pre-wrap break-words leading-6">{message.content}</p>
                                                        <div className="absolute -right-2 -top-3 hidden gap-1 group-hover:flex">
                                                            <IconButton icon={Edit2} label="编辑消息" onClick={() => startEdit(index, message.content)} className="bg-white" />
                                                            <IconButton icon={Trash2} label="删除消息" variant="danger" onClick={() => deleteMsg(index)} className="bg-white" />
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-gray-400">
                                <MessageSquare className="mb-3 h-8 w-8" />
                                <div className="text-sm">选择左侧会话以查看和编辑记忆</div>
                            </div>
                        )}
                    </div>
                </div>
            </Section>

            <Section title="记忆策略">
                <div className="grid gap-4 md:grid-cols-2">
                    <RangeField
                        label="短期记忆深度"
                        value={config.shortMem}
                        suffix=" 条"
                        min="2"
                        max="50"
                        onChange={(e) => handleChange('shortMem', Number(e.target.value))}
                    />
                    <Toggle
                        checked={Boolean(config.persistMem)}
                        onChange={(value) => handleChange('persistMem', value)}
                        label="跨会话持久化事实"
                        description="自动提取值得长期记住的信息，并注入后续会话。"
                    />
                </div>
            </Section>

            <Section
                title={`持久化事实（${persistentMemoryList.length}）`}
                description="这些事实会在启用持久化记忆后注入所有会话。"
                action={<Button icon={Save} variant="primary" onClick={savePersistentMemory}>保存</Button>}
            >
                <div className="space-y-2">
                    {persistentMemoryList.length === 0 && (
                        <div className="empty-state"><Brain className="mb-2 h-6 w-6" />暂无持久化事实</div>
                    )}
                    {persistentMemoryList.map((item, index) => (
                        <div key={`${item.fact}-${index}`} className="flex min-h-10 items-center gap-3 rounded-xl border border-pink-100 bg-white/65 px-3 py-2">
                            <span className="min-w-0 flex-1 text-sm text-gray-700">{item.fact}</span>
                            <span className="shrink-0 text-[11px] text-gray-400">{item.source}</span>
                            <IconButton icon={Trash2} label="删除事实" variant="danger" onClick={() => removePersistFact(index)} />
                        </div>
                    ))}
                    <div className="flex gap-2 pt-2">
                        <input
                            type="text"
                            value={newPersistFact}
                            onChange={(e) => setNewPersistFact(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addPersistFact()}
                            placeholder="手动添加一条事实"
                            className="ui-input"
                        />
                        <Button icon={Plus} onClick={addPersistFact}>添加</Button>
                    </div>
                </div>
            </Section>
        </TabContent>
    );
}
