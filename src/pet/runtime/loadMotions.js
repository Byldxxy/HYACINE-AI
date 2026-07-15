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
