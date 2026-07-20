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
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { API_BASE_URL } from '../lib/api';
import { DEFAULT_PET_MANIFEST, loadPetManifest } from './config/petManifest';
import { usePetEvents } from './hooks/usePetEvents';
import { ExpressionController } from './runtime/ExpressionController';
import { loadManifestMotions } from './runtime/loadMotions';
import { LookAtController } from './runtime/LookAtController';
import { inspectMmdModel } from './runtime/modelDiagnostics';
import { MotionController } from './runtime/MotionController';
import PetOverlay from './ui/PetOverlay';

const BASE_WIDTH = 250;
const BASE_HEIGHT = 400;
const MIN_SPEECH_HEADROOM = 64;
const MAX_SPEECH_HEADROOM = 500;
const MAX_RENDERED_SPEECH_LENGTH = 1000;
const PET_SCALE_KEY = 'hyacine-pet-scale';

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
    const [showMenu, setShowMenu] = useState(false);
    const [passthrough, setPassthrough] = useState(false);
    const [petScale, setPetScale] = useState(loadPetScale);
    const [petScaleDraft, setPetScaleDraft] = useState(loadPetScale);
    const [speech, setSpeech] = useState('');
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

    const triggerDefinition = useCallback((definition, kind = 'event', detail = {}) => {
        // definition 来自 manifest；动作和表情互相独立，缺少其一时另一项仍可执行。
        const state = sceneRef.current;
        if (!state || !definition) return;
        if (definition.motion) {
            state.motionController?.play(definition.motion, {
                kind,
                priority: definition.priority,
                cooldown: definition.cooldown,
                duration: detail.duration,
            });
        }
        if (definition.expression) {
            state.expressionController?.play(definition.expression, {
                duration: Number(detail.duration) || Number(definition.duration) || 1.2,
            });
        }
    }, []);

    const handlePetEvent = useCallback((event, detail) => {
        // 后端只发 attention/desktopComment 等语义，不知道具体 VMD/Morph 名称。
        // desktopComment 缺少专用映射时回退 speaking，保持旧 manifest 兼容。
        const state = sceneRef.current;
        const definition = event === 'desktopComment'
            ? state?.manifest?.events?.desktopComment || state?.manifest?.events?.speaking
            : state?.manifest?.events?.[event];
        triggerDefinition(definition, event === 'error' ? 'system' : 'event', detail);
        if (event === 'speaking' || event === 'desktopComment') {
            state?.expressionController?.speak(Number(detail.duration) || 1.5);
        }
        if (event === 'desktopComment' && detail.text) {
            const duration = Math.max(4, Math.min(12, Number(detail.duration) || 6));
            showSpeech(detail.text, duration);
        }
    }, [showSpeech, triggerDefinition]);

    usePetEvents(handlePetEvent);

    useEffect(() => {
        try {
            localStorage.setItem(PET_SCALE_KEY, String(petScale));
        } catch {
            // Keep the current size when storage is unavailable.
        }
        // 高度包含 speechHeadroom，并要求主进程固定底边，角色脚部不会随气泡上下跳动。
        window.electronAPI?.resizePetWindow?.(
            BASE_WIDTH * petScale,
            BASE_HEIGHT * petScale + speechHeadroom,
            true
        );
    }, [petScale, speechHeadroom]);

    useEffect(() => {
        const unsubscribe = window.electronAPI?.onPassthroughChanged?.(setPassthrough);
        return () => unsubscribe?.();
    }, []);

    useEffect(() => {
        const unsubscribe = window.electronAPI?.onGlobalCursorMoved?.(({ x, y, windowBounds }) => {
            const state = sceneRef.current;
            const container = mountRef.current;
            if (!state || !container || !windowBounds) return;
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const localX = x - windowBounds.x - rect.left;
            const localY = y - windowBounds.y - rect.top;
            const normalizedX = (localX / rect.width) * 2 - 1;
            const normalizedY = (localY / rect.height) * 2 - 1;
            state.lookAtController?.setTarget(normalizedX, normalizedY);
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

    const handleMouseMove = useCallback((event) => {
        const state = sceneRef.current;
        if (!state) return;
        const rect = mountRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        state.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        state.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        if (state.isDragging && window.electronAPI) {
            // 原生无边框窗口不能依赖系统标题栏拖动，通过 preload 把屏幕坐标交给主进程。
            window.electronAPI.dragMove(event.screenX, event.screenY);
            return;
        }

        // Raycaster 决定本次按下是模型点击互动还是空白区域拖动窗口。
        state.raycaster.setFromCamera(state.mouse, state.camera);
        const intersection = state.model
            ? state.raycaster.intersectObject(state.model, true)[0]
            : null;
        state.isHovering = Boolean(intersection);
        state.hoverRegion = intersection ? getHitRegion(state.model, intersection.point) : null;
        event.currentTarget.style.cursor = state.isHovering ? 'pointer' : 'grab';
    }, []);

    const handleMouseDown = useCallback((event) => {
        if (event.button !== 0) return;
        setShowMenu(false);
        const state = sceneRef.current;
        if (!state || state.isHovering) return;
        state.isDragging = true;
        event.currentTarget.style.cursor = 'grabbing';
        window.electronAPI?.dragStart?.(event.screenX, event.screenY);
    }, []);

    const endDrag = useCallback(() => {
        const state = sceneRef.current;
        if (!state?.isDragging) return;
        state.isDragging = false;
        window.electronAPI?.dragEnd?.();
    }, []);

    const handleClick = useCallback(() => {
        setShowMenu(false);
        const state = sceneRef.current;
        if (!state?.isHovering || !state.hoverRegion) return;
        triggerDefinition(state.manifest?.interactions?.[state.hoverRegion], 'reaction');
    }, [triggerDefinition]);

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
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        container.appendChild(renderer.domElement);

        const outlineEffect = new OutlineEffect(renderer, {
            defaultThickness: 0.003,
            defaultColor: [0.2, 0.15, 0.15],
            defaultAlpha: 0.8,
        });
        scene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const mainLight = new THREE.DirectionalLight(0xffffff, 1);
        mainLight.position.set(2, 5, 8);
        scene.add(mainLight);

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
            helper = new MMDAnimationHelper({ afterglow: 2, sync: false });
            runtime.helper = helper;

            const loader = new MMDLoader();
            mesh = await loadModel(loader, runtime.manifest.model);
            if (disposed) { disposeMesh(mesh); return; }
            runtime.model = mesh;
            mesh.scale.setScalar(1.2);
            mesh.geometry.computeBoundingBox();
            scene.add(mesh);

            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.filter(Boolean).forEach(material => {
                if (!material.isMeshToonMaterial) return;
                material.alphaToCoverage = true;
                material.depthWrite = true;
                material.color.multiplyScalar(1.3);
                material.emissive = material.color.clone();
                material.emissiveIntensity = 0.6;
            });

            // 动作属于可选能力，部分加载失败只记录诊断，不让整个模型初始化失败。
            const { motions, errors: motionErrors } = await loadManifestMotions(loader, mesh, runtime.manifest.motions);
            if (disposed) return;
            motionErrors.forEach(item => console.warn(`[Pet] Motion failed: ${item.name} (${item.file})`, item.message));
            const clips = Object.values(motions).map(item => item.clip);
            helper.add(mesh, {
                animation: clips.length > 0 ? clips : undefined,
                physics: hasPhysics,
            });

            runtime.motionController = new MotionController({ helper, mesh, motions });
            runtime.expressionController = new ExpressionController(mesh, runtime.manifest.expressions);
            runtime.lookAtController = new LookAtController(mesh, runtime.manifest.bones);
            runtime.capabilities = inspectMmdModel(mesh, runtime.manifest, hasPhysics);
            runtime.motionController.play('idle', { force: true, loop: true });
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
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
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
                    nonTransparentPixels,
                    coverage: nonTransparentPixels / Math.max(1, width * height),
                    modelLoaded: Boolean(runtime.model),
                    motion: runtime.motionController?.state || 'loading',
                    expressions: runtime.expressionController?.snapshot() || null,
                    capabilities: runtime.capabilities || null,
                };
            };
        }
        const animate = () => {
            animationFrame = requestAnimationFrame(animate);
            const delta = Math.min(clock.getDelta(), 0.05);
            if (document.hidden) return;
            runtime.time += delta;

            // 顺序很重要：撤销上一帧视线 -> VMD/物理更新 -> fallback 待机 -> Morph ->
            // 重新叠加视线 -> 渲染。交换顺序会导致头部偏移累积或被动作覆盖。
            runtime.lookAtController?.beforeAnimation();
            runtime.helper?.update(delta);

            if (runtime.model && !runtime.motionController?.has('idle')) {
                runtime.model.position.y = Math.sin(runtime.time * 1.5) * 0.15;
                runtime.model.rotation.y = Math.sin(runtime.time * 0.5) * 0.03;
                runtime.model.rotation.z = Math.sin(runtime.time * 0.7) * 0.01;
            }
            runtime.expressionController?.update(delta);
            runtime.lookAtController?.update(delta);
            outlineEffect.render(scene, camera);
        };
        animate();

        return () => {
            // React StrictMode、Vite HMR 和窗口关闭都会执行 cleanup；释放 timer、mixer、
            // GPU 资源和 WebGL context，避免重载后出现重复动画或 SharedImage 警告累积。
            disposed = true;
            cancelAnimationFrame(animationFrame);
            window.removeEventListener('resize', onResize);
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
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onContextMenu={(event) => { event.preventDefault(); setShowMenu(true); }}
            onClick={handleClick}
            onDoubleClick={openConfig}
        >
            <div ref={mountRef} className="pet-canvas" />
            <PetOverlay
                loading={loading}
                error={error}
                speech={speech}
                showMenu={showMenu}
                passthrough={passthrough}
                petScale={petScaleDraft}
                onCloseMenu={() => setShowMenu(false)}
                onOpenConfig={openConfig}
                onTogglePassthrough={() => window.electronAPI?.togglePassthrough?.()}
                onScaleChange={updatePetScaleDraft}
                onScaleCommit={commitPetScale}
                onSpeechHeightChange={updateSpeechHeight}
                onTestDesktopAwareness={testDesktopAwareness}
            />
        </div>
    );
}
