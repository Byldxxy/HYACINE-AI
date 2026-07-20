/**
 * 并行加载 manifest 中声明的 VMD 文件。
 *
 * 使用 Promise.allSettled 是有意的降级策略：某个动作缺失时返回 errors 供控制台诊断，
 * 其他成功动作仍可使用，模型本身也不会因为可选动作失败而无法显示。
 */
function loadAnimation(loader, file, mesh) {
    return new Promise((resolve, reject) => {
        loader.loadAnimation(file, mesh, resolve, undefined, reject);
    });
}

export async function loadManifestMotions(loader, mesh, motionDefinitions = {}) {
    const entries = Object.entries(motionDefinitions).filter(([, definition]) => definition?.file);
    const settled = await Promise.allSettled(entries.map(async ([name, definition]) => {
        const clip = await loadAnimation(loader, definition.file, mesh);
        clip.name = name;
        return [name, { definition, clip }];
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
