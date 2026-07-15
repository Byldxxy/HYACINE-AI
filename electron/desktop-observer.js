const { desktopCapturer, powerMonitor, screen, systemPreferences } = require('electron');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
    isExcludedWindow,
    normalizeDesktopAwarenessConfig,
} = require('../lib/desktop-awareness');

const execFileAsync = promisify(execFile);
const SCAN_INTERVAL_MS = 5000;
const CAPTURE_SIZE = { width: 960, height: 540 };

function createAccessibilityError() {
    const error = new Error('需要 macOS 辅助功能权限以锁定当前窗口');
    error.code = 'accessibility-required';
    return error;
}

async function getMacAccessibilityWindowTitle() {
    const script = `tell application "System Events"
set frontApp to first application process whose frontmost is true
if (count of windows of frontApp) is 0 then return ""
return name of front window of frontApp
end tell`;
    try {
        const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 3000 });
        return stdout.trim();
    } catch {
        throw createAccessibilityError();
    }
}

async function getMacActiveWindow() {
    const script = `ObjC.import('AppKit');
ObjC.import('CoreGraphics');
const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
if (!app) throw new Error('No frontmost application');
const pid = Number(ObjC.unwrap(app.processIdentifier));
const windowList = $.CGWindowListCopyWindowInfo(17, 0);
let frontWindow = null;
for (let index = 0; index < Number(windowList.count); index += 1) {
  const item = ObjC.deepUnwrap(windowList.objectAtIndex(index));
  if (Number(item.kCGWindowOwnerPID) === pid && Number(item.kCGWindowLayer) === 0 && item.kCGWindowName) {
    frontWindow = item;
    break;
  }
}
JSON.stringify({
  ownerName: ObjC.unwrap(app.localizedName) || '',
  bundleId: ObjC.unwrap(app.bundleIdentifier) || '',
  processName: ObjC.unwrap(app.executableURL.lastPathComponent) || '',
  title: frontWindow ? String(frontWindow.kCGWindowName) : '',
  windowId: frontWindow ? Number(frontWindow.kCGWindowNumber) : 0
});`;
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
        '-l', 'JavaScript', '-e', script,
    ], { timeout: 3000 });
    const result = JSON.parse(stdout.trim());
    if (!result.title) {
        if (!systemPreferences.isTrustedAccessibilityClient(false)) {
            throw createAccessibilityError();
        }
        result.title = await getMacAccessibilityWindowTitle();
    }
    if (!result.title) throw createAccessibilityError();
    return result;
}

async function getMacActiveApplication() {
    const script = `ObjC.import('AppKit');
const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
if (!app) throw new Error('No frontmost application');
JSON.stringify({
  ownerName: ObjC.unwrap(app.localizedName) || '',
  bundleId: ObjC.unwrap(app.bundleIdentifier) || '',
  processName: ObjC.unwrap(app.executableURL.lastPathComponent) || '',
  title: ''
});`;
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
        '-l', 'JavaScript', '-e', script,
    ], { timeout: 3000 });
    return JSON.parse(stdout.trim());
}

async function getWindowsActiveWindow() {
    const script = `Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
$handle = [ForegroundWindow]::GetForegroundWindow()
$pidValue = 0
[ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$pidValue) | Out-Null
$text = New-Object System.Text.StringBuilder 1024
[ForegroundWindow]::GetWindowText($handle, $text, $text.Capacity) | Out-Null
$process = Get-Process -Id $pidValue -ErrorAction Stop
[PSCustomObject]@{title=$text.ToString();ownerName=$process.ProcessName;processName=$process.ProcessName} | ConvertTo-Json -Compress`;
    const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', script,
    ], { timeout: 4000, windowsHide: true });
    return JSON.parse(stdout.trim());
}

async function getLinuxActiveWindow() {
    const { stdout: title } = await execFileAsync('xdotool', ['getactivewindow', 'getwindowname'], { timeout: 3000 });
    return { title: title.trim(), ownerName: '' };
}

async function getActiveWindow() {
    if (process.platform === 'darwin') return getMacActiveWindow();
    if (process.platform === 'win32') return getWindowsActiveWindow();
    if (process.platform === 'linux') return getLinuxActiveWindow();
    throw new Error(`Unsupported platform: ${process.platform}`);
}

async function getActiveApplication() {
    if (process.platform === 'darwin') return getMacActiveApplication();
    if (process.platform === 'win32') return getWindowsActiveWindow();
    if (process.platform === 'linux') return getLinuxActiveWindow();
    throw new Error(`Unsupported platform: ${process.platform}`);
}

function normalizeSourceName(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/[\u2013\u2014]/g, '-')
        .toLowerCase();
}

function getSourceNameTokens(value) {
    return [...new Set(normalizeSourceName(value)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(token => token.length >= 2))];
}

function getTitleMatchScore(sourceName, windowInfo) {
    const sourceTokens = getSourceNameTokens(sourceName);
    const targetTokens = new Set([
        ...getSourceNameTokens(windowInfo?.title),
        ...getSourceNameTokens(windowInfo?.ownerName),
    ]);
    if (sourceTokens.length === 0 || targetTokens.size === 0) return 0;
    const shared = sourceTokens.filter(token => targetTokens.has(token)).length;
    return shared / sourceTokens.length;
}

function selectWindowSource(sources, windowInfo) {
    const title = normalizeSourceName(windowInfo?.title);
    const owner = normalizeSourceName(windowInfo?.ownerName);
    const windowId = Number(windowInfo?.windowId);
    if (Number.isInteger(windowId) && windowId > 0) {
        const sourceById = sources.find(source => new RegExp(`^window:${windowId}:`).test(source.id));
        if (sourceById) return sourceById;
    }
    if (!title && !owner) return null;

    return sources.find(source => normalizeSourceName(source.name) === title)
        || sources.find(source => {
            const name = normalizeSourceName(source.name);
            return title.length >= 4 && (name.includes(title) || title.includes(name));
        })
        || sources.find(source => normalizeSourceName(source.name) === owner)
        || sources.find(source => {
            const sourceTokens = getSourceNameTokens(source.name);
            const targetTokens = new Set([
                ...getSourceNameTokens(windowInfo?.title),
                ...getSourceNameTokens(windowInfo?.ownerName),
            ]);
            const shared = sourceTokens.filter(token => targetTokens.has(token)).length;
            return shared >= 2 && getTitleMatchScore(source.name, windowInfo) >= 0.6;
        })
        || null;
}

function selectPrimaryDisplaySource(sources, primaryDisplayId = String(screen.getPrimaryDisplay().id)) {
    return sources.find(source => String(source.display_id) === String(primaryDisplayId)) || sources[0] || null;
}

function createFrameSignature(image) {
    const bitmap = image.resize({ width: 16, height: 9, quality: 'good' }).toBitmap();
    const signature = [];
    for (let index = 0; index < bitmap.length; index += 4) {
        signature.push(Math.round((bitmap[index] + bitmap[index + 1] + bitmap[index + 2]) / 3));
    }
    return signature;
}

function compareSignatures(previous, current) {
    if (!previous || previous.length !== current.length) return 1;
    const difference = current.reduce((sum, value, index) => sum + Math.abs(value - previous[index]), 0);
    return difference / (current.length * 255);
}

function createDesktopObserver({ sendFrame, onStatus }) {
    let settings = normalizeDesktopAwarenessConfig();
    let paused = false;
    let suspended = false;
    let timer = null;
    let scanning = false;
    let lastSentAt = 0;
    let lastActivityKey = '';
    let lastSignature = null;
    let lastStatusKey = '';

    function reportStatus(status, detail = '') {
        const payload = {
            enabled: settings.enabled,
            paused,
            suspended,
            status,
            detail,
        };
        const key = JSON.stringify(payload);
        if (key === lastStatusKey) return;
        lastStatusKey = key;
        onStatus?.(payload);
    }

    async function scan({ force = false } = {}) {
        if (!settings.enabled) {
            reportStatus('disabled');
            return { ok: false, message: '请先启用桌面感知' };
        }
        if (suspended) {
            reportStatus('pet-hidden');
            return { ok: false, message: '桌宠已隐藏，桌面感知已停止' };
        }
        if (paused || scanning) {
            return { ok: false, message: scanning ? '桌面感知正在分析中' : '桌面感知已暂停' };
        }
        if (!force && powerMonitor.getSystemIdleTime() >= 60) {
            reportStatus('idle');
            return { ok: false, message: '检测到空闲，已暂停观察' };
        }
        scanning = true;
        try {
            const activity = await getActiveApplication();
            if (!activity?.ownerName && !activity?.bundleId) {
                reportStatus('window-unavailable');
                return { ok: false, message: '无法读取当前前台应用' };
            }
            if (isExcludedWindow(activity, settings.excludedTerms)) {
                reportStatus('excluded');
                return { ok: false, message: '当前前台应用命中隐私排除规则' };
            }

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: CAPTURE_SIZE,
                fetchWindowIcons: false,
            });
            const source = selectPrimaryDisplaySource(sources);
            if (!source) {
                reportStatus('screen-source-unavailable', '系统未返回可捕获的主显示器画面');
                return { ok: false, message: '无法读取主显示器画面' };
            }
            if (source.thumbnail.isEmpty()) {
                const screenPermission = process.platform === 'darwin'
                    ? systemPreferences.getMediaAccessStatus('screen')
                    : 'unknown';
                if (screenPermission === 'denied') {
                    reportStatus('permission-denied', '请在系统设置中允许 HYACINE-AI 录制屏幕');
                    return { ok: false, message: '缺少屏幕录制权限' };
                }
                reportStatus('screen-thumbnail-unavailable', 'macOS 未返回主显示器的可读缩略图');
                return { ok: false, message: 'macOS 未返回主显示器缩略图' };
            }

            const signature = createFrameSignature(source.thumbnail);
            const difference = compareSignatures(lastSignature, signature);
            const activityKey = `${activity.ownerName || ''}\n${activity.bundleId || ''}`;
            const activityChanged = activityKey !== lastActivityKey;
            const intervalElapsed = Date.now() - lastSentAt >= settings.intervalSeconds * 1000;

            if (!force && (!intervalElapsed || (!activityChanged && difference < settings.changeThreshold))) {
                reportStatus('watching');
                return { ok: false, message: '当前画面没有达到分析条件' };
            }

            const dataUrl = `data:image/jpeg;base64,${source.thumbnail.toJPEG(55).toString('base64')}`;
            sendFrame({
                dataUrl,
                capturedAt: Date.now(),
                change: difference,
                window: activity,
                force,
            });
            lastSentAt = Date.now();
            lastActivityKey = activityKey;
            lastSignature = signature;
            reportStatus('analyzing');
            return { ok: true };
        } catch (error) {
            if (error.code === 'accessibility-required') {
                reportStatus('accessibility-required', '请在系统设置中允许 HYACINE-AI 使用辅助功能');
                return { ok: false, message: '缺少辅助功能权限' };
            } else {
                reportStatus('error', error.message);
                return { ok: false, message: '桌面感知发生错误' };
            }
        } finally {
            scanning = false;
        }
    }

    function start() {
        if (timer) return;
        timer = setInterval(scan, SCAN_INTERVAL_MS);
        scan();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
        scanning = false;
    }

    function updateConfig(config) {
        const wasEnabled = settings.enabled;
        settings = normalizeDesktopAwarenessConfig(config);
        if (!settings.enabled) {
            paused = false;
            lastSignature = null;
            lastActivityKey = '';
            reportStatus('disabled');
        } else {
            if (!wasEnabled) lastSentAt = 0;
            reportStatus(suspended ? 'pet-hidden' : paused ? 'paused' : 'watching');
        }
    }

    function setSuspended(value) {
        suspended = Boolean(value);
        if (!settings.enabled) {
            reportStatus('disabled');
            return;
        }
        if (suspended) {
            reportStatus('pet-hidden');
        } else {
            reportStatus(paused ? 'paused' : 'watching');
            if (!paused) scan();
        }
    }

    function togglePaused() {
        if (!settings.enabled) return false;
        paused = !paused;
        reportStatus(paused ? 'paused' : 'watching');
        if (!paused) scan();
        return !paused;
    }

    function getState() {
        return { enabled: settings.enabled, paused, suspended };
    }

    function requestTest() {
        return scan({ force: true });
    }

    return { getState, requestTest, scan, setSuspended, start, stop, togglePaused, updateConfig };
}

module.exports = {
    compareSignatures,
    createDesktopObserver,
    getActiveApplication,
    getActiveWindow,
    getTitleMatchScore,
    normalizeSourceName,
    selectPrimaryDisplaySource,
    selectWindowSource,
};
