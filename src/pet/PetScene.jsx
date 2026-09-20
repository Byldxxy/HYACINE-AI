/**
 * 桌宠渲染进程的主场景。
 *
 * 本组件把 React UI、Three.js/MMD 运行时和 Electron preload API 组合在一起：React state
 * 管理气泡/菜单/尺寸，sceneRef 保存不应触发重渲染的逐帧对象，WebSocket 语义事件再通过
 * manifest 映射为动作与表情。文件较长是因为浏览器事件和 WebGL 生命周期必须共享同一
 * 模型实例；可复用算法已拆到 runtime/ 和 ui/ 子模块。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import { StarRailToonPipeline } from './rendering/StarRailToonPipeline';
import { API_BASE_URL } from '../lib/api';
import { DEFAULT_PET_MANIFEST, loadPetManifest } from './config/petManifest';
import { usePetEvents } from './hooks/usePetEvents';
import { ExpressionController } from './runtime/ExpressionController';
import { loadManifestMotions } from './runtime/loadMotions';
import { LookAtController } from './runtime/LookAtController';
import { inspectMmdModel } from './runtime/modelDiagnostics';
import { MotionController } from './runtime/MotionController';
import PetOverlay from './ui/PetOverlay';
import { PetBehavior } from './runtime/PetBehavior';
import { HandDragController } from './runtime/HandDragController';
import { createCompanionMotions } from './runtime/companionMotions';

const BASE_WIDTH = 250;
const BASE_HEIGHT = 400;
const MIN_SPEECH_HEADROOM = 64;
const MAX_SPEECH_HEADROOM = 500;
const MAX_RENDERED_SPEECH_LENGTH = 1000;
const PET_SCALE_KEY = 'hyacine-pet-scale';
const ROAMING_KEY = 'hyacine-window-roaming';
const STATE_LABELS = { mantling: '翻越', pointerNotice: '注视', pointerFocus: '注视', clinging: '抓握', idle: '休息中', walking: '散步中', climbing: '攀爬中', falling: '落下中', landing: '站稳啦', thinking: '思考中', working: '创作中', speaking: '说话中', dragging: '被拎起来了', greet: '打招呼', tapHead: '摸摸头', tapBody: '回应你', attention: '听你说', error: '有点困惑' };

function loadPetScale() {
    // localStorage 属于 renderer；原生窗口尺寸由后续 effect 通过 preload 同步。
    try {
        const value = Number(localStorage.getItem(PET_SCALE_KEY));
        return Number.isFinite(value) && value >= 0.5 && value <= 2.5 ? value : 1;
    } catch {
        return 1;
    }
}

function estimateSpeechHeadroom(text) {
    // 首次 render 前没有 DOM 高度，先估算以立即扩窗；PetOverlay 随后回传实测值校正。
    const lines = Math.max(1, Math.ceil(String(text || '').length / 14));
    return Math.min(MAX_SPEECH_HEADROOM, Math.max(MIN_SPEECH_HEADROOM, 34 + lines * 21));
}

function loadModel(loader, path) {
    // Vite 对不存在的静态路径可能返回 HTML fallback，HEAD 检查可给出明确的资源错误。
    return fetch(path, { method: 'HEAD' }).then(response => {
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || contentType.includes('text/html')) {
            throw new Error(`未找到模型文件: ${path}`);
        }
        return new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));
    });
}

function getHitRegion(mesh, point) {
    // 当前交互区域按模型包围盒高度粗分，避免要求每个模型额外提供碰撞骨骼配置。
    const box = mesh.geometry.boundingBox;
    if (!box) return 'body';
    const localPoint = mesh.worldToLocal(point.clone());
    const height = Math.max(0.001, box.max.y - box.min.y);
    return (localPoint.y - box.min.y) / height >= 0.72 ? 'head' : 'body';
}

function disposeMesh(mesh) {
    // Three.js 不会自动释放 GPU 纹理/几何体；热更新或组件重挂载时必须显式回收。
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.filter(Boolean).forEach(material => {
        Object.values(material).forEach(value => {
            if (value?.isTexture) value.dispose();
        });
        material.dispose();
    });
}

export default function PetScene() {
    // React state 用于 DOM 展示；Three.js 对象放在 ref 中，避免 60 FPS 更新触发 React render。
    const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const speechTimerRef = useRef(null);
    const petScaleDraftRef = useRef(loadPetScale());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSizePanel, setShowSizePanel] = useState(false);
    const interactionReasons = useRef(new Set());
    const uiPausedRef = useRef(false);
    const [petScale, setPetScale] = useState(loadPetScale);
    const [petScaleDraft, setPetScaleDraft] = useState(loadPetScale);
    const [speech, setSpeech] = useState('');
    const [behaviorState, setBehaviorState] = useState('idle');
    const [windowState, setWindowState] = useState(null);
    const nativeStateRef = useRef(null);
    const [speechHeadroom, setSpeechHeadroom] = useState(0);

    const showSpeech = useCallback((text, duration) => {
        // 气泡文本在 UI 边界再次限长，防止异常事件无限扩大透明原生窗口。
        const message = String(text || '').trim().slice(0, MAX_RENDERED_SPEECH_LENGTH);
        if (!message) return;
        setSpeechHeadroom(estimateSpeechHeadroom(message));
        setSpeech(message);
        clearTimeout(speechTimerRef.current);
        speechTimerRef.current = setTimeout(() => {
            setSpeech('');
            setSpeechHeadroom(0);
        }, duration * 1000);
    }, []);

    const updateSpeechHeight = useCallback((height) => {
        const nextHeight = Math.min(MAX_SPEECH_HEADROOM, Math.max(MIN_SPEECH_HEADROOM, Math.ceil(Number(height) || 0)));
        setSpeechHeadroom(previous => Math.abs(previous - nextHeight) > 1 ? nextHeight : previous);
    }, []);

    const handlePetEvent = useCallback((event, detail = {}) => {
        const state = sceneRef.current;
        state?.behavior?.event(event, detail);
        const definition = state?.manifest?.events?.[event];
        if (definition?.expression) state?.expressionController?.play(definition.expression, { duration: Number(detail.duration) || 1.5 });
        if (event === 'speaking' || event === 'desktopComment') state?.expressionController?.speak(Number(detail.duration) || 4);
        if (event === 'desktopComment' && detail.text) showSpeech(detail.text, Math.max(4, Math.min(12, Number(detail.duration) || 6)));
    }, [showSpeech]);

    usePetEvents(handlePetEvent);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.onWindowCompanion) return;
        let alive = true;
        const receive = state => {
            if (!alive || !state) return;
            nativeStateRef.current = state;
            setWindowState(state);
            try { localStorage.setItem(ROAMING_KEY, String(state.enabled)); } catch { /* Session preference. */ }
            sceneRef.current?.behavior?.setInteracting(uiPausedRef.current || Boolean(state.interactionPaused));
            sceneRef.current?.behavior?.setLocomotion(state.state);
        };
        const unsubscribe = api.onWindowCompanion(receive);
        api.getWindowCompanion().then(receive).catch(() => {});
        let enabled = true;
        try { enabled = localStorage.getItem(ROAMING_KEY) !== 'false'; } catch { /* Session preference. */ }
        api.setWindowRoaming(enabled).catch(() => {});
        return () => { alive = false; unsubscribe?.(); api.pauseWindowRoaming(false); };
    }, []);

    const setInteraction = useCallback((reason, active) => {
        if (active) interactionReasons.current.add(reason); else interactionReasons.current.delete(reason);
        const paused = interactionReasons.current.size > 0;
        uiPausedRef.current = paused;
        sceneRef.current?.behavior?.setInteracting(paused || Boolean(nativeStateRef.current?.interactionPaused));
        window.electronAPI?.pauseWindowRoaming?.(paused, [...interactionReasons.current].some(item => item !== 'hover') ? 'controls' : 'pointer');
    }, []);
    const closeSizePanel = useCallback(() => {
        setPetScale(petScaleDraftRef.current);
        setShowSizePanel(false);
        setInteraction('panel', false);
    }, [setInteraction]);

    useEffect(() => {
        try {
            localStorage.setItem(PET_SCALE_KEY, String(petScale));
        } catch {
            // Keep the current size when storage is unavailable.
        }
        // 高度包含 speechHeadroom，并要求主进程固定底边，角色脚部不会随气泡上下跳动。
        window.electronAPI?.resizePetWindow?.(
            Math.max(BASE_WIDTH * petScale, showSizePanel ? 264 : 0),
            BASE_HEIGHT * petScale + speechHeadroom,
            true
        );
    }, [petScale, speechHeadroom, showSizePanel]);

    useEffect(() => {
        const unsubscribe = window.electronAPI?.onGlobalCursorMoved?.(({ x, y, windowBounds }) => {
            const state = sceneRef.current;
            const container = mountRef.current;
            if (!state || !container || !windowBounds) return;
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const localX = x - windowBounds.x - rect.left;
            const localY = y - windowBounds.y - rect.top;
            state.cursor = { x: localX, y: localY, receivedAt: performance.now() };
        });
        return () => unsubscribe?.();
    }, []);

    useEffect(() => () => clearTimeout(speechTimerRef.current), []);

    const updatePetScaleDraft = useCallback((event) => {
        // 拖动滑块只更新 DOM 预览值，不立即缩放原生窗口；否则滑块会随窗口移动而失去指针。
        const nextScale = Number(event.target.value);
        petScaleDraftRef.current = nextScale;
        setPetScaleDraft(nextScale);
    }, []);

    const commitPetScale = useCallback(() => {
        // pointer up / blur / keyboard commit 时一次性调整窗口和 WebGL 画布。
        setPetScale(petScaleDraftRef.current);
    }, []);

    const testDesktopAwareness = useCallback(async () => {
        const result = await window.electronAPI?.testDesktopAwareness?.();
        const message = result?.ok
            ? '我看看。'
            : result?.message || '桌面感知仅在 Electron 桌宠模式下可用';
        showSpeech(message, result?.ok ? 2.5 : 3.5);
    }, [showSpeech]);

    useEffect(() => {
        const unsubscribe = window.electronAPI?.onPetCommand?.(command => {
            if (command === 'size') { setInteraction('panel', true); setShowSizePanel(true); }
            if (command === 'close-controls') { closeSizePanel(); setInteraction('hover', false); }
            if (command === 'greet') sceneRef.current?.behavior?.event('greet');
            if (command === 'observe') void testDesktopAwareness();
        });
        const unsubscribeDrag = window.electronAPI?.onDragAnchor?.(anchor => {
            const runtime = sceneRef.current;
            if (!runtime) return;
            runtime.dragAnchor = anchor;
            if (anchor) runtime.handDrag?.start(anchor); else runtime.handDrag?.stop();
        });
        const cancelPointer = () => {
            const state = sceneRef.current;
            if (state?.press) {
                if (state.isDragging) { window.electronAPI?.dragEnd?.({ cancelled: true }); state.handDrag?.stop(); state.behavior?.event('dragEnd'); }
                state.press = null; state.isDragging = false;
            }
            setInteraction('pointer', false); setInteraction('hover', false);
        };
        window.addEventListener('blur', cancelPointer);
        return () => { unsubscribe?.(); unsubscribeDrag?.(); window.removeEventListener('blur', cancelPointer); window.electronAPI?.pauseWindowRoaming?.(false); };
    }, [closeSizePanel, setInteraction, testDesktopAwareness]);

    const updateHit = useCallback(event => {
        const state = sceneRef.current, rect = mountRef.current?.getBoundingClientRect();
        if (!state || !rect?.width || !rect?.height) return null;
        state.cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top, receivedAt: performance.now() };
        state.mouse.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        state.raycaster.setFromCamera(state.mouse, state.camera);
        const hit = state.model ? state.raycaster.intersectObject(state.model, true)[0] : null;
        state.hoverRegion = hit ? getHitRegion(state.model, hit.point) : null;
        return state;
    }, []);

    const handlePointerDown = useCallback(event => {
        if (event.button !== 0 || event.target.closest('button, input, label, [data-pet-controls]')) return;
        closeSizePanel();
        const state = updateHit(event); if (!state?.model || !state.footPoint || !state.behavior) return;
        state.press = { x: event.screenX, y: event.screenY, region: state.hoverRegion, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
        setInteraction('pointer', true);
    }, [closeSizePanel, setInteraction, updateHit]);

    const handlePointerMove = useCallback(event => {
        const state = updateHit(event); if (!state) return;
        if (state.press && !state.isDragging && Math.hypot(event.screenX - state.press.x, event.screenY - state.press.y) > 5) {
            state.isDragging = true;
            state.behavior?.event('dragStart');
            window.electronAPI?.dragStart?.(state.press.x, state.press.y);
        }
        if (state.isDragging) {
            state.handDrag?.dynamics.sample(event.screenX, performance.now());
            window.electronAPI?.dragMove?.(event.screenX, event.screenY);
        }
        event.currentTarget.style.cursor = state.isDragging ? 'grabbing' : state.hoverRegion ? 'pointer' : 'grab';
    }, [updateHit]);

    const handlePointerEnd = useCallback(event => {
        const state = sceneRef.current;
        if (!state?.press) return;
        const wasDragging = state.isDragging;
        if (wasDragging) {
            state.isDragging = false;
            const rect = mountRef.current.getBoundingClientRect();
            const foot = state.footPoint.clone().applyMatrix4(state.model.matrixWorld).project(state.camera);
            window.electronAPI?.dragEnd?.({ foot: { x: rect.left + (foot.x + 1) * rect.width / 2, y: rect.top + (1 - foot.y) * rect.height / 2 }, cancelled: event.type !== 'pointerup' });
            state.handDrag?.stop();
            state.behavior?.event('dragEnd');
        } else if (event.type === 'pointerup' && state.press.region) {
            const definition = state.manifest.interactions[state.press.region];
            state.behavior?.event(state.press.region === 'head' ? 'tapHead' : 'tapBody');
            if (definition?.expression) state.expressionController?.play(definition.expression, { duration: 2 });
        }
        state.press = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setInteraction('pointer', false);
    }, [setInteraction]);

    const openConfig = useCallback(() => {
        if (window.electronAPI?.openConfig) window.electronAPI.openConfig();
        else window.open(API_BASE_URL);
    }, []);

    useEffect(() => {
        const container = mountRef.current;
        if (!container) return undefined;

        // disposed 防止异步模型/VMD 在组件卸载后继续写入场景。
        let disposed = false;
        let animationFrame;
        let helper = null;
        let mesh = null;
        const scene = new THREE.Scene();
        scene.background = null;
        const camera = new THREE.PerspectiveCamera(30, container.clientWidth / container.clientHeight, 0.1, 200);
        camera.position.set(0, 10, 55);
        camera.lookAt(0, 10, 0);

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            // 仅开发环境保留帧缓冲，供像素诊断函数读取；生产关闭可降低 GPU 内存压力。
            preserveDrawingBuffer: import.meta.env.DEV,
        });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        const toonPipeline = new StarRailToonPipeline(renderer);
        container.appendChild(renderer.domElement);

        // runtime 是渲染循环、DOM 事件和 WebSocket 回调共享的可变状态容器。
        const runtime = {
            model: null,
            manifest: DEFAULT_PET_MANIFEST,
            mouse: new THREE.Vector2(),
            camera,
            raycaster: new THREE.Raycaster(),
            isHovering: false,
            isDragging: false,
            hoverRegion: null,
            helper: null,
            motionController: null,
            expressionController: null,
            lookAtController: null,
            time: 0,
        };
        sceneRef.current = runtime;

        const initialize = async () => {
            // 初始化顺序不可随意调整：manifest 决定模型路径和映射；模型加载后才能加载
            // 绑定到该 mesh 的 VMD；全部 clip 注册到 helper 后 MotionController 才能取 mixer。
            let manifestResult;
            try {
                manifestResult = await loadPetManifest();
            } catch (manifestError) {
                console.warn('[Pet] Manifest load failed, using defaults:', manifestError.message);
                manifestResult = { manifest: DEFAULT_PET_MANIFEST, source: 'default' };
            }
            runtime.manifest = manifestResult.manifest;
            console.info(`[Pet] Manifest source: ${manifestResult.source}`);

            let hasPhysics = false;
            try {
                if (typeof window.Ammo === 'function') {
                    window.Ammo = await window.Ammo();
                }
                hasPhysics = Boolean(window.Ammo?.btDiscreteDynamicsWorld);
            } catch (physicsError) {
                console.warn('[Pet] Ammo initialization failed:', physicsError.message);
            }
            helper = new MMDAnimationHelper({
                afterglow: 2,
                sync: false,
                // 物理保持连续运行；禁用循环边界硬重置，避免每轮待机都让衣物跳动。
                resetPhysicsOnLoop: false,
            });
            runtime.helper = helper;

            const loader = new MMDLoader();
            mesh = await loadModel(loader, runtime.manifest.model);
            if (disposed) { disposeMesh(mesh); return; }
            runtime.model = mesh;
            mesh.scale.setScalar(1.2);
            mesh.geometry.computeBoundingBox();
            scene.add(mesh);

            toonPipeline.configure(mesh);
            // 在 helper/动作启动前捕获模型的中立眼骨姿态。
            runtime.lookAtController = new LookAtController(mesh, runtime.manifest.bones);
            runtime.handDrag = new HandDragController(mesh);

            // 动作属于可选能力，部分加载失败只记录诊断，不让整个模型初始化失败。
            const builtInMotions = createCompanionMotions(mesh);
            const { motions: externalMotions, errors: motionErrors } = await loadManifestMotions(loader, mesh, runtime.manifest.motions, builtInMotions);
            const motions = { ...builtInMotions, ...externalMotions };
            if (disposed) return;
            motionErrors.forEach(item => console.warn(`[Pet] Motion failed: ${item.name} (${item.file})`, item.message));
            Object.entries(motions).forEach(([name, motion]) => {
                if (motion.removedSolverTracks > 0) {
                    console.info(`[Pet] Motion sanitized: ${name}, removed ${motion.removedSolverTracks} solver-owned tracks`);
                }
            });
            const clips = Object.values(motions).map(item => item.clip);
            helper.add(mesh, {
                animation: clips.length > 0 ? clips : undefined,
                physics: hasPhysics,
            });

            runtime.motionController = new MotionController({ helper, mesh, motions, onFinished: () => true });
            runtime.expressionController = new ExpressionController(mesh, runtime.manifest.expressions);
            runtime.capabilities = inspectMmdModel(mesh, runtime.manifest, hasPhysics);
            runtime.behavior = new PetBehavior({
                now: () => runtime.time,
                onChange: (name, { busy }) => {
                    const mapped = runtime.manifest.states?.[name]?.motion || name;
                    runtime.motionController.play(runtime.motionController.has(mapped) ? mapped : name, { force: true });
                    setBehaviorState(name);
                    window.electronAPI?.setPetBusy?.(busy);
                },
            });
            runtime.behavior.setInteracting(uiPausedRef.current || Boolean(nativeStateRef.current?.interactionPaused));
            runtime.behavior.setLocomotion(nativeStateRef.current?.state || 'idle');
            if (!runtime.behavior.interacting) runtime.behavior.event('greet');
            runtime.footPoint = new THREE.Vector3(0, mesh.geometry.boundingBox.min.y, 0);
            runtime.motionSources = Object.fromEntries(Object.entries(motions).map(([name, motion]) => [name, motion.source || 'vmd']));
            onResize();
            setLoading(false);
        };

        initialize().catch(initializationError => {
            console.error('[Pet] Initialization failed:', initializationError);
            if (!disposed) {
                setError(`模型加载失败: ${initializationError.message || initializationError}`);
                setLoading(false);
            }
        });

        const onResize = () => {
            const width = container.clientWidth;
            const height = container.clientHeight;
            if (!runtime.isDragging) camera.zoom = 1;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
            if (runtime.footPoint && runtime.model && !runtime.isDragging) {
                // Project a stable rest-pose foot point, never the animated ankle/bounding box.
                const point = runtime.footPoint.clone().multiplyScalar(1.2).project(camera);
                const rect = container.getBoundingClientRect();
                window.electronAPI?.setPetMetrics?.({
                    anchorX: rect.left + (point.x + 1) * width / 2,
                    anchorY: rect.top + (1 - point.y) * height / 2,
                    radius: Math.max(12, width * 0.12),
                    height: height * 0.8,
                });
            }
        };
        window.addEventListener('resize', onResize);

        const clock = new THREE.Clock();
        if (import.meta.env.DEV) {
            // Playwright/开发者可调用此函数确认透明 canvas 不是“成功初始化但实际全空”。
            window.__HYACINE_PET_DIAGNOSTICS__ = () => {
                const gl = renderer.getContext();
                const width = renderer.domElement.width;
                const height = renderer.domElement.height;
                const pixels = new Uint8Array(width * height * 4);
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                let nonTransparentPixels = 0;
                for (let index = 3; index < pixels.length; index += 4) {
                    if (pixels[index] > 8) nonTransparentPixels += 1;
                }
                return {
                    canvas: { width, height },
                    drag: runtime.handDrag?.snapshot(camera, container.clientWidth, container.clientHeight),
                    nonTransparentPixels,
                    coverage: nonTransparentPixels / Math.max(1, width * height),
                    modelLoaded: Boolean(runtime.model),
                    motion: runtime.motionController?.state || 'loading',
                    behavior: runtime.behavior?.current,
                    motionTime: runtime.motionController?.current?.action?.time,
                    motionPaused: runtime.motionController?.current?.action?.paused,
                    motionSources: runtime.motionSources,
                    rendering: toonPipeline.snapshot(),
                    gaze: runtime.lookAtController?.snapshot(),
                    windowCompanion: nativeStateRef.current,
                    expressions: runtime.expressionController?.snapshot() || null,
                    capabilities: runtime.capabilities || null,
                };
            };
        }
        const animate = () => {
            animationFrame = requestAnimationFrame(animate);
            const delta = Math.min(clock.getDelta(), 0.05);
            if (document.hidden) return;
            runtime.handDrag?.restore();
            const zoom = runtime.dragAnchor ? Math.max(0.1, (runtime.dragAnchor.baseHeight - (container.offsetTop || 0)) / container.clientHeight) : 1;
            if (camera.zoom !== zoom) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
            runtime.time += delta;
            runtime.behavior?.update();
            const nativeState = nativeStateRef.current;
            if (runtime.model) {
                const moving = ['walking', 'climbing', 'clinging', 'mantling'].includes(runtime.behavior?.current);
                const targetAngle = moving ? (nativeState?.direction || 1) * (['climbing', 'clinging', 'mantling'].includes(runtime.behavior.current) ? 1.05 : 0.8) : 0;
                runtime.model.rotation.y += (targetAngle - runtime.model.rotation.y) * (1 - Math.exp(-6 * delta));
                // Interaction clips keep playing (breathing, settling and looking), never freeze a frame.
                const action = runtime.motionController?.current?.action;
                if (action) {
                    action.paused = false;
                    if (runtime.behavior?.current === 'mantling') {
                        action.time = Math.max(0, Math.min(1, nativeState?.progress || 0)) * action.getClip().duration;
                        action.setEffectiveTimeScale(0);
                    } else if (runtime.behavior?.current === 'climbing') {
                        action.time = (nativeState?.cycle || 0) * action.getClip().duration;
                        action.setEffectiveTimeScale(0);
                    }
                }
            }

            // 顺序很重要：撤销上一帧视线 -> 完成动作过渡 -> VMD/物理更新 -> Morph ->
            // 重新叠加视线 -> 渲染。交换顺序会导致头部偏移累积或被动作覆盖。
            runtime.lookAtController?.beforeAnimation();
            runtime.motionController?.beforeAnimationUpdate();
            runtime.helper?.update(delta);
            runtime.motionController?.afterAnimationUpdate(delta);

            if (runtime.model && !runtime.motionController?.has('idle')) {
                runtime.model.position.y = Math.sin(runtime.time * 1.5) * 0.15;
                runtime.model.rotation.y = Math.sin(runtime.time * 0.5) * 0.03;
                runtime.model.rotation.z = Math.sin(runtime.time * 0.7) * 0.01;
            }
            runtime.expressionController?.update(delta);
            if (['walking', 'climbing', 'dragging', 'falling'].includes(runtime.behavior?.current)) {
                runtime.lookAtController?.setTarget(0, runtime.behavior.current === 'climbing' ? -0.35 : 0);
            } else if (runtime.cursor && performance.now() - runtime.cursor.receivedAt < 350) {
                runtime.model?.updateMatrixWorld(true);
                runtime.lookAtController?.setPointerTarget(runtime.cursor.x, runtime.cursor.y, camera, container.clientWidth, container.clientHeight);
            }
            runtime.lookAtController?.update(delta);
            if (runtime.dragAnchor && runtime.handDrag?.target) runtime.handDrag.target = { x: runtime.dragAnchor.x, y: runtime.dragAnchor.y - container.getBoundingClientRect().top };
            runtime.handDrag?.update(delta, camera, container.clientWidth, container.clientHeight);
            toonPipeline.render(scene, camera);
        };
        animate();

        return () => {
            // React StrictMode、Vite HMR 和窗口关闭都会执行 cleanup；释放 timer、mixer、
            // GPU 资源和 WebGL context，避免重载后出现重复动画或 SharedImage 警告累积。
            disposed = true;
            cancelAnimationFrame(animationFrame);
            window.removeEventListener('resize', onResize);
            window.electronAPI?.setPetBusy?.(false);
            runtime.motionController?.dispose();
            runtime.expressionController?.dispose();
            runtime.lookAtController?.dispose();
            if (mesh && helper?.meshes.includes(mesh)) helper.remove(mesh);
            if (mesh) {
                scene.remove(mesh);
                disposeMesh(mesh);
            }
            renderer.renderLists.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
            if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
            if (sceneRef.current === runtime) sceneRef.current = null;
            if (window.__HYACINE_PET_DIAGNOSTICS__) delete window.__HYACINE_PET_DIAGNOSTICS__;
        };
    }, []);

    return (
        <div
            className={`pet-root ${speechHeadroom > 0 ? 'pet-root-with-speech' : ''}`}
            style={{ '--pet-speech-headroom': `${speechHeadroom}px` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onPointerEnter={() => setInteraction('hover', true)}
            onPointerLeave={() => setInteraction('hover', false)}
            onLostPointerCapture={handlePointerEnd}
            onContextMenu={event => { event.preventDefault(); window.electronAPI?.showPetMenu?.(); }}
            onDoubleClick={event => { if (!event.target.closest('[data-pet-controls]')) openConfig(); }}
        >
            <div ref={mountRef} className="pet-canvas" />
            <PetOverlay
                loading={loading}
                behaviorLabel={STATE_LABELS[behaviorState] || '待机'}
                windowState={windowState}
                error={error}
                speech={speech}
                showSizePanel={showSizePanel}
                petScale={petScaleDraft}
                onCloseSizePanel={closeSizePanel}
                onScaleChange={updatePetScaleDraft}
                onScaleCommit={commitPetScale}
                onScaleSelect={value => { updatePetScaleDraft({ target: { value } }); commitPetScale(); }}
                onSpeechHeightChange={updateSpeechHeight}
            />
        </div>
    );
}
