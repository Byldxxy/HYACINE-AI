import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import { mergeRows, pendingMessageEdits, reconcileMessageEdits, rowOperations } from '../lib/editorDrafts.mjs';

const PAGE_SIZE = 12;
const emptyDraft = () => ({ rows: [], offset: 0, total: 0, edits: {}, editing: null, loaded: false,
    summary: '', baselineSummary: '', summaryConflict: false });
const arrayData = data => { if (!Array.isArray(data)) throw new Error('记忆数据格式不正确'); return data; };
const pageQuery = offset => new URLSearchParams({ offset, limit: PAGE_SIZE });
const sessionPath = (kind, id) => `/api/${kind}/${encodeURIComponent(id)}`;
const sessionDirty = draft => Object.keys(draft.edits).length > 0;
function newRowId() {
    if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function applyPage(draft, page) {
    const rows = arrayData(page.messages);
    if (!Number.isSafeInteger(page.offset) || !Number.isSafeInteger(page.total)) throw new Error('会话分页格式不正确');
    return { ...draft, rows, editing: draft.editing && rows.some(row => row.rowId === draft.editing.id) ? draft.editing : null, edits: reconcileMessageEdits(draft.edits, rows), total: page.total, offset: page.offset, loaded: true };
}

function applySummary(draft, latest) {
    if (typeof latest !== 'string') throw new Error('摘要数据格式不正确');
    const dirty = draft.summary !== draft.baselineSummary && draft.summary !== latest;
    return { ...draft, summary: dirty ? draft.summary : latest, baselineSummary: latest,
        summaryConflict: dirty && (draft.summaryConflict || draft.baselineSummary !== latest) };
}

function editContent(draft, id, content) {
    const op = draft.edits[id], row = draft.rows.find(item => item.rowId === id);
    if (!row && !op) return draft;
    const before = op ? op.before : row.content, edits = { ...draft.edits };
    if (content === before) delete edits[id];
    else edits[id] = { ...op, id, before, after: content };
    return { ...draft, edits };
}

export function useMemory(addLog) {
    const [state, setState] = useState({ sessionList: [], currentSessionId: null, drafts: {}, persistentMemoryList: [], persistentBaseline: [], factConflicts: [],
        newPersistFact: '', sessionSearch: '', busy: {}, error: '', listLoaded: false, persistentLoaded: false });
    const current = useRef(state), requests = useRef(new Map()), mounted = useRef(true);
    const update = useCallback(change => {
        const next = change(current.current); current.current = next;
        if (mounted.current) setState(next);
    }, []);
    const report = useCallback(error => { const message = error.message || '记忆操作失败'; update(s => ({ ...s, error: message })); addLog?.('error', message); }, [addLog, update]);
    const start = useCallback((key, busyKey = key, id) => {
        requests.current.get(key)?.controller.abort();
        const task = { controller: new AbortController(), busyKey, id };
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
        const active = requests.current;
        return () => { mounted.current = false; for (const task of active.values()) task.controller.abort(); };
    }, []);
    const updateDraft = useCallback((id, change) => update(s => !id ? s : ({ ...s, drafts: { ...s.drafts, [id]: change(s.drafts[id] || emptyDraft()) } })), [update]);
    const editCurrent = change => updateDraft(current.current.currentSessionId, change);

    const fetchSessionList = useCallback(async () => {
        const task = start('sessions'), { signal } = task.controller;
        try {
            const list = arrayData(await apiRequest('/api/memory/list', { signal }));
            if (!signal.aborted) update(s => ({ ...s, sessionList: list.sort((a, b) => (b.lastUpdate || '').localeCompare(a.lastUpdate || '')), listLoaded: true }));
        } catch (error) { if (!signal.aborted) report(error); }
        finally { finish('sessions', task); }
    }, [finish, report, start, update]);
    const fetchPersistentMemory = useCallback(async () => {
        if (requests.current.has('savePersistent')) return;
        const task = start('persistent'), { signal } = task.controller;
        try {
            const list = arrayData(await apiRequest('/api/persistent-memory', { signal }));
            if (!signal.aborted) update(s => {
                const merged = mergeRows(s.persistentBaseline, s.persistentMemoryList, list, { conflicts: s.factConflicts });
                return { ...s, persistentBaseline: list, persistentMemoryList: merged.rows, factConflicts: merged.conflicts, persistentLoaded: true };
            });
        } catch (error) { if (!signal.aborted) report(error); }
        finally { finish('persistent', task); }
    }, [finish, report, start, update]);
    const load = useCallback(() => {
        const pending = key => { const task = requests.current.get(key); return task && !task.controller.signal.aborted; };
        if (!current.current.listLoaded && !pending('sessions')) void fetchSessionList();
        if (!current.current.persistentLoaded && !pending('persistent')) void fetchPersistentMemory();
    }, [fetchSessionList, fetchPersistentMemory]);

    const readPage = useCallback(async (id, offset, includeSummary) => {
        if (!id || requests.current.get('writeSession')?.id === id) return false;
        const task = start('session', 'session', id), { signal } = task.controller;
        try {
            const [page, summary] = await Promise.all([
                apiRequest(`${sessionPath('memory', id)}?${pageQuery(offset)}`, { signal }),
                includeSummary ? apiRequest(sessionPath('summary', id), { signal }) : null,
            ]);
            if (signal.aborted) return false;
            updateDraft(id, draft => applyPage(includeSummary ? applySummary(draft, summary.summary) : draft, page));
            return true;
        } catch (error) { if (!signal.aborted) report(error); return false; }
        finally { finish('session', task); }
    }, [finish, report, start, updateDraft]);
    const selectSession = useCallback(id => {
        requests.current.get('session')?.controller.abort();
        update(s => {
            const drafts = { ...s.drafts }, previous = drafts[s.currentSessionId];
            if (s.currentSessionId !== id && previous && !sessionDirty(previous) && previous.summary === previous.baselineSummary && requests.current.get('writeSession')?.id !== s.currentSessionId) delete drafts[s.currentSessionId];
            return { ...s, drafts, currentSessionId: id, error: '' };
        });
        return readPage(id, current.current.drafts[id]?.offset || 0, true);
    }, [readPage, update]);
    const refresh = () => {
        void fetchSessionList(); void fetchPersistentMemory();
        const id = current.current.currentSessionId;
        if (id) void readPage(id, current.current.drafts[id]?.offset || 0, true);
    };
    const changePage = next => {
        const id = current.current.currentSessionId;
        return readPage(id, next * PAGE_SIZE, false);
    };
    const saveSessionPart = useCallback(async part => {
        const id = current.current.currentSessionId, draft = current.current.drafts[id], isHistory = part === 'messages';
        if (!id || !draft?.loaded || requests.current.has('writeSession')) return false;
        if (isHistory ? Object.values(draft.edits).some(op => op.conflict) : draft.summaryConflict) return false;
        const body = isHistory ? { operations: Object.values(draft.edits).map(({ id, before, after }) => ({ id, before, after })) }
            : { before: draft.baselineSummary, after: draft.summary };
        if (isHistory ? !body.operations.length : body.before === body.after) return true;
        const read = requests.current.get('session');
        if (read?.id === id) read.controller.abort();
        const task = start('writeSession', isHistory ? 'saveSession' : 'saveSummary', id), { signal } = task.controller;
        const path = sessionPath(isHistory ? 'memory' : 'summary', id);
        try {
            const result = await apiRequest(isHistory ? `${path}?${pageQuery(draft.offset)}` : path, { method: 'PATCH', body, signal, expectSuccess: true });
            if (signal.aborted) return false;
            if (isHistory) {
                updateDraft(id, d => {
                    const edits = pendingMessageEdits(draft.edits, d.edits);
                    const saved = d.editing && draft.edits[d.editing.id];
                    const editing = saved ? (edits[saved.id] ? { ...d.editing, original: saved.after } : null) : d.editing;
                    return applyPage({ ...d, edits, editing }, result);
                });
            } else {
                if (typeof result.summary !== 'string') throw new Error('摘要数据格式不正确');
                updateDraft(id, d => ({ ...d, baselineSummary: result.summary, summary: d.summary === draft.summary ? result.summary : d.summary, summaryConflict: false }));
            }
            void fetchSessionList();
            addLog?.('system', isHistory ? '会话记录已保存' : '会话摘要已保存');
            return true;
        } catch (error) {
            if (!signal.aborted && error.status === 409) {
                try {
                    // A conflicting row may have moved to a different page or been trimmed.
                    const latest = await apiRequest(path, { signal });
                    if (!signal.aborted) updateDraft(id, d => {
                        if (!isHistory) return applySummary(d, latest.summary);
                        const rows = arrayData(latest), offset = Math.min(d.offset, Math.floor(Math.max(0, rows.length - 1) / PAGE_SIZE) * PAGE_SIZE);
                        return applyPage({ ...d, edits: reconcileMessageEdits(d.edits, rows, true) }, { offset, total: rows.length, messages: rows.slice(offset, offset + PAGE_SIZE) });
                    });
                } catch (reloadError) { if (!signal.aborted) report(reloadError); }
            } else if (!signal.aborted) report(error);
            return false;
        } finally { finish('writeSession', task); }
    }, [addLog, fetchSessionList, finish, report, start, updateDraft]);
    const deleteSession = useCallback(async (id, event) => {
        event?.stopPropagation?.();
        if (!id || requests.current.has('writeSession')) return false;
        const task = start('writeSession', 'deleteSession', id), { signal } = task.controller;
        try {
            await apiRequest(sessionPath('memory', id), { method: 'DELETE', signal, expectSuccess: true });
            if (signal.aborted) return false;
            requests.current.get('sessions')?.controller.abort();
            const read = requests.current.get('session'); if (read?.id === id) read.controller.abort();
            update(s => {
                const drafts = { ...s.drafts }; delete drafts[id];
                return { ...s, drafts, sessionList: s.sessionList.filter(item => item.id !== id), currentSessionId: s.currentSessionId === id ? null : s.currentSessionId };
            });
            addLog?.('system', '会话已删除'); return true;
        } catch (error) { if (!signal.aborted) report(error); return false; }
        finally { finish('writeSession', task); }
    }, [addLog, finish, report, start, update]);

    const setNewPersistFact = value => update(s => ({ ...s, newPersistFact: value }));
    const setSessionSearch = value => update(s => ({ ...s, sessionSearch: value }));
    const addPersistFact = (options = {}) => {
        const fact = current.current.newPersistFact.trim(); if (!fact) return false;
        if (!current.current.persistentLoaded) { report(new Error('请先加载长期记忆。')); return false; }
        update(s => ({ ...s, persistentMemoryList: [...s.persistentMemoryList, { rowId: newRowId(), fact, kind: options.kind || 'fact', subject: options.subject || '',
            source: options.kind === 'bot_preference' ? 'persona' : options.source || 'manual', locked: true, enabled: true, time: new Date().toISOString() }], newPersistFact: '' }));
        return true;
    };
    const editPersistFact = (id, patch) => update(s => ({ ...s, persistentMemoryList: s.persistentMemoryList.map(item => item.rowId === id ? { ...item, ...patch, locked: true } : item) }));
    const removePersistFact = id => update(s => ({ ...s, persistentMemoryList: s.persistentMemoryList.filter(item => item.rowId !== id) }));
    const savePersistentMemory = async () => {
        const { persistentBaseline, persistentMemoryList, persistentLoaded, factConflicts } = current.current;
        if (requests.current.has('savePersistent') || !persistentLoaded || factConflicts.length) return false;
        const operations = rowOperations(persistentBaseline, persistentMemoryList);
        if (!operations.length) return true;
        requests.current.get('persistent')?.controller.abort();
        const task = start('savePersistent'), { signal } = task.controller;
        let conflict = false;
        try {
            const result = await apiRequest('/api/persistent-memory', { method: 'PATCH', body: { operations }, signal, expectSuccess: true });
            if (signal.aborted) return false;
            const list = arrayData(result.items);
            update(s => ({ ...s, persistentBaseline: list, persistentMemoryList: mergeRows(persistentMemoryList, s.persistentMemoryList, list, { acknowledge: true }).rows }));
            addLog?.('system', '长期记忆已保存'); return true;
        } catch (error) {
            conflict = !signal.aborted && error.status === 409;
            if (!signal.aborted && !conflict) report(error);
            return false;
        } finally { finish('savePersistent', task); if (conflict) await fetchPersistentMemory(); }
    };
    const resolveFact = (id, useServer) => update(s => {
        const remote = s.persistentBaseline.find(item => item.rowId === id);
        let rows = s.persistentMemoryList;
        if (useServer) rows = remote ? (rows.some(item => item.rowId === id) ? rows.map(item => item.rowId === id ? remote : item) : [...rows, remote]) : rows.filter(item => item.rowId !== id);
        return { ...s, persistentMemoryList: rows, factConflicts: s.factConflicts.filter(key => key !== id) };
    });
    const resolveMessage = (id, useServer) => editCurrent(d => {
        const edits = { ...d.edits }, op = edits[id];
        if (useServer || op.before === null) delete edits[id];
        else edits[id] = { ...op, conflict: false };
        return { ...d, edits, editing: d.editing?.id === id ? null : d.editing };
    });
    const draft = state.drafts[state.currentSessionId] || emptyDraft();
    const messages = draft.rows.flatMap(row => {
        const op = draft.edits[row.rowId]; return op ? (op.after === null ? [] : [{ ...row, content: op.after }]) : [row];
    });
    const persistentDirty = useMemo(() => rowOperations(state.persistentBaseline, state.persistentMemoryList).length > 0, [state.persistentBaseline, state.persistentMemoryList]);
    const dirty = { session: sessionDirty(draft), summary: draft.summary !== draft.baselineSummary, persistent: persistentDirty };
    dirty.any = dirty.persistent || Boolean(state.newPersistFact.trim()) || Object.values(state.drafts).some(d => sessionDirty(d) || d.summary !== d.baselineSummary);
    return { sessionList: state.sessionList, currentSessionId: state.currentSessionId, sessionMessages: messages, currentSummary: draft.summary,
        page: Math.floor(draft.offset / PAGE_SIZE), pageCount: Math.max(1, Math.ceil(draft.total / PAGE_SIZE)), messageCount: draft.total, changePage,
        editingMsgId: draft.editing?.id, persistentMemoryList: state.persistentMemoryList, newPersistFact: state.newPersistFact, sessionSearch: state.sessionSearch,
        setCurrentSummary: summary => editCurrent(d => ({ ...d, summary })), setNewPersistFact, setSessionSearch,
        startEdit: (id, content) => editCurrent(d => ({ ...d, editing: { id, original: content } })),
        setEditBuffer: content => editCurrent(d => d.editing ? editContent(d, d.editing.id, content) : d),
        saveEdit: () => editCurrent(d => ({ ...d, editing: null })),
        cancelEdit: () => editCurrent(d => d.editing ? { ...editContent(d, d.editing.id, d.editing.original), editing: null } : d),
        deleteMsg: id => editCurrent(d => ({ ...editContent(d, id, null), editing: d.editing?.id === id ? null : d.editing })),
        selectSession, saveSummary: () => saveSessionPart('summary'), saveSessionChanges: () => saveSessionPart('messages'), deleteSession, savePersistentMemory,
        addPersistFact, editPersistFact, removePersistFact, factConflicts: state.factConflicts, persistentBaseline: state.persistentBaseline, resolveFact,
        messageConflicts: Object.values(draft.edits).filter(op => op.conflict), resolveMessage, summaryConflict: draft.summaryConflict, baselineSummary: draft.baselineSummary,
        resolveSummary: useServer => editCurrent(d => ({ ...d, summary: useServer ? d.baselineSummary : d.summary, summaryConflict: false })),
        load, refresh, dirty, busy: state.busy, error: state.error, persistentLoaded: state.persistentLoaded,
        loading: Boolean(state.busy.sessions || state.busy.session || state.busy.persistent),
        saving: Boolean(state.busy.saveSession || state.busy.saveSummary || state.busy.savePersistent || state.busy.deleteSession) };
}
