/**
 * 桌宠 WebGL 画布上方的纯 DOM 覆盖层。
 *
 * 加载/错误、动态气泡、右键菜单和缩放条放在这里，避免把 UI 状态混入 Three.js 场景。
 * 气泡实测高度会回传 PetScene，再由 Electron 从底边锚定扩展原生窗口。
 */
import React, { useLayoutEffect, useRef } from 'react';
import { FlaskConical, LockKeyhole, Minus, Plus, Settings } from 'lucide-react';

const stopPointerEvent = event => event.stopPropagation();

export default function PetOverlay({
    loading,
    error,
    speech,
    showMenu,
    passthrough,
    petScale,
    onCloseMenu,
    onOpenConfig,
    onTogglePassthrough,
    onScaleChange,
    onScaleCommit,
    onSpeechHeightChange,
    onTestDesktopAwareness,
}) {
    const speechRef = useRef(null);

    useLayoutEffect(() => {
        // useLayoutEffect 在浏览器绘制前测量，减少气泡先跳一次再稳定的视觉抖动。
        if (!speech || !speechRef.current) return;
        onSpeechHeightChange?.(Math.ceil(speechRef.current.getBoundingClientRect().height) + 16);
    }, [onSpeechHeightChange, petScale, speech]);

    return (
        <>
            {loading && (
                <div className="pet-loading" role="status">加载中...</div>
            )}

            {error && (
                <div className="pet-error" role="alert">{error}</div>
            )}

            {speech && (
                <div ref={speechRef} className="pet-speech" role="status" aria-live="polite">
                    {speech}
                </div>
            )}

            {showMenu && (
                <div
                    className="pet-menu"
                    onClick={stopPointerEvent}
                    onContextMenu={(event) => { event.preventDefault(); stopPointerEvent(event); }}
                    onMouseDown={stopPointerEvent}
                >
                    <button type="button" onClick={() => { onCloseMenu(); onOpenConfig(); }}>
                        <Settings />
                        <span>打开配置面板</span>
                    </button>
                    <button type="button" onClick={() => { onCloseMenu(); onTogglePassthrough(); }}>
                        <LockKeyhole />
                        <span>穿透模式</span>
                        <span className={`pet-menu-check ${passthrough ? 'pet-menu-check-on' : ''}`} />
                    </button>
                    <button type="button" onClick={() => { onCloseMenu(); onTestDesktopAwareness(); }}>
                        <FlaskConical />
                        <span>测试桌面感知</span>
                    </button>
                </div>
            )}

            <label
                className="pet-scale"
                onClick={stopPointerEvent}
                onMouseDown={stopPointerEvent}
                onMouseUp={stopPointerEvent}
                onContextMenu={stopPointerEvent}
            >
                <Minus />
                <input
                    type="range"
                    aria-label="桌宠大小"
                    min="0.5"
                    max="2.5"
                    step="0.1"
                    value={petScale}
                    onChange={onScaleChange}
                    onPointerUp={onScaleCommit}
                    onKeyUp={onScaleCommit}
                    onBlur={onScaleCommit}
                />
                <Plus />
                <span>{Math.round(petScale * 100)}%</span>
            </label>
        </>
    );
}
