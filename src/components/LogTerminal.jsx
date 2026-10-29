/** Local live-log drawer. Message content stays plain text; remote images are never fetched. */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, Check, Copy, Pause, Play, Search, Terminal, X } from 'lucide-react';
import { IconButton } from './UIComponents';
import PinkSelect from './PinkSelect';
import '../styles/conversation.css';

const LEVELS = [
    { value: 'all', label: '全部级别' }, { value: 'in', label: '接收' }, { value: 'out', label: '发送' },
    { value: 'info', label: '信息' }, { value: 'system', label: '系统' }, { value: 'warn', label: '警告' }, { value: 'error', label: '错误' },
];
const LEVEL_LABELS = Object.fromEntries(LEVELS.map(option => [option.value, option.label]));
const formatLog = log => `[${log.time || '—'}] [${log.level || 'info'}] ${String(log.content || '')}`;

export default function LogTerminal({ logs = [], isLogOpen, setIsLogOpen, containerRef: _containerRef }) {
    const titleId = useId(), panelRef = useRef(null), searchRef = useRef(null), scrollRef = useRef(null), copyTimer = useRef(null);
    const reducedMotion = useReducedMotion();
    const [search, setSearch] = useState(''), [level, setLevel] = useState('all');
    const [following, setFollowing] = useState(true), [lastSeen, setLastSeen] = useState(null);
    const [copyState, setCopyState] = useState(null);
    const visibleLogs = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return logs.filter(log => (level === 'all' || log.level === level) && (!query || `${log.time || ''} ${String(log.content || '')}`.toLocaleLowerCase().includes(query)));
    }, [logs, search, level]);
    const seenIndex = lastSeen ? logs.indexOf(lastSeen) : -1;
    const unread = following ? 0 : seenIndex >= 0 ? logs.length - seenIndex - 1 : logs.length;

    useEffect(() => () => clearTimeout(copyTimer.current), []);
    useEffect(() => {
        if (!isLogOpen) return;
        const previousFocus = document.activeElement;
        searchRef.current?.focus({ preventScroll: true });
        const onKeyDown = event => {
            if (event.defaultPrevented) return;
            if (event.key === 'Escape') { event.preventDefault(); setIsLogOpen(false); return; }
            if (event.key !== 'Tab') return;
            const focusable = [...(panelRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])].filter(element => element.getClientRects().length);
            const first = focusable[0], last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
        };
    }, [isLogOpen, setIsLogOpen]);
    useEffect(() => {
        const panel = scrollRef.current;
        if (isLogOpen && following && panel) panel.scrollTop = panel.scrollHeight;
    }, [visibleLogs, following, isLogOpen]);

    const resume = () => { setFollowing(true); setLastSeen(logs.at(-1) || null); };
    const copyLogs = async () => {
        clearTimeout(copyTimer.current);
        try {
            await navigator.clipboard.writeText(visibleLogs.map(formatLog).join('\n'));
            setCopyState('已复制');
        } catch {
            setCopyState('复制失败');
        }
        copyTimer.current = setTimeout(() => setCopyState(null), 2200);
    };

    if (typeof document === 'undefined') return null;
    return createPortal(<AnimatePresence>{isLogOpen && <motion.div className="log-drawer-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
        <button type="button" className="log-drawer-backdrop" tabIndex={-1} aria-label="关闭日志" onClick={() => setIsLogOpen(false)} />
        <motion.section ref={panelRef} className="log-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} initial={reducedMotion ? false : { x: 24 }} animate={{ x: 0 }} exit={reducedMotion ? undefined : { x: 24 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
            <header className="log-drawer-header">
                <div className="log-drawer-title"><Terminal aria-hidden="true" /><h2 id={titleId}>实时日志</h2><span>{logs.length}</span></div>
                <div className="log-drawer-actions">
                    <IconButton icon={copyState === '已复制' ? Check : Copy} label={copyState || '复制当前日志'} disabled={visibleLogs.length === 0} onClick={copyLogs} />
                    <IconButton icon={X} label="关闭日志" onClick={() => setIsLogOpen(false)} />
                </div>
            </header>
            <div className="log-drawer-filters">
                <label className="log-drawer-search"><Search aria-hidden="true" /><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索日志" aria-label="搜索日志" /></label>
                <PinkSelect label="日志级别" value={level} options={LEVELS} onChange={setLevel} />
            </div>
            <div className="log-drawer-meta"><span>{visibleLogs.length} 条{search || level !== 'all' ? '匹配' : '记录'}</span><button type="button" aria-pressed={!following} onClick={() => {
                if (following) { setFollowing(false); setLastSeen(logs.at(-1) || null); }
                else resume();
            }}>{following ? <Pause size={12} /> : <Play size={12} />}{following ? '暂停跟随' : '继续跟随'}</button></div>
            <div ref={scrollRef} className="log-drawer-stream custom-scrollbar" aria-label="日志内容" onScroll={event => {
                const panel = event.currentTarget;
                if (following && panel.scrollHeight - panel.scrollTop - panel.clientHeight > 56) {
                    setFollowing(false); setLastSeen(logs.at(-1) || null);
                }
            }}>
                {visibleLogs.length === 0 ? <div className="log-drawer-empty"><Terminal aria-hidden="true" /><span>{logs.length ? '没有匹配的日志' : '等待新日志'}</span></div> : visibleLogs.map((log, index) => <article key={log.id || `${log.time}-${index}`} className={`log-entry log-entry-${LEVEL_LABELS[log.level] ? log.level : 'info'}`}>
                    <div className="log-entry-meta"><span className="log-entry-level">{LEVEL_LABELS[log.level] || log.level || '信息'}</span><time>{log.time || '—'}</time></div>
                    <p>{String(log.content || '')}</p>
                </article>)}
            </div>
            <footer className="log-drawer-footer"><span role="status">{copyState || (following ? '自动跟随最新记录' : '已暂停自动跟随')}</span>{!following && <button type="button" onClick={resume}><ArrowDown size={13} />{unread > 0 ? `${unread} 条新日志` : '回到最新'}</button>}</footer>
        </motion.section>
    </motion.div>}</AnimatePresence>, document.body);
}
