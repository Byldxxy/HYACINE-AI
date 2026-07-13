// src/pet/PetScene.jsx - Three.js MMD 桌宠场景
import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { API_BASE_URL } from '../lib/api';

const MODEL_PATH = '/models/desktop-pet.pmx';

export default function PetScene() {
    const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showMenu, setShowMenu] = useState(false);
    const [passthrough, setPassthrough] = useState(false);
    const [petScale, setPetScale] = useState(1.0);

    const BASE_W = 250;
    const BASE_H = 400;

    const handleScaleChange = useCallback((e) => {
        const val = parseFloat(e.target.value);
        setPetScale(val);
        if (window.electronAPI?.resizePetWindow) {
            window.electronAPI.resizePetWindow(BASE_W * val, BASE_H * val);
        }
    }, []);

    // 监听穿透模式变化
    useEffect(() => {
        if (window.electronAPI?.onPassthroughChanged) {
            window.electronAPI.onPassthroughChanged((val) => setPassthrough(val));
        }
    }, []);

    // ============ 交互事件（React 合成事件） ============
    const handleMouseMove = useCallback((e) => {
        const s = sceneRef.current;
        if (!s) return;
        const rect = e.currentTarget.getBoundingClientRect();
        s.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        s.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        s.targetHeadRotY = s.mouse.x * 0.45;
        s.targetHeadRotX = s.mouse.y * 0.2;

        if (s.isDragging && window.electronAPI) {
            window.electronAPI.dragMove(e.screenX, e.screenY);
            return;
        }

        s.raycaster.setFromCamera(s.mouse, s.camera);
        if (s.model && !s.isDragging) {
            const intersects = s.raycaster.intersectObject(s.model, true);
            const wasHovering = s.isHovering;
            s.isHovering = intersects.length > 0;
            if (s.isHovering !== wasHovering) {
                e.currentTarget.style.cursor = s.isHovering ? 'pointer' : 'grab';
            }
        }
    }, []);

    const handleMouseDown = useCallback((e) => {
        // 【修复1】只要是鼠标左键按下（不论点在空白还是模型上），立刻关闭右键菜单
        // 这样可以防止被原生的 dragStart 劫持导致 click 无法触发
        if (e.button === 0) {
            setShowMenu(false);
        }

        const s = sceneRef.current;
        if (!s || e.button !== 0) return;
        
        if (!s.isHovering) {
            s.isDragging = true;
            e.currentTarget.style.cursor = 'grabbing';
            if (window.electronAPI) {
                window.electronAPI.dragStart(e.screenX, e.screenY);
            }
        }
    }, []);

    const handleMouseUp = useCallback(() => {
        const s = sceneRef.current;
        if (!s) return;
        if (s.isDragging) {
            s.isDragging = false;
            if (window.electronAPI) {
                window.electronAPI.dragEnd();
            }
        }
    }, []);

    const handleContextMenu = useCallback((e) => {
        e.preventDefault();
        // 【修复2】明确设为 true，而非 prev => !prev，避免左右键快速切换时状态错乱
        setShowMenu(true); 
    }, []);

    const handleClick = useCallback(() => {
        // 兜底的点击关闭（对于不触发拖拽的情况）
        setShowMenu(false);
    }, []);

    const handleDblClick = useCallback(() => {
        if (window.electronAPI) {
            window.electronAPI.openConfig();
        }
    }, []);

    // ============ Three.js 初始化（仅渲染，不含交互事件） ============
    useEffect(() => {
        const container = mountRef.current;
        if (!container) return;

        const scene = new THREE.Scene();
        scene.background = null;

        const camera = new THREE.PerspectiveCamera(
            30, container.clientWidth / container.clientHeight, 0.1, 200
        );
        camera.position.set(0, 10, 55);
        camera.lookAt(0, 10, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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

        // 找到你刚刚改过的那两盏灯，替换成下面这样：

        // 1. 环境光：直接拉高到 1.2（或者 1.5），这是消灭死灰色的主力军
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.2); 
        scene.add(ambientLight);

        // 2. 主方向光：增强到 1.0，稍微拉高拉远一点，让脸部受光更均匀
        const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
        mainLight.position.set(2, 5, 8); // 从右前上方打光
        scene.add(mainLight);
        

        const state = {
            model: null,
            mouse: new THREE.Vector2(0, 0),
            targetHeadRotY: 0, targetHeadRotX: 0,
            currentHeadRotY: 0, currentHeadRotX: 0,
            isHovering: false,
            isDragging: false,
            time: 0,
            helper: null,
            blinkTimer: 0, blinkState: 0,
            nextBlink: 3 + Math.random() * 4,
            camera,
            raycaster: new THREE.Raycaster(),
        };
        sceneRef.current = state;

        let helper = null;
        let hasPhysics = false;
        const initHelper = async () => {
            try {
                if (typeof window.Ammo === 'function') {
                    const ammo = await window.Ammo();
                    helper = new MMDAnimationHelper({ afterglow: 2.0, ammo });
                    hasPhysics = true;
                } else { throw new Error('Ammo not found'); }
            } catch (_e) {
                helper = new MMDAnimationHelper({ afterglow: 2.0 });
            }
            state.helper = helper;
            return helper;
        };

        const loader = new MMDLoader();
        const loadModel = (path) => new Promise((resolve, reject) => {
            loader.load(path, resolve, undefined, reject);
        });

        initHelper().then((h) => {
            helper = h;
            loadModel(MODEL_PATH).then((mesh) => {
                state.model = mesh;
                mesh.scale.set(1.2, 1.2, 1.2);
                scene.add(mesh);
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(mat => { 
                        if (mat.isMeshToonMaterial) {
                            mat.alphaToCoverage = true; 
                            mat.depthWrite = true;
                            
                            // 1. 【核心突破】直接把材质的基础颜色/贴图亮度放大 1.3 倍（觉得不够可以改成 1.5）
                            // 这能强行洗掉由于模型本身导出的“内嵌暗色”
                            mat.color.multiplyScalar(1.3); 
                            
                            // 2. 【强力自发光】将自发光颜色设为放大后的颜色
                            mat.emissive = mat.color.clone(); 
                            
                            // 3. 【打破限制】直接把自发光强度拉到 0.6 或 0.8（最高可以去到 1.5+）
                            // 自发光越高，背光面的灰色阴影就会越少，人就会越白皙通透
                            mat.emissiveIntensity = 0.6; 
                        }
                    });
                }
                helper.add(mesh, { animation: [], physics: hasPhysics });
                setLoading(false);
            }).catch((err) => {
                setError('模型加载失败: ' + (err.message || err));
                setLoading(false);
            });
        });

        const onResize = () => {
            const w = container.clientWidth, h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener('resize', onResize);

        let animFrameId;
        const clock = new THREE.Clock();
        const animate = () => {
            animFrameId = requestAnimationFrame(animate);
            const delta = clock.getDelta();
            state.time += delta;

            if (state.model) {
                state.model.position.y = Math.sin(state.time * 1.5) * 0.15;
                state.model.rotation.y = Math.sin(state.time * 0.5) * 0.03;
                state.model.rotation.z = Math.sin(state.time * 0.7) * 0.01;

                state.currentHeadRotY += (state.targetHeadRotY - state.currentHeadRotY) * 3 * delta;
                state.currentHeadRotX += (state.targetHeadRotX - state.currentHeadRotX) * 3 * delta;

                const skeleton = state.model.skeleton;
                if (skeleton) {
                    const headBone = skeleton.bones.find(b => b.name === '頭' || b.name === 'Head' || b.name.includes('頭'));
                    if (headBone) { headBone.rotation.y = state.currentHeadRotY; headBone.rotation.x = state.currentHeadRotX; }

                    skeleton.bones.filter(b => b.name === '両目' || b.name === 'Eyes' || b.name.includes('目'))
                        .forEach(bone => { bone.rotation.y = state.currentHeadRotY * 0.5; bone.rotation.x = state.currentHeadRotX * 0.5; });

                    state.blinkTimer += delta;
                    if (state.blinkState === 0 && state.blinkTimer >= state.nextBlink) { state.blinkState = 1; state.blinkTimer = 0; }
                    const morphDict = state.model.morphTargetDictionary;
                    if (morphDict && (morphDict['まばたき'] !== undefined || morphDict['blink'] !== undefined)) {
                        const blinkIdx = morphDict['まばたき'] ?? morphDict['blink'];
                        let blinkVal = 0;
                        if (state.blinkState === 1) { blinkVal = Math.min(state.blinkTimer / 0.05, 1); if (blinkVal >= 1) { state.blinkState = 2; state.blinkTimer = 0; } }
                        else if (state.blinkState === 2) { blinkVal = 1; if (state.blinkTimer >= 0.05) { state.blinkState = 3; state.blinkTimer = 0; } }
                        else if (state.blinkState === 3) { blinkVal = 1 - Math.min(state.blinkTimer / 0.08, 1); if (blinkVal <= 0) { state.blinkState = 0; state.blinkTimer = 0; state.nextBlink = 2 + Math.random() * 5; } }
                        state.model.morphTargetInfluences[blinkIdx] = blinkVal;
                    }
                }
            }

            if (state.helper) state.helper.update(delta);
            outlineEffect.render(scene, camera);
        };
        animate();

        return () => {
            cancelAnimationFrame(animFrameId);
            window.removeEventListener('resize', onResize);
            renderer.dispose();
            if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
        };
    }, []);

    // ============ JSX：Three.js 画布 + UI 层平级 ============
    return (
        <div
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onContextMenu={handleContextMenu}
            onClick={handleClick}
            onDoubleClick={handleDblClick}
            style={{ width: '100%', height: '100%', background: 'transparent', position: 'relative' }}
        >
            <div ref={mountRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />

            {loading && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#ff69b4', fontSize: '14px', fontFamily: 'sans-serif', textShadow: '0 0 10px rgba(255,105,180,0.5)', zIndex: 500 }}>
                    ✨ 加载中...
                </div>
            )}

            {error && (
                <div style={{ position: 'absolute', top: '10px', left: '10px', right: '10px', color: '#ff4444', fontSize: '12px', fontFamily: 'monospace', background: 'rgba(0,0,0,0.7)', padding: '8px', borderRadius: '4px', zIndex: 500 }}>
                    {error}
                </div>
            )}

            {showMenu && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute', top: '50%', left: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: 'rgba(255,255,255,0.95)',
                        backdropFilter: 'blur(10px)',
                        borderRadius: '12px', padding: '4px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                        minWidth: '180px', zIndex: 1000,
                        fontFamily: 'sans-serif',
                    }}
                >
                    <div
                        style={{ padding: '10px 16px', cursor: 'pointer', fontSize: '13px', color: '#333', borderRadius: '8px' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,105,180,0.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        onClick={() => {
                            setShowMenu(false);
                            if (window.electronAPI) {
                                window.electronAPI.openConfig();
                            } else {
                                window.open(API_BASE_URL);
                            }
                        }}
                    >
                        🔧 打开配置面板
                    </div>

                    <div
                        style={{ padding: '10px 16px', cursor: 'pointer', fontSize: '13px', color: '#333', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,105,180,0.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        onClick={() => {
                            setShowMenu(false);
                            if (window.electronAPI) {
                                window.electronAPI.togglePassthrough();
                            }
                        }}
                    >
                        <span>🔓 穿透模式</span>
                        <span style={{
                            display: 'inline-block', width: '16px', height: '16px',
                            borderRadius: '3px', border: '2px solid #999',
                            background: passthrough ? '#ff69b4' : 'transparent',
                            textAlign: 'center', lineHeight: '14px', fontSize: '12px',
                            color: '#fff', marginLeft: '8px',
                        }}>
                            {passthrough ? '✓' : ''}
                        </span>
                    </div>
                </div>
            )}

            {/* 缩放控件 */}
            <div
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()}
                style={{
                    position: 'absolute',
                    bottom: '8px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(0,0,0,0.45)',
                    backdropFilter: 'blur(6px)',
                    borderRadius: '12px',
                    padding: '4px 10px',
                    zIndex: 800,
                    fontFamily: 'sans-serif',
                    userSelect: 'none',
                }}
            >
                <span style={{ color: '#fff', fontSize: '11px', opacity: 0.8 }}>−</span>
                <input
                    type="range"
                    min="0.5"
                    max="2.5"
                    step="0.1"
                    value={petScale}
                    onChange={handleScaleChange}
                    style={{
                        width: '80px',
                        height: '4px',
                        cursor: 'pointer',
                        accentColor: '#ff69b4',
                    }}
                />
                <span style={{ color: '#fff', fontSize: '11px', opacity: 0.8 }}>+</span>
                <span style={{ color: '#ff69b4', fontSize: '10px', minWidth: '28px', textAlign: 'right' }}>
                    {Math.round(petScale * 100)}%
                </span>
            </div>
        </div>
    );
}
