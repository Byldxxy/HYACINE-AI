const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { once } = require('events');
const fs = require('fs').promises;
const net = require('net');
const os = require('os');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

async function getAvailablePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitForReady(child, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error(`server timeout: ${output}`)), timeoutMs);
        const onData = data => {
            output += data.toString();
            if (!output.includes('配置与记忆初始化完成')) return;
            clearTimeout(timeout);
            child.stdout.off('data', onData);
            resolve();
        };
        child.stdout.on('data', onData);
        child.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`server exited before ready (${code}): ${output}`));
        });
    });
}

test('starts an isolated backend and validates management API boundaries', async (t) => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-server-'));
    let port;
    try {
        port = await getAvailablePort();
    } catch (error) {
        await fs.rm(dataDirectory, { recursive: true, force: true });
        if (error.code === 'EPERM' || error.code === 'EACCES') {
            t.skip('current execution sandbox does not allow binding a loopback port');
            return;
        }
        throw error;
    }
    const child = spawn(process.execPath, ['server.js'], {
        cwd: projectRoot,
        env: {
            ...process.env,
            API_KEY: '',
            API_PORT: String(port),
            BIND_HOST: '127.0.0.1',
            ELECTRON_DESKTOP_PET: '0',
            HYACINE_DATA_DIR: dataDirectory,
            HYACINE_RUNTIME_ROOT: projectRoot,
            NODE_ENV: 'test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
        if (child.exitCode === null) {
            child.kill('SIGTERM');
            await once(child, 'exit');
        }
        await fs.rm(dataDirectory, { recursive: true, force: true });
    });

    await waitForReady(child);
    const baseUrl = `http://127.0.0.1:${port}`;

    const desktop = await fetch(`${baseUrl}/api/desktop-pet`).then(response => response.json());
    assert.deepEqual(desktop, { available: false, visible: false });

    const invalidConfig = await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customKeywords: 'not-an-array' }),
    });
    assert.equal(invalidConfig.status, 400);

    const validConfig = await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            apiEndpoint: 'https://private-provider.example/v1',
            apiKey: 'integration-secret',
            modelName: 'integration-model',
            systemPrompt: 'PRIVATE INTEGRATION PROMPT',
            customKeywords: [],
            enableProactive: false,
        }),
    });
    assert.equal(validConfig.status, 200);

    const invalidMemory = await fetch(`${baseUrl}/api/memory/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'not-an-array' }),
    });
    assert.equal(invalidMemory.status, 400);

    const diagnostics = await fetch(`${baseUrl}/api/diagnostics`).then(response => response.json());
    const serialized = JSON.stringify(diagnostics);
    assert.equal(diagnostics.configuration.apiKeyConfigured, true);
    assert.equal(serialized.includes('integration-secret'), false);
    assert.equal(serialized.includes('private-provider'), false);
    assert.equal(serialized.includes('PRIVATE INTEGRATION PROMPT'), false);
});
