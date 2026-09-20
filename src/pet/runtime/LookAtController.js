/** 近距离视线跟随：在 MMD 求解后驱动实际眼骨，并在下帧前还原输入姿态。 */
import * as THREE from 'three';

export class LookAtController {
    constructor(mesh, boneMap = {}) {
        const bones = mesh.skeleton?.bones || [];
        const find = names => bones.filter(b => names?.includes(b.name));
        this.head = find(boneMap.head)[0] || null;
        const configuredEyes = find(boneMap.eyes);
        const grants = mesh.geometry?.userData?.MMD?.grants || [];
        // PMX「両目」通常通过 grant 驱动左右眼，不是其骨骼父节点。
        const grantedEyes = grants.filter(g => g.affectRotation && configuredEyes.includes(bones[g.parentIndex])).map(g => bones[g.index]);
        this.eyes = [...new Set(grantedEyes.length ? grantedEyes : configuredEyes.length ? configuredEyes : find(['左目', '右目', 'LeftEye', 'RightEye']))];
        this.eyeGrants = grants.filter(g => g.affectRotation && this.eyes.includes(bones[g.parentIndex]))
            .map(g => ({ bone: bones[g.index], ratio: g.ratio }));
        this.neutral = new Map([...this.eyes, ...this.eyeGrants.map(g => g.bone)].map(b => [b, b.quaternion.clone()]));
        this.targetX = this.targetY = this.currentX = this.currentY = 0;
        this.targetAge = Infinity;
        this.basePose = new Map();
        this.offset = new THREE.Quaternion();
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.origin = new THREE.Vector3();
        this.scratch = new THREE.Vector3();
    }

    setTarget(x, y) {
        this.targetY = Number.isFinite(x) ? THREE.MathUtils.clamp(x, -1, 1) : 0;
        this.targetX = Number.isFinite(y) ? THREE.MathUtils.clamp(y, -1, 1) : 0;
        this.targetAge = 0;
    }

    setPointerTarget(x, y, camera, width, height) {
        if (!(width > 0 && height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) { this.setTarget(0, 0); return; }
        // 以真实双眼投影为中心，而不是画布中央；窗口缩放/气泡留白不改变正视位置。
        this.origin.set(0, 0, 0);
        const anchors = this.eyes.length ? this.eyes : this.head ? [this.head] : [];
        for (const bone of anchors) this.origin.add(bone.getWorldPosition(this.scratch));
        if (!anchors.length) { this.setTarget(0, 0); return; }
        this.origin.divideScalar(anchors.length).project(camera);
        const dx = (x - (this.origin.x + 1) * width / 2) / (width * 0.85);
        const dy = (y - (1 - this.origin.y) * height / 2) / (height * 0.4);
        const distance = Math.hypot(dx, dy);
        const attention = 1 - THREE.MathUtils.smoothstep(distance, 0.85, 1.35);
        const deadzone = v => Math.sign(v) * Math.max(0, Math.abs(v) - 0.07);
        this.setTarget(deadzone(dx) * attention, deadzone(dy) * attention);
    }

    beforeAnimation() {
        // 还原保存的原姿态，不做逆乘：mixer/solver 可能已经重写了同一个骨骼。
        for (const [bone, quaternion] of this.basePose) bone.quaternion.copy(quaternion);
        this.basePose.clear();
    }

    apply(bone, x, y, neutral = false) {
        if (!bone) return;
        this.basePose.set(bone, bone.quaternion.clone());
        this.offset.setFromEuler(this.euler.set(x, y, 0, 'YXZ'));
        if (neutral) bone.quaternion.copy(this.neutral.get(bone));
        bone.quaternion.multiply(this.offset);
    }

    update(delta) {
        this.targetAge += Math.max(0, delta);
        if (this.targetAge > 0.4) this.targetX = this.targetY = 0;
        const smoothing = 1 - Math.exp(-7 * Math.max(0, delta));
        this.currentX += (this.targetX - this.currentX) * smoothing;
        this.currentY += (this.targetY - this.currentY) * smoothing;
        this.apply(this.head, this.currentX * 0.10, this.currentY * 0.16);
        // 眼睛由桌宠视线独占，VMD 残留 gaze 不成为下一帧的中立值。
        this.eyes.forEach(bone => this.apply(bone, this.currentX * 0.075, this.currentY * 0.12, true));
        // 风堇还有「目先」-0.7 倍补偿骨；与左右眼同帧更新，不能再等一次 helper 求解。
        this.eyeGrants.forEach(({ bone, ratio }) => this.apply(bone, this.currentX * 0.075 * ratio, this.currentY * 0.12 * ratio, true));
    }

    snapshot() {
        return { target: [this.targetY, this.targetX], current: [this.currentY, this.currentX], eyes: this.eyes.map(b => ({ name: b.name, quaternion: b.quaternion.toArray() })) };
    }

    dispose() { this.beforeAnimation(); }
}
