/**
 * 头部和眼睛的视线跟随控制器。
 *
 * 输入是相对桌宠窗口归一化后的全局鼠标位置。MMDAnimationHelper 每帧会重写骨骼姿态，
 * 因此渲染循环必须先调用 beforeAnimation 撤销上一帧偏移，更新 VMD，再调用 update
 * 叠加新的视线四元数；否则偏移会逐帧累积并与动作互相污染。
 */
import * as THREE from 'three';

function findBones(skeleton, candidates = []) {
    if (!skeleton) return [];
    return skeleton.bones.filter(bone => candidates.some(candidate => bone.name === candidate));
}

export class LookAtController {
    constructor(mesh, boneMap = {}) {
        this.head = findBones(mesh.skeleton, boneMap.head)[0] || null;
        this.eyes = findBones(mesh.skeleton, boneMap.eyes);
        this.targetX = 0;
        this.targetY = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.applied = new Map();
    }

    setTarget(normalizedX, normalizedY) {
        // 屏幕水平移动对应骨骼 Y 轴旋转，屏幕垂直移动对应骨骼 X 轴旋转。
        this.targetY = THREE.MathUtils.clamp(normalizedX * 0.45, -0.45, 0.45);
        this.targetX = THREE.MathUtils.clamp(normalizedY * 0.2, -0.2, 0.2);
    }

    beforeAnimation() {
        this.applied.forEach((offset, bone) => {
            bone.quaternion.multiply(offset.clone().invert());
        });
        this.applied.clear();
    }

    applyOffset(bone, x, y) {
        if (!bone) return;
        const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, 0, 'YXZ'));
        bone.quaternion.multiply(offset);
        this.applied.set(bone, offset);
    }

    update(delta) {
        // 指数平滑与帧率无关，比固定 lerp 系数在高低刷新率下更一致。
        const smoothing = 1 - Math.exp(-5 * delta);
        this.currentX += (this.targetX - this.currentX) * smoothing;
        this.currentY += (this.targetY - this.currentY) * smoothing;
        this.applyOffset(this.head, this.currentX, this.currentY);
        this.eyes.forEach(bone => this.applyOffset(bone, this.currentX * 0.5, this.currentY * 0.5));
    }

    dispose() {
        this.beforeAnimation();
    }
}
