/**
 * Cross-platform desktop-pet development launcher.
 * Starts Vite, waits until pet.html responds, then starts the local Electron binary.
 */
const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const binExtension = process.platform === 'win32' ? '.cmd' : '';
const viteBin = path.join(projectRoot, 'node_modules', '.bin', `vite${binExtension}`);
const electronBin = path.join(projectRoot, 'node_modules', '.bin', `electron${binExtension}`);
const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const parsedUrl = new URL(devServerUrl);
const viteArgs = ['--host', parsedUrl.hostname, '--port', parsedUrl.port || '5173', '--strictPort'];

let viteProcess = null;
let electronProcess = null;
let stopping = false;

function spawnProcess(command, args, env = process.env) {
    return spawn(command, args, {
        cwd: projectRoot,
        env,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
}

async function waitForServer(url, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Vite did not become ready at ${url}: ${lastError?.message || 'timeout'}`);
}

function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    electronProcess?.kill();
    viteProcess?.kill();
    process.exitCode = exitCode;
}

async function main() {
    viteProcess = spawnProcess(viteBin, viteArgs);
    viteProcess.once('exit', code => {
        if (!stopping) stop(code || 1);
    });

    await waitForServer(`${devServerUrl.replace(/\/$/, '')}/pet.html`);
    const electronEnvironment = {
        ...process.env,
        VITE_DEV_SERVER_URL: devServerUrl,
    };
    // Some parent automation tools use this flag internally. It must not leak into
    // a child that is expected to start the real Electron main process.
    delete electronEnvironment.ELECTRON_RUN_AS_NODE;
    electronProcess = spawnProcess(electronBin, ['electron/main.js'], electronEnvironment);
    electronProcess.once('exit', code => stop(code || 0));
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
main().catch(error => {
    console.error(`[dev:pet] ${error.message}`);
    stop(1);
});
