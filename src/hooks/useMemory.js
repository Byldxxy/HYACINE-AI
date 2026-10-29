import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const emptyDraft = () => ({ messages: [], baselineMessages: [], summary: '', baselineSummary: '', editingMsgIndex: -1, editBuffer: '', loaded: false });
const changedMessage = draft => draft.editingMsgIndex >= 0 && draft.editBuffer !== draft.messages[draft.editingMsgIndex]?.content;
const sessionDirty = draft => !equal(draft.messages, draft.baselineMessages) || changedMessage(draft);
const arrayData = data => { if (!Array.isArray(data)) throw new Error('记忆数据格式不正确'); return data; };

/** Drafts belong to session IDs, so navigation and late responses never move edits between sessions. */
export function useMemory(addLog) {
    const [state, setState] = useState({ sessionList: [], currentSessionId: null, drafts: {}, persistentMemoryList: [], persistentBaseline: [],
        newPersistFact: '', sessionSearch: '', busy: {}, error: '', listLoaded: false, persistentLoaded: false });
    const current = useRef(state), requests = useRef(new Map()), mounted = useRef(true), loadPromise = useRef(null);
    const update = useCallback(change => {
        const next = change(current.current); current.current = next;
        if (mounted.current) setState(next);
    }, []);
    const report = useCallback(error => { const message = error.message || '记忆操作失败'; update(s => ({ ...s, error: message })); addLog?.('error', message); }, [addLog, update]);
    const start = useCallback((key, busyKey = key) => {
        requests.current.get(key)?.controller.abort();
        const task = { controller: new AbortController(), busyKey };
        requests.current.set(key, task);
        update(s => ({ ...s, error: '', busy: { ...s.busy, [busyKey]: true } }));
        return task;
    }, [update]);
    const finish = useCallback((key, task) => {
        if (requests.current.get(key) !== task) return;
        requests.current.delete(key);
        update(s => ({ ...s, busy: { ...s.busy, [task.busyKey]: false } }));
    }, [update]);
    useEffect(() => {
        mounted.current = true;
        const activeRequests = requests.current;
        return () => { mounted.current = false; for (const task of activeRequests.values()) task.controller.abort(); };
    }, []);
    const updateDraft = useCallback(change => update(s => {
        const id = s.currentSessionId;
        if (!id) return s;
        return { ...s, drafts: { ...s.drafts, [id]: change(s.drafts[id] || emptyDraft()) } };
    }), [update]);

    const fetchSessionList = useCallback(async () => {
        const task = start('sessions');
        try {
            const list = arrayData(await apiRequest('/api/memory/list', { signal: task.controller.signal }));
            if (task.controller.signal.aborted) return false;
            update(s => ({ ...s, sessionList: list, listLoaded: true }));
            return true;
        } catch (error) { if (!task.controller.signal.aborted) report(error); return false; }
        finally { finish('sessions', task); }
    }, [finish, report, start, update]);
    const fetchPersistentMemory = useCallback(async () => {
        if (!equal(current.current.persistentMemoryList, current.current.persistentBaseline)) {
            report(new Error('长期记忆有未保存的修改，请先保存再刷新。')); return false;
        }
        if (requests.current.has('savePersistent')) return false;
        const task = start('persistent');
        try {
            const list = arrayData(await apiRequest('/api/persistent-memory', { signal: task.controller.signal }));
            if (task.controller.signal.aborted) return false;
            if (!equal(current.current.persistentMemoryList, current.current.persistentBaseline)) {
                report(new Error('已保留加载期间的长期记忆修改。')); return false;
            }
            update(s => ({ ...s, persistentMemoryList: list, persistentBaseline: list, persistentLoaded: true }));
            return true;
        } catch (error) { if (!task.controller.signal.aborted) report(error); return false; }
        finally { finish('persistent', task); }
    }, [finish, report, start, update]);
    const load = useCallback(() => {
        if (loadPromise.current && [...requests.current.values()].some(task => !task.controller.signal.aborted)) return loadPromise.current;
        const tasks = [];
        if (!current.current.listLoaded) tasks.push(fetchSessionList());
        if (!current.current.persistentLoaded) tasks.push(fetchPersistentMemory());
        const pending = Promise.all(tasks).then(results => results.every(Boolean)).finally(() => { if (loadPromise.current === pending) loadPromise.current = null; });
        loadPromise.current = pending;
        return pending;
    }, [fetchSessionList, fetchPersistentMemory]);
    const refresh = useCallback(() => Promise.all([fetchSessionList(), fetchPersistentMemory()]), [fetchSessionList, fetchPersistentMemory]);
    const selectSession = useCallback(async id => {
        requests.current.get('session')?.controller.abort();
        update(s => ({ ...s, currentSessionId: id, error: '', busy: { ...s.busy, session: false },
            drafts: id && !s.drafts[id] ? { ...s.drafts, [id]: emptyDraft() } : s.drafts }));
        if (!id || current.current.drafts[id]?.loaded) return true;
        const task = start('session');
        try {
            const [messages, summary] = await Promise.all([
                apiRequest(`/api/memory/${encodeURIComponent(id)}`, { signal: task.controller.signal }),
                apiRequest(`/api/summary/${encodeURIComponent(id)}`, { signal: task.controller.signal }),
            ]);
            arrayData(messages);
            if (!summary || typeof summary.summary !== 'string') throw new Error('摘要数据格式不正确');
            if (task.controller.signal.aborted || current.current.currentSessionId !== id) return false;
            update(s => {
                const draft = s.drafts[id];
                return { ...s, drafts: { ...s.drafts, [id]: { ...draft, loaded: true,
                    messages: sessionDirty(draft) ? draft.messages : messages, baselineMessages: messages,
                    summary: draft.summary !== draft.baselineSummary ? draft.summary : summary.summary, baselineSummary: summary.summary } } };
            });
            return true;
        } catch (error) { if (!task.controller.signal.aborted) report(error); return false; }
        finally { finish('session', task); }
    }, [finish, report, start, update]);

    const setCurrentSummary = useCallback(value => updateDraft(d => ({ ...d, summary: typeof value === 'function' ? value(d.summary) : value })), [updateDraft]);
    const setEditingMsgIndex = useCallback(value => updateDraft(d => ({ ...d, editingMsgIndex: value })), [updateDraft]);
    const setEditBuffer = useCallback(value => updateDraft(d => ({ ...d, editBuffer: value })), [updateDraft]);
    const startEdit = useCallback((index, content) => updateDraft(d => ({ ...d, editingMsgIndex: index, editBuffer: content })), [updateDraft]);
    const saveEdit = useCallback(index => updateDraft(d => ({ ...d, messages: d.messages.map((item, i) => i === index ? { ...item, content: d.editBuffer } : item), editingMsgIndex: -1 })), [updateDraft]);
    const deleteMsg = useCallback(index => updateDraft(d => ({ ...d, messages: d.messages.filter((_, i) => i !== index),
        editingMsgIndex: d.editingMsgIndex === index ? -1 : d.editingMsgIndex > index ? d.editingMsgIndex - 1 : d.editingMsgIndex })), [updateDraft]);
    const saveSessionPart = useCallback(async part => {
        const id = current.current.currentSessionId, draft = current.current.drafts[id];
        if (!id || !draft?.loaded || requests.current.has('writeSession')) return false;
        if (part === 'messages' && draft.editingMsgIndex >= 0) saveEdit(draft.editingMsgIndex);
        const snapshot = structuredClone(current.current.drafts[id][part]);
        const task = start('writeSession', part === 'messages' ? 'saveSession' : 'saveSummary');
        try {
            await apiRequest(`/api/${part === 'messages' ? 'memory' : 'summary'}/${encodeURIComponent(id)}`, {
                method: 'POST', body: part === 'messages' ? snapshot : { summary: snapshot }, signal: task.controller.signal, expectSuccess: true,
            });
            if (task.controller.signal.aborted) return false;
            update(s => ({ ...s, drafts: { ...s.drafts, [id]: { ...s.drafts[id], [part === 'messages' ? 'baselineMessages' : 'baselineSummary']: snapshot } },
                sessionList: part === 'messages' ? s.sessionList.map(item => item.id === id ? { ...item, count: snapshot.length, preview: String(snapshot.at(-1)?.content || '(空)').slice(0, 30) } : item) : s.sessionList }));
            addLog?.('system', part === 'messages' ? '会话记录已保存' : '会话摘要已保存');
            return true;
        } catch (error) { if (!task.controller.signal.aborted) report(error); return false; }
        finally { finish('writeSession', task); }
    }, [addLog, finish, report, saveEdit, start, update]);
    const saveSessionChanges = useCallback(() => saveSessionPart('messages'), [saveSessionPart]);
    const saveSummary = useCallback(() => saveSessionPart('summary'), [saveSessionPart]);
    const deleteSession = useCallback(async (id, event) => {
        event?.stopPropagation?.();
        if (!id || requests.current.has('writeSession')) return false;
        const task = start('writeSession', 'deleteSession');
        try {
            await apiRequest(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE', signal: task.controller.signal, expectSuccess: true });
            if (task.controller.signal.aborted) return false;
            requests.current.get('sessions')?.controller.abort();
            if (current.current.currentSessionId === id) requests.current.get('session')?.controller.abort();
            update(s => {
                const drafts = { ...s.drafts }; delete drafts[id];
                return { ...s, drafts, sessionList: s.sessionList.filter(item => item.id !== id), currentSessionId: s.currentSessionId === id ? null : s.currentSessionId };
            });
            addLog?.('system', '会话已删除'); return true;
        } catch (error) { if (!task.controller.signal.aborted) report(error); return false; }
        finally { finish('writeSession', task); }
    }, [addLog, finish, report, start, update]);

    const setNewPersistFact = useCallback(value => update(s => ({ ...s, newPersistFact: value })), [update]);
    const setSessionSearch = useCallback(value => update(s => ({ ...s, sessionSearch: value })), [update]);
    const addPersistFact = useCallback((options = {}) => {
        const fact = current.current.newPersistFact.trim(); if (!fact) return false;
        if (!current.current.persistentLoaded) { report(new Error('请先加载长期记忆，再添加内容。')); return false; }
        update(s => ({ ...s, persistentMemoryList: [...s.persistentMemoryList, { fact, kind: options.kind || 'fact', subject: options.subject || '',
            source: options.kind === 'bot_preference' ? 'persona' : options.source || 'manual', locked: true, enabled: true, time: new Date().toISOString() }], newPersistFact: '' }));
        return true;
    }, [report, update]);
    const editPersistFact = useCallback((index, patch) => update(s => ({ ...s, persistentMemoryList: s.persistentMemoryList.map((item, i) => i === index ? { ...item, ...patch, locked: true } : item) })), [update]);
    const removePersistFact = useCallback(index => update(s => ({ ...s, persistentMemoryList: s.persistentMemoryList.filter((_, i) => i !== index) })), [update]);
    const savePersistentMemory = useCallback(async () => {
        if (requests.current.has('savePersistent') || !current.current.persistentLoaded) return false;
        requests.current.get('persistent')?.controller.abort();
        const snapshot = structuredClone(current.current.persistentMemoryList), task = start('savePersistent');
        try {
            await apiRequest('/api/persistent-memory', { method: 'POST', body: snapshot, signal: task.controller.signal, expectSuccess: true });
            if (task.controller.signal.aborted) return false;
            update(s => ({ ...s, persistentBaseline: snapshot })); addLog?.('system', '长期记忆已保存'); return true;
        } catch (error) { if (!task.controller.signal.aborted) report(error); return false; }
        finally { finish('savePersistent', task); }
    }, [addLog, finish, report, start, update]);

    const draft = state.drafts[state.currentSessionId] || emptyDraft();
    const dirty = { session: sessionDirty(draft), summary: draft.summary !== draft.baselineSummary,
        persistent: !equal(state.persistentMemoryList, state.persistentBaseline) };
    dirty.any = dirty.persistent || Boolean(state.newPersistFact.trim()) || Object.values(state.drafts).some(d => sessionDirty(d) || d.summary !== d.baselineSummary);
    return { sessionList: state.sessionList, currentSessionId: state.currentSessionId, sessionMessages: draft.messages, currentSummary: draft.summary,
        editingMsgIndex: draft.editingMsgIndex, editBuffer: draft.editBuffer, persistentMemoryList: state.persistentMemoryList, newPersistFact: state.newPersistFact, sessionSearch: state.sessionSearch,
        setCurrentSummary, setEditingMsgIndex, setEditBuffer, setNewPersistFact, setSessionSearch, startEdit, saveEdit, deleteMsg,
        fetchSessionList, fetchPersistentMemory, selectSession, saveSummary, saveSessionChanges, deleteSession, savePersistentMemory, addPersistFact, editPersistFact, removePersistFact,
        load, refresh, dirty, busy: state.busy, error: state.error, persistentLoaded: state.persistentLoaded,
        loading: Boolean(state.busy.sessions || state.busy.session || state.busy.persistent),
        saving: Boolean(state.busy.saveSession || state.busy.saveSummary || state.busy.savePersistent || state.busy.deleteSession) };
}
