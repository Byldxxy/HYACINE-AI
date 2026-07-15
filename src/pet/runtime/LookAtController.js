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
