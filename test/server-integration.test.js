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

test('real reverse WebSocket routes receipts, deduplicates reconnects and ignores frontend/self messages', async (t) => {
    const http = require('node:http');
    const { WebSocket } = require('ws');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-qq-'));
    let requests = 0;
    const provider = http.createServer(async (req, res) => {
        for await (const _chunk of req) { /* Drain this isolated test request. */ }
        requests++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '这是本轮的回复。' } }] }));
    });
    try { await new Promise((resolve, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', resolve); }); }
    catch (error) { await fs.rm(directory, { recursive: true, force: true }); if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('loopback unavailable'); return; } throw error; }
    const port = await getAvailablePort();
    const child = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env: { ...process.env, API_KEY: '', API_PORT: String(port), BIND_HOST: '127.0.0.1', ELECTRON_DESKTOP_PET: '0', HYACINE_DATA_DIR: directory, HYACINE_RUNTIME_ROOT: projectRoot, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const sockets = [];
    t.after(async () => { for (const ws of sockets) ws.terminate(); if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } await new Promise(resolve => provider.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
    await waitForReady(child);
    const url = `http://127.0.0.1:${port}`;
    await fetch(`${url}/api/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botQQ: '999', apiKey: 'fake-key', apiEndpoint: `http://127.0.0.1:${provider.address().port}/v1`, modelName: 'fake', enableSplit: false, enableProactive: false }) });
    const connect = async () => { const ws = new WebSocket(`ws://127.0.0.1:${port}`); sockets.push(ws); await once(ws, 'open'); return ws; };
    const first = await connect(), second = await connect(), ui = await connect(); const uiLogs = []; ui.on('message', data => uiLogs.push(data.toString())); ui.send('iam_frontend');
    const incoming = id => ({ post_type: 'message', self_id: 999, message_type: 'group', group_id: 100, user_id: 20, message_id: id, message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: '请回答' } }] });
    const packets = []; first.on('message', data => { const p = JSON.parse(data); if (p.action) packets.push({ ws: first, p }); }); second.on('message', data => { const p = JSON.parse(data); if (p.action) packets.push({ ws: second, p }); });
    const until = async condition => { for (let i = 0; i < 100; i++) { if (await condition()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('condition timeout'); };
    ui.send(JSON.stringify(incoming(1))); first.send(JSON.stringify(incoming(1))); second.send(JSON.stringify(incoming(1)));
    await until(() => packets.length === 1);
    assert.equal(requests, 1);
    assert.deepEqual(await fetch(`${url}/api/memory/group_100`).then(r => r.json()), []);
    const { ws, p } = packets[0]; assert.equal(p.params.message.at(-1).type, 'text');
    ws.send(JSON.stringify({ echo: p.echo, status: 'ok', retcode: 0, data: { message_id: 77 } }));
    await until(async () => (await fetch(`${url}/api/memory/group_100`).then(r => r.json())).length === 2);
    first.send(JSON.stringify({ ...incoming(2), user_id: 999 })); first.send('{bad json'); second.send(JSON.stringify(incoming(1)));
    // A distinct later question proves the connection and queue are still functional.
    const next = incoming(3); next.message[1].data.text = '第二个问题'; second.send(JSON.stringify(next));
    await until(() => packets.length === 2); assert.equal(requests, 2);
    const last = packets[1]; last.ws.send(JSON.stringify({ echo: last.p.echo, status: 'failed', retcode: 100, data: null }));
    await until(() => uiLogs.some(line => line.includes('回复中止'))); // Wait for the failed receipt to be handled.
    assert.equal((await fetch(`${url}/api/memory/group_100`).then(r => r.json())).length, 2);
});
