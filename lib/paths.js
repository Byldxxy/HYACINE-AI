/**
 * 运行时数据与发布资源的路径约定。
 *
 * 源码模式把 data/ 放在仓库根目录，便于开发和备份；pkg 单文件模式则放在 exe 同级。
 * 所有调用者都应从本模块获取路径，避免配置、会话、摘要和角色参考图散落到工作目录。
 * prepareRuntimeData 还负责从早期版本的根目录布局做一次不覆盖迁移。
 */
const fs = require('fs');
const path = require('path');

function getRuntimePaths() {
    const isPkg = typeof process.pkg !== 'undefined';
    const defaultRuntimeRoot = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
    const runtimeRoot = process.env.HYACINE_RUNTIME_ROOT || defaultRuntimeRoot;
    const dataDir = process.env.HYACINE_DATA_DIR || path.join(runtimeRoot, 'data');

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

/**
 * 选择 Electron 后端的数据目录。
 *
 * 源码开发必须继续读取仓库内既有的 data/，否则 `npm run dev:pet` 会因为
 * Electron 开发态的 userData 名称通常是 "Electron" 而表现得像配置被清空。
 * 安装包则不能写入 app.asar/安装目录，因此必须使用操作系统的 userData。
 * 测试可通过 forceUserData 显式选择隔离目录。
 */
function getElectronDataDir({ isPackaged, appRoot, userDataRoot, forceUserData = false }) {
    const root = isPackaged || forceUserData ? userDataRoot : appRoot;
    if (!root) throw new Error('无法确定 Electron 运行时数据目录');
    return path.join(root, 'data');
}

function moveIfNeeded(source, target) {
    // 目标已经存在时保留新布局中的文件，绝不以旧数据覆盖用户当前数据。
    if (!fs.existsSync(source) || fs.existsSync(target)) return false;
    fs.renameSync(source, target);
    return true;
}

function prepareRuntimeData(paths) {
    // server.js 在创建任何管理器前调用这里，后续写文件可假设目录已经存在。
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

module.exports = { getElectronDataDir, getRuntimePaths, prepareRuntimeData };
