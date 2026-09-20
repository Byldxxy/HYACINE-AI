/**
 * 并行加载 manifest 中声明的 VMD 文件。
 *
 * 使用 Promise.allSettled 是有意的降级策略：某个动作缺失时返回 errors 供控制台诊断，
 * 其他成功动作仍可使用，模型本身也不会因为可选动作失败而无法显示。
 */
import * as THREE from 'three';

function loadAnimation(loader, file, mesh) {
    return new Promise((resolve, reject) => {
        loader.loadAnimation(file, mesh, resolve, undefined, reject);
    });
}

function getSolverOwnedBoneNames(mesh) {
    const bones = mesh.geometry?.userData?.MMD?.bones || [];
    return new Set(bones
        .filter(bone => bone.grant || bone.rigidBodyType > 0)
        .map(bone => bone.name));
}

export function removeSolverOwnedTracks(clip, mesh) {
    // 部分配布 VMD 会为模型的全部骨骼写入一帧默认值，其中包括 Grant 派生骨以及
    // 头发、衣物等物理骨。这些轨道与 MMD 求解器同时写同一骨骼，会造成抖动和腿部
    // 变形残留。正常动作骨、足 IK 和 type=0 的随动刚体骨不在过滤范围内。
    const solverOwnedBones = getSolverOwnedBoneNames(mesh);
    if (solverOwnedBones.size === 0) return 0;

    const originalCount = clip.tracks.length;
    clip.tracks = clip.tracks.filter(track => {
        const binding = THREE.PropertyBinding.parseTrackName(track.name);
        return binding.objectName !== 'bones' || !solverOwnedBones.has(binding.objectIndex);
    });
    if (clip.tracks.length !== originalCount) clip.resetDuration();
    return originalCount - clip.tracks.length;
}

export async function loadManifestMotions(loader, mesh, motionDefinitions = {}, baseMotions = {}) {
    const entries = Object.entries(motionDefinitions).filter(([, definition]) => definition?.file);
    const settled = await Promise.allSettled(entries.map(async ([name, definition]) => {
        const clip = await loadAnimation(loader, definition.file, mesh);
        clip.name = name;
        if (definition.inPlace) {
            // Desktop movement belongs to Electron. Never play the VMD's 60-second world translation.
            clip.tracks = clip.tracks.filter(track => !track.name.startsWith('.bones[全ての親]'));
            const centerBone = mesh.skeleton.bones.find(b => b.name === 'センター');
            const center = clip.tracks.find(t => t.name === '.bones[センター].position');
            const zOffset = center && centerBone ? center.values[2] - centerBone.position.z : 0;
            for (const track of clip.tracks) {
                if (!/\.bones\[(センター|左足ＩＫ|右足ＩＫ|左足IK|右足IK)\]\.position$/.test(track.name)) continue;
                const binding = THREE.PropertyBinding.parseTrackName(track.name);
                const bone = mesh.skeleton.bones.find(b => b.name === binding.objectIndex);
                const stride = THREE.MathUtils.clamp(Number(definition.strideScale) || 1, 0.2, 1.5);
                for (let i = 0; i < track.values.length; i += 3) {
                    track.values[i + 2] -= zOffset;
                    if (bone) {
                        track.values[i] = bone.position.x + (track.values[i] - bone.position.x) * stride;
                        track.values[i + 2] = bone.position.z + (track.values[i + 2] - bone.position.z) * stride;
                    }
                }
            }
        }
        const removedSolverTracks = removeSolverOwnedTracks(clip, mesh);
        const base = baseMotions[name]?.clip;
        if (base) {
            if (definition.additiveToBase) {
                for (const track of clip.tracks) {
                    const baseTrack = base.tracks.find(t => t.name === track.name);
                    if (!baseTrack || !track.name.endsWith('.quaternion')) continue;
                    const rest = new THREE.Quaternion().fromArray(baseTrack.values);
                    for (let i = 0; i < track.values.length; i += 4) {
                        new THREE.Quaternion().fromArray(track.values, i).premultiply(rest).toArray(track.values, i);
                    }
                }
            }
            const driven = new Set(clip.tracks.map(t => t.name));
            // Missing body/IK channels hold the base pose rather than leaking the previous action.
            for (const track of base.tracks) {
                if (driven.has(track.name)) continue;
                const size = track.getValueSize();
                const value = Array.from(track.values.slice(0, size));
                clip.tracks.push(new track.constructor(track.name, [0, Math.max(clip.duration, 0.1)], [...value, ...value]));
            }
        }
        return [name, { definition, clip, removedSolverTracks }];
    }));

    const motions = {};
    const errors = [];
    settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            const [name, motion] = result.value;
            motions[name] = motion;
        } else {
            errors.push({
                name: entries[index][0],
                file: entries[index][1].file,
                message: result.reason?.message || String(result.reason),
            });
        }
    });
    return { motions, errors };
}
