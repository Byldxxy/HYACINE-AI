/** Native menus share main-process state. Only the size editor and speech live in DOM. */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
const stop = event => event.stopPropagation();

export default function PetOverlay({ loading, behaviorLabel, error, speech, showSizePanel, petScale, onCloseSizePanel, onScaleChange, onScaleCommit, onScaleSelect, onSpeechHeightChange }) {
    const speechRef = useRef(null);
    const sliderRef = useRef(null);
    const [viewport, setViewport] = useState(null);
    useLayoutEffect(() => {
        if (speech && speechRef.current) onSpeechHeightChange?.(Math.ceil(speechRef.current.getBoundingClientRect().height) + 16);
    }, [onSpeechHeightChange, petScale, speech]);
    useLayoutEffect(() => {
        if (!showSizePanel) return;
        let active = true;
        const receive = value => { if (active && value) setViewport(value); };
        const unsubscribe = window.electronAPI?.onPetViewport?.(receive);
        window.electronAPI?.getPetViewport?.().then(receive).catch(() => {});
        sliderRef.current?.focus({ preventScroll: true });
        const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); onCloseSizePanel(); } };
        window.addEventListener('keydown', onKey);
        return () => { active = false; unsubscribe?.(); window.removeEventListener('keydown', onKey); };
    }, [showSizePanel, onCloseSizePanel]);
    const safe = viewport || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const panelStyle = {
        left: safe.x + 8,
        top: safe.y + Math.max(8, safe.height - 92),
        width: Math.max(0, safe.width - 16),
        maxHeight: Math.max(0, safe.height - 16),
    };
    return <>
        {loading && <div className="pet-loading" role="status">加载中...</div>}
        {error && <div className="pet-error" role="alert">{error}</div>}
        {speech && <div ref={speechRef} className="pet-speech frost-surface" role="status" aria-live="polite">{speech}</div>}
        {!loading && !error && <span className="visually-hidden" role="status">{behaviorLabel}</span>}
        {showSizePanel && <section
            className="pet-size-panel frost-surface" data-pet-controls role="dialog" aria-label="调整桌宠大小" style={panelStyle}
            onPointerDown={stop} onPointerMove={stop} onPointerUp={stop}
            onClick={stop} onDoubleClick={stop} onContextMenu={event => { event.preventDefault(); stop(event); }}
        >
            <header>
                <span className="pet-size-title">大小</span>
                <output>{Math.round(petScale * 100)}%</output>
                <button className="frost-icon-button" type="button" aria-label="关闭大小面板" onClick={onCloseSizePanel}><X size={13} /></button>
            </header>
            <div className="pet-scale">
                <button type="button" className="frost-icon-button" disabled={petScale <= 0.5} aria-label="缩小角色" onClick={() => onScaleSelect(Math.max(0.5, Math.round((petScale - 0.1) * 10) / 10))}><Minus size={12} /></button>
                <input ref={sliderRef} className="frost-range" type="range" aria-label="桌宠大小" aria-valuetext={`${Math.round(petScale * 100)}%`} min="0.5" max="2.5" step="0.1" value={petScale}
                    onChange={onScaleChange}
                    onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
                    onPointerUp={onScaleCommit} onPointerCancel={onScaleCommit} onLostPointerCapture={onScaleCommit}
                    onKeyUp={onScaleCommit} onBlur={onScaleCommit}
                />
                <button type="button" className="frost-icon-button" disabled={petScale >= 2.5} aria-label="放大角色" onClick={() => onScaleSelect(Math.min(2.5, Math.round((petScale + 0.1) * 10) / 10))}><Plus size={12} /></button>
            </div>
        </section>}
    </>;
}
