// lib/paths.js - 运行时数据与发布资源的路径约定
const fs = require('fs');
const path = require('path');

function getRuntimePaths() {
    const isPkg = typeof process.pkg !== 'undefined';
    const runtimeRoot = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
    const dataDir = path.join(runtimeRoot, 'data');

    return {
        isPkg,
        runtimeRoot,
        dataDir,
        configFile: path.join(dataDir, 'bot-config.json'),
        memoryFile: path.join(dataDir, 'bot-sessions.json'),
        summaryFile: path.join(dataDir, 'bot-summaries.json'),
        persistentFile: path.join(dataDir, 'bot-persistent-memory.json'),
        avatarDir: path.join(dataDir, 'avatars'),
        legacyAvatarDir: isPkg
            ? path.join(runtimeRoot, 'avatars')
            : path.join(runtimeRoot, 'public', 'avatars'),
    };
}

function moveIfNeeded(source, target) {
    if (!fs.existsSync(source) || fs.existsSync(target)) return false;
    fs.renameSync(source, target);
    return true;
}

function prepareRuntimeData(paths) {
    fs.mkdirSync(paths.dataDir, { recursive: true });

    const legacyFiles = [
        ['bot-config.json', paths.configFile],
        ['bot-sessions.json', paths.memoryFile],
        ['bot-summaries.json', paths.summaryFile],
        ['bot-persistent-memory.json', paths.persistentFile],
    ];

    const moved = legacyFiles
        .filter(([name, target]) => moveIfNeeded(path.join(paths.runtimeRoot, name), target))
        .map(([name]) => name);

    if (moveIfNeeded(paths.legacyAvatarDir, paths.avatarDir)) {
        moved.push('avatars/');
    }

    fs.mkdirSync(paths.avatarDir, { recursive: true });
    return moved;
}

module.exports = { getRuntimePaths, prepareRuntimeData };
