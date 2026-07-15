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
const PET_SCALE_KEY = 'hyacine-pet-scale';

function loadPetScale() {
    try {
        const value = Number(localStorage.getItem(PET_SCALE_KEY));
        return Number.isFinite(value) && value >= 0.5 && value <= 2.5 ? value : 1;
    } catch {
        return 1;
    }
}

function estimateSpeechHeadroom(text) {
    const lines = Math.max(1, Math.ceil(String(text || '').length / 14));
    return Math.min(200, Math.max(MIN_SPEECH_HEADROOM, 34 + lines * 21));
}

function loadModel(loader, path) {
    return fetch(path, { method: 'HEAD' }).then(response => {
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || contentType.includes('text/html')) {
            throw new Error(`未找到模型文件: ${path}`);
        }
        return new Promise((resolve, reject) => loader.load(path, resolve, undefined, reject));
    });
}

function getHitRegion(mesh, point) {
    const box = mesh.geometry.boundingBox;
    if (!box) return 'body';
    const localPoint = mesh.worldToLocal(point.clone());
    const height = Math.max(0.001, box.max.y - box.min.y);
    return (localPoint.y - box.min.y) / height >= 0.72 ? 'head' : 'body';
}

function disposeMesh(mesh) {
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
        const message = String(text || '').trim().slice(0, 180);
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
        const nextHeight = Math.min(200, Math.max(MIN_SPEECH_HEADROOM, Math.ceil(Number(height) || 0)));
        setSpeechHeadroom(previous => Math.abs(previous - nextHeight) > 1 ? nextHeight : previous);
    }, []);

    const triggerDefinition = useCallback((definition, kind = 'event', detail = {}) => {
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
        const nextScale = Number(event.target.value);
        petScaleDraftRef.current = nextScale;
        setPetScaleDraft(nextScale);
    }, []);

    const commitPetScale = useCallback(() => {
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
            window.electronAPI.dragMove(event.screenX, event.screenY);
            return;
        }

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
