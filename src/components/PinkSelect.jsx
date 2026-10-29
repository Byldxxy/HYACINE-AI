import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

/** Controlled pink listbox, rendered outside scrolling panels to avoid clipping. */
export default function PinkSelect({ label, value, options, onChange }) {
    const id = useId(), trigger = useRef(null), menu = useRef(null);
    const [open, setOpen] = useState(false), [active, setActive] = useState(0), [position, setPosition] = useState(null);
    const selected = options.findIndex(option => option.value === value);
    const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
    const choose = index => { if (options[index]) onChange(options[index].value); close(true); };
    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = trigger.current.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 208), window.innerWidth - 24);
            const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
            const upward = below < 220 && above > below;
            const height = Math.max(80, Math.min(options.length * 42 + 12, 280, upward ? above : below));
            setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width, maxHeight: height,
                ...(upward ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
        };
        place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
    }, [open, options.length]);
    useEffect(() => {
        if (!open) return;
        const outside = e => { if (!trigger.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
    }, [open]);
    useEffect(() => { if (open) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' }); }, [active, open]);
    const keyDown = e => {
        if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
        if (e.key === 'Tab') { close(); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            if (!open) { setActive(Math.max(0, selected)); setOpen(true); return; }
            setActive(i => e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault(); if (open) choose(active); else { setActive(Math.max(0, selected)); setOpen(true); }
        }
    };
    return <>
        <button ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
            aria-haspopup="listbox" aria-activedescendant={open ? `${id}-${active}` : undefined} className="pink-select-trigger" onKeyDown={keyDown}
            onClick={() => { setActive(Math.max(0, selected)); setOpen(!open); }}>
            <span className="truncate">{options[selected]?.label || label}</span><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && position && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} className="pink-select-menu custom-scrollbar" style={position}>
            {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value}
                className={`pink-select-option ${index === active ? 'pink-select-option-active' : ''}`} onPointerMove={() => setActive(index)}
                onMouseDown={e => e.preventDefault()} onClick={() => choose(index)}>
                <span>{option.label}</span>{option.value === value && <Check className="h-4 w-4 shrink-0" />}
            </div>)}
        </div>, document.body)}
    </>;
}
