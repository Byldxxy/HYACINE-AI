import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';

/** Test requests are isolated from real conversations and invalidated when the test is cleared. */
export function useTestChat(addLog) {
    const [state, setState] = useState({ testMessages: [], testInput: '', testIsMaster: true, testLoading: false, clearing: false, error: '' });
    const current = useRef(state), active = useRef(null), clearRequest = useRef(null), generation = useRef(0), mounted = useRef(true);
    const update = useCallback(change => {
        const next = change(current.current); current.current = next;
        if (mounted.current) setState(next);
    }, []);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; active.current?.abort(); clearRequest.current?.abort(); };
    }, []);
    const setTestInput = useCallback(value => update(s => ({ ...s, testInput: typeof value === 'function' ? value(s.testInput) : value })), [update]);
    const setTestIsMaster = useCallback(value => update(s => ({ ...s, testIsMaster: value })), [update]);
    const sendTestMessage = useCallback(async () => {
        const message = current.current.testInput.trim();
        if (!message || active.current || clearRequest.current) return false;
        const controller = new AbortController(), requestGeneration = generation.current, isMaster = current.current.testIsMaster;
        active.current = controller;
        update(s => ({ ...s, testMessages: [...s.testMessages, { role: 'user', content: message }], testInput: '', testLoading: true, error: '' }));
        try {
            const data = await apiRequest('/api/test-chat', { method: 'POST', body: { message, isMaster, scenario: 'default' }, signal: controller.signal });
            if (controller.signal.aborted || generation.current !== requestGeneration) return false;
            if (typeof data?.reply !== 'string') throw new Error('测试接口未返回有效回复');
            update(s => ({ ...s, testMessages: [...s.testMessages, { role: 'assistant', content: data.reply, isImage: data.isImage, imagePrompt: data.imagePrompt }] }));
            return true;
        } catch (error) {
            if (!controller.signal.aborted && generation.current === requestGeneration) {
                const detail = error.message || '测试消息发送失败';
                update(s => ({ ...s, error: detail, testInput: s.testInput || message }));
                addLog?.('error', detail);
            }
            return false;
        } finally {
            if (active.current === controller) { active.current = null; update(s => ({ ...s, testLoading: false })); }
        }
    }, [addLog, update]);
    const clearTestChat = useCallback(async () => {
        if (clearRequest.current) return false;
        generation.current++; active.current?.abort(); active.current = null;
        const controller = new AbortController(); clearRequest.current = controller;
        update(s => ({ ...s, testLoading: false, clearing: true, error: '' }));
        try {
            await apiRequest('/api/test-chat/default', { method: 'DELETE', signal: controller.signal, expectSuccess: true });
            if (controller.signal.aborted) return false;
            update(s => ({ ...s, testMessages: [] }));
            return true;
        } catch (error) {
            if (!controller.signal.aborted) {
                const detail = error.message || '测试会话清空失败';
                update(s => ({ ...s, error: detail })); addLog?.('error', detail);
            }
            return false;
        } finally {
            if (clearRequest.current === controller) { clearRequest.current = null; update(s => ({ ...s, clearing: false })); }
        }
    }, [addLog, update]);
    return { ...state, setTestInput, setTestIsMaster, sendTestMessage, clearTestChat };
}
