import React, { useEffect, useRef, useState } from 'react';
import { Search, CornerDownLeft, X } from 'lucide-react';

export default function CommandPalette({ open, onClose, commands }) {
    const dialog = useRef(null), input = useRef(null);
    const [query, setQuery] = useState(''), [selected, setSelected] = useState(0);
    const filtered = commands.filter(command => `${command.label} ${command.keywords || ''}`.toLowerCase().includes(query.toLowerCase()));
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement, element = dialog.current;
        element.showModal(); input.current?.focus();
        return () => { element.close(); previous?.focus?.(); };
    }, [open]);
    const run = command => { if (command) { onClose(); command.run(); } };
    return <dialog ref={dialog} className="command-dialog" aria-label="快捷操作" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="command-search"><Search size={19} /><input ref={input} value={query} placeholder="前往页面或执行操作…" aria-label="搜索操作" role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={filtered[selected] ? `command-${selected}` : undefined}
            onChange={e => { setQuery(e.target.value); setSelected(0); }} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(0, Math.min(filtered.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); } if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); run(filtered[selected]); } }} /><button type="button" aria-label="关闭快捷操作" onClick={onClose}><X size={16} /></button></div>
        <div id="command-results" role="listbox" aria-label="操作结果" className="command-results">{filtered.map((command, i) => <button id={`command-${i}`} role="option" aria-selected={i === selected} key={command.label} className={i === selected ? 'is-active' : ''} type="button" onMouseEnter={() => setSelected(i)} onClick={() => run(command)}><command.icon size={17} /><span>{command.label}</span><CornerDownLeft size={14} /></button>)}{!filtered.length && <p className="activity-empty">没有匹配的操作</p>}</div>
        <div className="command-hint"><span>↑ ↓ 选择</span><span>↵ 打开</span><span>Esc 关闭</span></div>
    </dialog>;
}
