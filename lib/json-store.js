/**
 * Crash-resistant JSON persistence shared by configuration and memory stores.
 * Writes to the same path are serialized, flushed to a temporary file, backed up,
 * and then atomically renamed into place.
 */
const fs = require('fs').promises;
const path = require('path');

const writeQueues = new Map();

function cloneFallback(fallback) {
    const value = typeof fallback === 'function' ? fallback() : fallback;
    return JSON.parse(JSON.stringify(value));
}

async function replaceFile(source, target) {
    try {
        await fs.rename(source, target);
    } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
        await fs.rm(target, { force: true });
        await fs.rename(source, target);
    }
}

async function writeJsonFile(filePath, value, { createBackup = true } = {}) {
    const directory = path.dirname(filePath);
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temporaryPath = `${filePath}.${suffix}.tmp`;
    const backupPath = `${filePath}.bak`;
    const backupTemporaryPath = `${backupPath}.${suffix}.tmp`;
    await fs.mkdir(directory, { recursive: true });

    let handle;
    try {
        handle = await fs.open(temporaryPath, 'wx');
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;

        if (createBackup) {
            try {
                await fs.copyFile(filePath, backupTemporaryPath);
                await replaceFile(backupTemporaryPath, backupPath);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        await replaceFile(temporaryPath, filePath);
    } finally {
        await handle?.close().catch(() => {});
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
        await fs.rm(backupTemporaryPath, { force: true }).catch(() => {});
    }
}

function atomicWriteJson(filePath, value, options) {
    // Capture a plain snapshot before enqueueing so later in-memory mutations cannot
    // change the payload of a write that is already waiting behind another write.
    const snapshot = JSON.parse(JSON.stringify(value));
    const previous = writeQueues.get(filePath) || Promise.resolve();
    const current = previous
        .catch(() => {})
        .then(() => writeJsonFile(filePath, snapshot, options));
    writeQueues.set(filePath, current);
    current.finally(() => {
        if (writeQueues.get(filePath) === current) writeQueues.delete(filePath);
    }).catch(() => {});
    return current;
}

async function readCandidate(filePath, validate) {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return validate ? validate(parsed) : parsed;
}

async function readJsonWithBackup(filePath, { fallback, validate, label = path.basename(filePath) }) {
    try {
        return await readCandidate(filePath, validate);
    } catch (primaryError) {
        const backupPath = `${filePath}.bak`;
        try {
            const recovered = await readCandidate(backupPath, validate);
            console.warn(`${label} 主文件不可用，已从备份恢复: ${primaryError.message}`);
            await atomicWriteJson(filePath, recovered, { createBackup: false });
            return recovered;
        } catch (backupError) {
            if (primaryError.code === 'ENOENT' && backupError.code === 'ENOENT') {
                return cloneFallback(fallback);
            }
            console.error(`${label} 及其备份均不可用，已使用空数据: ${primaryError.message}`);
            if (backupError.code !== 'ENOENT') {
                console.error(`${label} 备份错误: ${backupError.message}`);
            }
            return cloneFallback(fallback);
        }
    }
}

module.exports = { atomicWriteJson, readJsonWithBackup };
