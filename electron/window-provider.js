/** Read only visible window rectangles. No titles, screenshots, focus changes or window control. */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const path = require('node:path');

async function readWindowList({ platform = process.platform, run = execFileAsync } = {}) {
    let result;
    if (platform === 'darwin') {
        result = await run('/usr/bin/osascript', ['-l', 'JavaScript', path.join(__dirname, 'native/window-list.js')], { timeout: 2500, maxBuffer: 1024 * 1024 });
    } else if (platform === 'win32') {
        result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'native/window-list.ps1')], { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 });
    } else {
        const error = new Error('窗口攀爬目前支持 macOS 和 Windows；其他系统可沿屏幕边缘行走');
        error.code = 'UNSUPPORTED_PLATFORM'; throw error;
    }
    const data = JSON.parse(result.stdout.trim() || '[]');
    return Array.isArray(data) ? data : [data];
}
module.exports = { readWindowList };
