import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, GrowingTextarea, PageHeader, RangeField, Section, TabContent, Toggle } from '../UIComponents';
import PinkSelect from '../PinkSelect';
import EditConflict from '../EditConflict';

const ActionButton = ({ label, variant = 'ghost', onClick, disabled }) => <Button size="sm" variant={variant} onClick={onClick} disabled={disabled}>{label}</Button>;
const TYPES = [{ value: 'fact', label: '普通记忆' }, { value: 'slang', label: '群内黑话' }, { value: 'knowledge', label: '教学知识' }, { value: 'bot_preference', label: '角色偏好' }];
const FILTERS = [{ value: 'all', label: '全部类型' }, { value: 'member', label: '成员资料' }, ...TYPES];
const kindOf = item => item.memberKind ? 'member' : item.kind || 'fact';
const scopeLabel = source => source === 'persona' ? '角色共享' : !source || source === 'manual' ? '所有会话' : source.replace(/^group_/, '群 ').replace(/^user_/, '私聊 ');
const sessionTime = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function sessionLabel(session) {
    const timestamp = Date.parse(session.lastUpdate);
    const updated = Number.isFinite(timestamp) ? sessionTime.format(timestamp) : '时间未知';
    return `${scopeLabel(session.id)} · ${session.count} 条 · ${updated}`;
}

function factDifference(row) {
    if (!row) return '已删除';
    return [row.fact, row.enabled === false ? '已停用' : '已启用', scopeLabel(row.source)].join(' · ');
}

export default function MemoryTab({
    config, handleChange, sessionList, sessionSearch, setSessionSearch, currentSessionId, sessionMessages, editingMsgId,
    currentSummary, persistentMemoryList, newPersistFact, refresh, selectSession, saveSummary, deleteSession,
    startEdit, saveEdit, deleteMsg, saveSessionChanges, savePersistentMemory, addPersistFact, removePersistFact, editPersistFact,
    setNewPersistFact, setCurrentSummary, setEditBuffer, cancelEdit, error, busy = {}, dirty = {}, loading, saving, persistentLoaded = true,
    page, pageCount, messageCount, changePage, factConflicts, persistentBaseline, resolveFact, messageConflicts, resolveMessage, summaryConflict, baselineSummary, resolveSummary
}) {
    const [view, setView] = useState('long');
    const transcript = useRef(null);
    const showPage = async next => { if (await changePage(next)) transcript.current?.scrollIntoView({ block: 'start' }); };
    const [editingFact, setEditingFact] = useState(null), [factDraft, setFactDraft] = useState('');
    useEffect(() => {
        if (!editingFact || factDraft === editingFact.original) return;
        const warn = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [editingFact, factDraft]);
    const [adding, setAdding] = useState(false), [memoryKind, setMemoryKind] = useState('fact');
    const [subject, setSubject] = useState(''), [scope, setScope] = useState('');
    const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
    const scopes = [{ value: '', label: '所有会话' }, ...sessionList.map(s => ({ value: s.id, label: scopeLabel(s.id) }))];
    if (scope && !scopes.some(s => s.value === scope)) scopes.push({ value: scope, label: scopeLabel(scope) });
    const needsGroup = memoryKind === 'slang' && !/^group_(?:\d+|qbot_\d+_(?:live|sandbox)_[A-Za-z0-9_-]+)$/.test(scope);
    const canAdd = newPersistFact.trim() && (memoryKind === 'fact' || subject.trim()) && !needsGroup;
    const addMemory = () => {
        if (!canAdd) return;
        if (!addPersistFact({ kind: memoryKind, subject: subject.trim(), source: scope || 'manual' })) return;
        setSubject(''); setAdding(false);
    };
    const filteredSessions = useMemo(() => sessionList.filter(session => !sessionSearch.trim() || `${session.id} ${session.preview}`.toLowerCase().includes(sessionSearch.trim().toLowerCase())), [sessionList, sessionSearch]);
    const visibleFacts = persistentMemoryList.filter(item =>
        (filter === 'all' || kindOf(item) === filter) && `${item.fact} ${item.subject || ''} ${item.source}`.toLowerCase().includes(query.trim().toLowerCase()));
    return <TabContent>
        {error && <div className="workspace-error" role="alert">{error}</div>}
        {loading && <div className="memory-load-status" role="status">正在读取记忆…</div>}
        <PageHeader title="记忆管理" actions={<Button disabled={loading || saving || !!editingFact || adding} onClick={refresh}>刷新</Button>} />
        <div className="memory-view-tabs" role="tablist" aria-label="记忆视图">
            <button type="button" role="tab" id="memory-long-tab" aria-controls="memory-long-view" aria-selected={view === 'long'} className={view === 'long' ? 'is-active' : ''} onClick={() => setView('long')}>长期记忆<span>{persistentMemoryList.length}</span></button>
            <button type="button" role="tab" id="memory-session-tab" aria-controls="memory-session-view" aria-selected={view === 'sessions'} className={view === 'sessions' ? 'is-active' : ''} onClick={() => setView('sessions')}>会话记录<span>{sessionList.length}</span></button>
        </div>
        {view === 'long' && <div id="memory-long-view" role="tabpanel" aria-labelledby="memory-long-tab">
            <Section title="长期记忆" action={<div className="flex flex-wrap justify-end gap-2"><Button size="sm" disabled={!!editingFact} onClick={() => { setAdding(!adding); }}>添加</Button><Button size="sm" variant="primary" disabled={saving || loading || !persistentLoaded || !dirty.persistent || !!editingFact || factConflicts.length > 0} onClick={savePersistentMemory}>{busy.savePersistent ? '保存中…' : '保存记忆'}</Button></div>}>
                {factConflicts.map(id => <EditConflict key={id} label="记忆" serverValue={factDifference(persistentBaseline.find(row => row.rowId === id))} localValue={factDifference(persistentMemoryList.find(row => row.rowId === id))} onResolve={useServer => resolveFact(id, useServer)} />)}
                <div className="memory-toolbar">
                    <label className="memory-search"><input aria-label="搜索长期记忆" placeholder="搜索记忆" value={query} onChange={e => setQuery(e.target.value)} />{query && <ActionButton label="清除记忆搜索" onClick={() => setQuery('')} />}</label>
                    <PinkSelect label="筛选记忆类型" value={filter} options={FILTERS} onChange={setFilter} />
                </div>
                {adding && <div className="memory-composer">
                    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-700">添加记忆</h3><ActionButton label="关闭添加记忆" onClick={() => setAdding(false)} /></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="field-group"><span className="field-label">类型</span><PinkSelect label="记忆类型" value={memoryKind} options={TYPES} onChange={setMemoryKind} /></div>
                        {memoryKind === 'bot_preference' ? <div className="field-group"><span className="field-label">范围</span><div className="flex h-10 items-center px-3 text-sm text-pink-500">角色共享</div></div> : <div className="field-group"><span className="field-label">范围</span><PinkSelect label="适用会话" value={scope} options={memoryKind === 'slang' ? [{ value: '', label: '选择群聊' }, ...scopes.filter(s => /^group_/.test(s.value))] : scopes} onChange={setScope} /></div>}
                    </div>
                    {memoryKind !== 'fact' && <label className="field-group"><span className="field-label">{memoryKind === 'slang' ? '词条' : '主题'}</span><input className="ui-input" maxLength={80} value={subject} onChange={e => setSubject(e.target.value)} placeholder={memoryKind === 'slang' ? '黑话名称' : '例如：游戏偏好'} /></label>}
                    <label className="field-group"><span className="field-label">内容</span><GrowingTextarea className="ui-textarea min-h-24" value={newPersistFact} onChange={e => setNewPersistFact(e.target.value)} placeholder="记录需要长期保留的信息" /></label>
                    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-gray-400">{needsGroup ? '群内黑话需要选择群聊。' : '添加后点击「保存记忆」生效。'}</span><Button size="sm" variant="primary" disabled={!canAdd || !persistentLoaded} onClick={addMemory}>添加到列表</Button></div>
                </div>}
                <div className="mt-4 space-y-2">
                    {!visibleFacts.length && <div className="memory-empty"><span>{persistentMemoryList.length ? '没有匹配的记忆' : '暂无长期记忆'}</span>{!persistentMemoryList.length && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>添加第一条记忆</Button>}</div>}
                    {visibleFacts.map(item => <article key={item.rowId} className={`memory-entry ${item.enabled === false ? 'memory-entry-disabled' : ''}`}>
                        {editingFact?.id === item.rowId ? <div className="space-y-3"><GrowingTextarea aria-label="编辑长期记忆" className="ui-textarea min-h-24" value={factDraft} onChange={e => setFactDraft(e.target.value)} /><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditingFact(null)}>取消</Button><Button size="sm" disabled={!factDraft.trim()} onClick={() => { editPersistFact(item.rowId, item.memberKind ? { value: factDraft.trim().slice(0, 80), fact: `${item.memberId}：${factDraft.trim().slice(0, 80)}` } : { fact: factDraft.trim() }); setEditingFact(null); }}>完成</Button></div></div> : <>
                            <div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-400"><span className="memory-kind">{FILTERS.find(t => t.value === kindOf(item))?.label}</span><span>{scopeLabel(item.source)}</span>{item.locked && <span>固定</span>}{item.enabled === false && <span>已停用</span>}</div><p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">{item.fact}</p></div>
                            <div className="memory-entry-actions"><ActionButton label="编辑记忆" disabled={loading || saving || !!editingFact} onClick={() => { const original = item.memberKind ? item.value || item.fact : item.fact; setEditingFact({ id: item.rowId, original }); setFactDraft(original); }} /><ActionButton label={item.enabled === false ? '启用记忆' : '停用记忆'} onClick={() => editPersistFact(item.rowId, { enabled: item.enabled === false })} /><ActionButton label="删除记忆" variant="danger" disabled={!!editingFact} onClick={() => removePersistFact(item.rowId)} /></div>
                        </>}
                    </article>)}
                </div>
            </Section>
        </div>}
        {view === 'sessions' && <div id="memory-session-view" role="tabpanel" aria-labelledby="memory-session-tab">
            <Section title="会话记录" description={`${filteredSessions.length} 个活跃会话`}>
                <div className="session-workspace">
                    <div className="session-toolbar">
                        <input aria-label="搜索会话" className="ui-input" placeholder="搜索会话" value={sessionSearch} onChange={e => setSessionSearch(e.target.value)} />
                        <PinkSelect label="选择会话" value={currentSessionId || ''} options={[{ value: '', label: '选择会话' }, ...filteredSessions.map(session => ({ value: session.id, label: sessionLabel(session) })), ...(currentSessionId && !filteredSessions.some(session => session.id === currentSessionId) ? [{ value: currentSessionId, label: scopeLabel(currentSessionId) }] : [])]} onChange={id => selectSession(id || null)} />
                        {currentSessionId && <Button size="sm" variant="danger" disabled={busy.session || saving} onClick={e => deleteSession(currentSessionId, e)}>删除会话</Button>}
                    </div>
                    {!filteredSessions.length && <p className="field-hint">没有匹配的会话</p>}
                    <div className="flex min-h-0 min-w-0 flex-col bg-white/60">
                        {currentSessionId ? (
                            <>
                                <div className="flex min-h-[54px] items-center justify-between gap-3 border-b border-pink-100 bg-white/30 px-4">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-gray-900">{currentSessionId}</div>
                                        <div className="text-xs text-gray-400">{messageCount} 条上下文记录</div>
                                    </div>
                                    <Button size="sm" variant="primary" disabled={saving || busy.session || !dirty.session || messageConflicts.length > 0} onClick={saveSessionChanges}>保存会话</Button>
                                </div>

                                <div ref={transcript} className="session-transcript space-y-4">
                                    {messageConflicts.map(op => <EditConflict key={op.id} label="消息" serverValue={op.before ?? '已删除'} localValue={op.after ?? '已删除'} canKeep={op.before !== null} onResolve={useServer => resolveMessage(op.id, useServer)} />)}
                                    {summaryConflict && <EditConflict label="摘要" serverValue={baselineSummary || '（空）'} localValue={currentSummary || '（空）'} onResolve={resolveSummary} />}
                                    <details key={currentSessionId} className="memory-summary">
                                        <summary><span className="flex items-center gap-2">会话摘要</span><ChevronDown className="h-4 w-4" /></summary>
                                        <div className="space-y-3 border-t border-pink-100 p-3">
                                            <p className="text-xs text-gray-400">旧聊天的压缩记录，仅用于当前会话。</p>
                                            <GrowingTextarea aria-label="会话摘要" className="ui-textarea min-h-24" value={currentSummary} onChange={e => setCurrentSummary(e.target.value)} placeholder="聊天记录压缩后自动生成" />
                                            <div className="flex justify-end"><Button size="sm" disabled={saving || busy.session || !dirty.summary || summaryConflict} onClick={saveSummary}>保存摘要</Button></div>
                                        </div>
                                    </details>

                                    {sessionMessages.map(message => (
                                        <div key={message.rowId} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`group relative max-w-[86%] rounded-2xl border px-3 py-2.5 text-sm ${message.role === 'user' ? 'rounded-tr-md border-pink-200 bg-pink-50 text-pink-950' : 'rounded-tl-md border-sky-100 bg-sky-50/60 text-gray-700'}`}>
                                                <div className="mb-1 text-[10px] font-semibold uppercase text-gray-400">{message.role}</div>
                                                {editingMsgId === message.rowId ? (
                                                    <div className="space-y-2">
                                                        <GrowingTextarea aria-label="编辑会话消息" className="min-h-24 bg-white" value={message.content} onChange={(e) => setEditBuffer(e.target.value)} />
                                                        <div className="flex justify-end gap-2">
                                                            <Button size="sm" variant="ghost" onClick={cancelEdit}>取消</Button>
                                                            <Button size="sm" variant="primary" onClick={saveEdit}>完成</Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <p className="whitespace-pre-wrap break-words leading-6">{message.content}</p>
                                                        <div className="mt-2 flex justify-end gap-1 opacity-70 hover:opacity-100">
                                                            <ActionButton label="编辑消息" onClick={() => startEdit(message.rowId, message.content)} className="bg-white" />
                                                            <ActionButton label="删除消息" variant="danger" onClick={() => deleteMsg(message.rowId)} className="bg-white" />
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {pageCount > 1 && <div className="session-pagination" aria-label="消息分页">
                                        <Button size="sm" disabled={page === 0 || busy.session || saving || Boolean(editingMsgId)} onClick={() => showPage(page - 1)}>上一页</Button>
                                        <span>{page + 1} / {pageCount}</span>
                                        <Button size="sm" disabled={page >= pageCount - 1 || busy.session || saving || Boolean(editingMsgId)} onClick={() => showPage(page + 1)}>下一页</Button>
                                    </div>}
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-gray-400">

                                <div className="text-sm">选择会话以查看和编辑记录</div>
                            </div>
                        )}
                    </div>
                </div>
            </Section>

        </div>}
        <details className="memory-settings">
            <summary><span className="flex items-center gap-2">记忆设置</span><ChevronDown className="h-4 w-4" /></summary>
            <div className="grid gap-5 border-t border-pink-100/70 p-4 md:grid-cols-2">
                <Toggle checked={Boolean(config.persistMem)} onChange={value => handleChange('persistMem', value)} label="启用长期记忆" />
                <RangeField label="上下文深度" value={config.shortMem} suffix=" 轮" min="2" max="50" onChange={e => handleChange('shortMem', Number(e.target.value))} />
                <p className="text-xs text-gray-400 md:col-span-2">设置修改后，使用页面底部的「保存配置」。</p>
            </div>
        </details>
    </TabContent>;
}
