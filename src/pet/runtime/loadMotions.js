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

export async function loadManifestMotions(loader, mesh, motionDefinitions = {}) {
    const entries = Object.entries(motionDefinitions).filter(([, definition]) => definition?.file);
    const settled = await Promise.allSettled(entries.map(async ([name, definition]) => {
        const clip = await loadAnimation(loader, definition.file, mesh);
        clip.name = name;
        const removedSolverTracks = removeSolverOwnedTracks(clip, mesh);
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
