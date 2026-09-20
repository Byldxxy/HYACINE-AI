/** Small original in-place companion clips. External VMDs may override any semantic clip. */
import * as THREE from 'three';
import mantleProfile from './mantleProfile.json';

function mantleSample(side, t) {
    const samples = mantleProfile.samples, index = Math.min(samples.length - 1, Math.max(0, t) * (samples.length - 1));
    const a = samples[Math.floor(index)][side], b = samples[Math.min(samples.length - 1, Math.ceil(index))][side], blend = index % 1;
    return { hand: a.hand.map((v, i) => v + (b.hand[i] - v) * blend), foot: a.foot.map((v, i) => v + (b.foot[i] - v) * blend) };
}

const BONE = {
    upper: ['上半身', 'UpperBody'], head: ['頭', 'Head'], neck: ['首', 'Neck'],
    leftArm: ['左腕'], rightArm: ['右腕'], leftElbow: ['左ひじ'], rightElbow: ['右ひじ'],
    leftWrist: ['左手首'], rightWrist: ['右手首'], center: ['センター'],
    leftIK: ['左足ＩＫ', '左足IK'], rightIK: ['右足ＩＫ', '右足IK'],
};
const DURATION = { mantling: 1.6, pointerNotice: 0.65, pointerFocus: 4.8, clinging: 4.8, idle: 4.8, thinking: 4, speaking: 3.5, working: 3.5, attention: 1.3, greet: 3.3, tapHead: 2.2, tapBody: 1.8, error: 2.5, walking: 1.4, climbing: 1.8, falling: 1, dragging: 2, landing: 0.7 };

export function createCompanionMotions(mesh) {
    const bones = Object.fromEntries(Object.entries(BONE).map(([key, names]) => [key, mesh.skeleton.bones.find(b => names.includes(b.name))]));
    const height = Math.max(10, mesh.geometry.boundingBox?.max.y || 20);
    const scale = height / 20;
    mesh.updateMatrixWorld(true);
    const modelPoint = bone => mesh.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    const arms = {};
    for (const side of ['left', 'right']) {
        const arm = bones[`${side}Arm`], elbow = bones[`${side}Elbow`], wrist = bones[`${side}Wrist`];
        if (!arm || !elbow || !wrist) continue;
        const a = modelPoint(arm), e = modelPoint(elbow), w = modelPoint(wrist);
        arms[side] = { a, upper: e.clone().sub(a), lower: w.clone().sub(e), sign: side === 'left' ? 1 : -1 };
    }
    const solveArm = (side, target, pole) => {
        const rig = arms[side];
        if (!rig) return null;
        const axis = target.clone().sub(rig.a);
        const l1 = rig.upper.length(), l2 = rig.lower.length();
        const d = THREE.MathUtils.clamp(axis.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
        axis.normalize();
        const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
        const bend = pole.clone().sub(rig.a);
        bend.addScaledVector(axis, -bend.dot(axis)).normalize();
        const elbow = rig.a.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
        const upper = new THREE.Quaternion().setFromUnitVectors(rig.upper.clone().normalize(), elbow.clone().sub(rig.a).normalize());
        const lowerWorld = new THREE.Quaternion().setFromUnitVectors(rig.lower.clone().normalize(), rig.a.clone().addScaledVector(axis, d).sub(elbow).normalize());
        return { upper, lower: upper.clone().invert().multiply(lowerWorld) };
    };
    const result = {};
    for (const [name, duration] of Object.entries(DURATION)) {
        const tracks = [];
        const frames = 48;
        const times = Array.from({ length: frames + 1 }, (_, i) => i / frames * duration);
        const pose = (key, time) => {
            const phase = time / duration * Math.PI * 2;
            const pulse = Math.sin(phase);
            const envelope = Math.sin(Math.PI * time / duration) ** 2;
            // MMD A-pose arms lower toward the sides. All clips share this baseline.
            let v = key === 'leftArm' ? [0, 0, -0.48] : key === 'rightArm' ? [0, 0, 0.48] : [0, 0, 0];
            if (key === 'upper') v = [0.012 * pulse, 0, 0.008 * pulse];
            if (key === 'head') v = [0, 0, 0.016 * pulse];
            if (['thinking','working'].includes(name)) {
                if (key === 'head') v = [0.12, 0.06, -0.1];
                if (key === 'rightArm') v = [-0.35, -0.1, 0.55];
                if (key === 'rightElbow') v = [-1.6, 0.1, 0.25];
                if (key === 'rightWrist') v = [0, 0, -0.25];
            }
            if (name === 'speaking') {
                if (key === 'head') v = [0.035 * pulse, 0.04 * Math.sin(phase / 2) ** 2, 0];
                if (key === 'rightElbow') v = [-0.45 - 0.12 * pulse, 0, 0];
            }
            if (['greet','tapHead'].includes(name)) {
                if (key === 'head') v = [0.06 * envelope, 0, -0.12 * envelope];
                if (name === 'greet' && key === 'rightArm') v = [-0.15 * envelope, 0, 0.95 - 1.9 * envelope];
                if (name === 'greet' && key === 'rightElbow') v = [-0.8 * envelope, 0, 0];
                if (name === 'greet' && key === 'rightWrist') v = [0, 0.3 * Math.sin(phase * 3) * envelope, 0];
            }
            if (name === 'pointerNotice') {
                if (key === 'head') v = [-0.035 * envelope, 0, -0.045 * envelope];
                if (key === 'upper') v = [-0.014 * envelope, 0, 0];
            }
            if (name === 'pointerFocus') {
                if (key === 'head') v = [-0.015, 0, -0.025 + 0.008 * pulse];
                if (key === 'upper') v = [0.009 * pulse, 0, 0.003 * pulse];
                if (key === 'rightElbow') v = [-0.12 + 0.025 * pulse, 0, 0];
            }
            if (name === 'mantling') {
                const t = time / duration;
                if (key === 'upper') v = [0.5 * Math.sin(Math.PI * t), 0, 0];
                if (key === 'head') v = [-0.12 * (1 - t), 0, 0];
            }
            if (name === 'clinging') {
                if (key === 'head') v = [-0.04 + 0.01 * pulse, 0, 0];
                if (key === 'upper') v = [0.1 + 0.006 * pulse, 0, 0];
            }
            if (name === 'attention' && key === 'head') v = [-0.08 * envelope, 0.12 * envelope, 0];
            if (name === 'tapBody' && key === 'upper') v = [-0.08 * envelope, 0.06 * envelope, 0];
            if (name === 'error' && key === 'head') v = [0.1 * envelope, 0.13 * Math.sin(phase * 2) * envelope, 0];
            if (name === 'walking') {
                if (key === 'leftArm') v = [0.2 * pulse, 0, -0.48];
                if (key === 'rightArm') v = [-0.2 * pulse, 0, 0.48];
                if (key === 'upper') v = [0.035, 0.025 * pulse, 0];
            }
            if (name === 'climbing') {
                if (key === 'leftArm') v = [-0.8 - 0.2 * pulse, 0, 0.35];
                if (key === 'rightArm') v = [-0.8 + 0.2 * pulse, 0, -0.35];
                if (key === 'leftElbow') v = [-0.5 - 0.2 * pulse, 0, 0];
                if (key === 'rightElbow') v = [-0.5 + 0.2 * pulse, 0, 0];
                if (key === 'head') v = [-0.16, 0, 0];
                if (key === 'upper') v = [0.12, 0, 0.025 * pulse];
            }
            if (['falling','dragging'].includes(name)) {
                if (key === 'leftArm') v = [0, 0, -0.25];
                if (key === 'rightArm') v = [0, 0, 0.25];
                if (key === 'head') v = [0.1, 0, 0.03 * pulse];
            }
            if (name === 'landing' && key === 'upper') v = [0.16 * envelope, 0, 0];
            return v;
        };
        for (const [key, bone] of Object.entries(bones)) {
            if (!bone || ['center','leftIK','rightIK'].includes(key)) continue;
            const values = times.flatMap(time => {
                const side = key.startsWith('left') ? 'left' : key.startsWith('right') ? 'right' : null;
                if (side && arms[side] && (key.endsWith('Arm') || key.endsWith('Elbow')) && (['climbing', 'clinging', 'mantling'].includes(name) || (name === 'dragging' && side === 'right') || (['thinking', 'working'].includes(name) && side === 'right'))) {
                    const rig = arms[side];
                    const cycle = (time / duration + (side === 'right' ? 0.5 : 0)) % 1;
                    const gripY = cycle < 0.65 ? 3.8 - 4 * cycle / 0.65 : -0.2 + 4 * (0.5 - 0.5 * Math.cos(Math.PI * (cycle - 0.65) / 0.35));
                    const sample = mantleSample(side, time / duration), influence = Math.sin(Math.PI * time / duration) ** 2;
                    const target = name === 'dragging'
                        ? rig.a.clone().add(new THREE.Vector3(-0.3 * scale, (rig.upper.length() + rig.lower.length()) * 0.98, 0.1 * scale))
                        : name === 'mantling'
                            ? rig.a.clone().add(new THREE.Vector3(rig.sign * (0.5 + sample.hand[0] * influence) * scale, (2.2 - 5.5 * time / duration + sample.hand[1] * influence) * scale, (1.8 + sample.hand[2] * influence) * scale))
                        : ['climbing', 'clinging'].includes(name)
                        ? rig.a.clone().add(new THREE.Vector3(rig.sign * 0.2 * scale, (name === 'clinging' ? 2.4 : gripY) * scale, 2.0 * scale))
                        : (bones.head ? modelPoint(bones.head) : rig.a.clone().add(new THREE.Vector3(0, 1.2 * scale, 0))).add(new THREE.Vector3(-0.5 * scale, -0.9 * scale, 0.9 * scale));
                    const pole = rig.a.clone().add(new THREE.Vector3(rig.sign * 1.7 * scale, -2 * scale, 1.2 * scale));
                    const solved = solveArm(side, target, pole);
                    return (key.endsWith('Arm') ? solved.upper : solved.lower).toArray();
                }
                return new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose(key, time), 'XYZ')).toArray();
            });
            tracks.push(new THREE.QuaternionKeyframeTrack(`.bones[${bone.name}].quaternion`, times, values));
        }
        for (const key of ['center','leftIK','rightIK']) {
            const bone = bones[key]; if (!bone) continue;
            const values = times.flatMap(time => {
                const phase = time / duration * 2 * Math.PI + (key === 'rightIK' ? Math.PI : 0);
                const position = bone.position.clone();
                if (key === 'center') {
                    position.y += name === 'walking' ? Math.sin(phase * 2) * 0.12 * scale : name === 'landing' ? -0.6 * Math.sin(Math.PI * time / duration) ** 2 * scale : 0;
                } else if (name === 'mantling') {
                    const t = time / duration, lift = Math.sin(Math.PI * t) ** 2;
                    const sample = mantleSample(key === 'leftIK' ? 'left' : 'right', t);
                    position.y += lift * (0.8 + Math.max(0, 1 + sample.foot[0]) * 4.5) * scale;
                    position.z += lift * (0.5 + sample.foot[1] * 2) * scale;
                } else if (name === 'dragging') {
                    position.y += (key === 'leftIK' ? 0.8 : 0.3) * scale;
                    position.z += 0.4 * scale;
                } else if (name === 'clinging') {
                    position.y += 0.8 * scale;
                    position.z += 0.35 * scale;
                } else if (['walking','climbing'].includes(name)) {
                    position.y += Math.max(0, Math.sin(phase)) * (name === 'climbing' ? 2.3 : 0.65) * scale;
                    position.z += Math.cos(phase) * (name === 'climbing' ? 0.5 : 1.05) * scale;
                }
                return position.toArray();
            });
            tracks.push(new THREE.VectorKeyframeTrack(`.bones[${bone.name}].position`, times, values));
        }
        const loop = !['mantling', 'pointerNotice', 'attention','greet','tapHead','tapBody','error','landing'].includes(name);
        result[name] = { clip: new THREE.AnimationClip(name, duration, tracks), definition: { loop, fadeIn: 0.4, fadeOut: 0.4, priority: 0 }, source: 'built-in' };
    }
    return result;
}
