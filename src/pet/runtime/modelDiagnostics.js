/**
 * 输出 MMD 模型能力报告。
 *
 * 不同模型的骨骼、Morph 和物理能力差异很大。报告用于开发者控制台诊断 manifest
 * 候选名称是否命中，不修改模型，也不把完整模型信息发送到后端。
 */
function findFirstName(availableNames, candidates = []) {
    return candidates.find(candidate => availableNames.includes(candidate)) || null;
}

export function inspectMmdModel(mesh, manifest, hasPhysics) {
    const boneNames = mesh.skeleton?.bones.map(bone => bone.name) || [];
    const morphNames = Object.keys(mesh.morphTargetDictionary || {});
    const mappedExpressions = Object.fromEntries(
        Object.entries(manifest.expressions || {}).map(([semantic, candidates]) => [
            semantic,
            findFirstName(morphNames, candidates),
        ])
    );

    const report = {
        format: mesh.geometry?.userData?.MMD?.format || 'unknown',
        bones: boneNames.length,
        morphs: morphNames.length,
        materials: Array.isArray(mesh.material) ? mesh.material.length : 1,
        physics: Boolean(hasPhysics),
        mappedBones: {
            head: findFirstName(boneNames, manifest.bones?.head),
            eyes: findFirstName(boneNames, manifest.bones?.eyes),
        },
        mappedExpressions,
    };

    console.groupCollapsed('[Pet] MMD model capability report');
    console.table({
        format: report.format,
        bones: report.bones,
        morphs: report.morphs,
        materials: report.materials,
        physics: report.physics,
    });
    console.log('Mapped bones:', report.mappedBones);
    console.log('Mapped expressions:', report.mappedExpressions);
    console.log('Bone names:', boneNames);
    console.log('Morph names:', morphNames);
    console.groupEnd();

    return report;
}
