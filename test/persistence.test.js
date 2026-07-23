const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createConfigManager } = require('../lib/config');
const { atomicWriteJson, readJsonWithBackup } = require('../lib/json-store');
const { getElectronDataDir } = require('../lib/paths');
const { normalizeBotConfig, parseSessions } = require('../lib/schemas');

async function createTemporaryDirectory(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-persistence-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

test('validates configuration and stamps the current schema version', () => {
    const config = normalizeBotConfig({ apiEndpoint: '', desktopAwarenessMaxReplyLength: 300 });
    assert.equal(config.configVersion, 1);
    assert.equal(config.optimizeImgPrompt, false);
    assert.equal(normalizeBotConfig({ botQQ: 123456 }).botQQ, '123456');
    assert.throws(
        () => normalizeBotConfig({ desktopAwarenessMaxReplyLength: 'many' }),
        error => error.code === 'invalid-data'
    );
    assert.throws(
        () => parseSessions({ group_1: [{ role: 'unknown', content: 'bad' }] }),
        error => error.code === 'invalid-data'
    );
});

test('keeps source-mode Electron data in the project and packaged data in userData', () => {
    const appRoot = path.join(path.sep, 'project');
    const userDataRoot = path.join(path.sep, 'user-data');

    assert.equal(
        getElectronDataDir({ isPackaged: false, appRoot, userDataRoot }),
        path.join(appRoot, 'data')
    );
    assert.equal(
        getElectronDataDir({ isPackaged: true, appRoot, userDataRoot }),
        path.join(userDataRoot, 'data')
    );
    assert.equal(
        getElectronDataDir({ isPackaged: false, appRoot, userDataRoot, forceUserData: true }),
        path.join(userDataRoot, 'data')
    );
});

test('serializes writes and retains the previous valid file as a backup', async (t) => {
    const directory = await createTemporaryDirectory(t);
    const filePath = path.join(directory, 'state.json');
    await Promise.all([
        atomicWriteJson(filePath, { revision: 1 }),
        atomicWriteJson(filePath, { revision: 2 }),
        atomicWriteJson(filePath, { revision: 3 }),
    ]);

    assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), { revision: 3 });
    assert.deepEqual(JSON.parse(await fs.readFile(`${filePath}.bak`, 'utf8')), { revision: 2 });
});

test('recovers a corrupt primary JSON file from its validated backup', async (t) => {
    const directory = await createTemporaryDirectory(t);
    const filePath = path.join(directory, 'state.json');
    await atomicWriteJson(filePath, { revision: 1 });
    await atomicWriteJson(filePath, { revision: 2 });
    await fs.writeFile(filePath, '{broken', 'utf8');

    const recovered = await readJsonWithBackup(filePath, {
        fallback: {},
        validate: value => {
            assert.equal(typeof value.revision, 'number');
            return value;
        },
        label: 'test state',
    });
    assert.deepEqual(recovered, { revision: 1 });
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), { revision: 1 });
});

test('config manager preserves a masked key and rejects invalid snapshots', async (t) => {
    const directory = await createTemporaryDirectory(t);
    const configFile = path.join(directory, 'bot-config.json');
    const previousApiKey = process.env.API_KEY;
    delete process.env.API_KEY;
    t.after(() => {
        if (previousApiKey === undefined) delete process.env.API_KEY;
        else process.env.API_KEY = previousApiKey;
    });

    const manager = createConfigManager({ configFile });
    await manager.loadConfig();
    await manager.saveConfig({ apiKey: 'secret-value', apiEndpoint: '' });
    await manager.saveConfig({ apiKey: '***alue', apiEndpoint: '' });
    assert.equal(manager.getConfig().apiKey, 'secret-value');
    await assert.rejects(
        manager.saveConfig({ apiKey: '', customKeywords: 'not-an-array' }),
        error => error.code === 'invalid-data'
    );
    await assert.rejects(manager.saveConfig(null), error => error.code === 'invalid-data');

    const saved = JSON.parse(await fs.readFile(configFile, 'utf8'));
    assert.equal(saved.configVersion, 1);
    assert.equal(saved.apiKey, 'secret-value');
});
