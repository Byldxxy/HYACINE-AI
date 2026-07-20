/**
 * Electron 侧的桌面观察器。
 *
 * 本模块只负责读取前台应用、截取主显示器的低清缩略图，并判断画面是否值得分析。
 * 它不调用大模型：满足条件的帧通过 sendFrame 交给 main.js，再经子进程 IPC 发送到
 * lib/desktop-awareness.js。隐私排除、空闲检测和画面去重因此都在本地完成，不消耗 Token。
 */
const { desktopCapturer, powerMonitor, screen, systemPreferences } = require('electron');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
    isExcludedWindow,
    normalizeDesktopAwarenessConfig,
} = require('../lib/desktop-awareness');

const execFileAsync = promisify(execFile);
const SCAN_INTERVAL_MS = 5000;
// 该尺寸是视觉可读性、隐私暴露面和请求体大小之间的折中；发送前还会压缩为 JPEG。
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
    // 优先用 CoreGraphics 同时取得窗口标题和原生 windowId。标题缺失时再回退到
    // System Events；回退路径需要辅助功能权限，而仅获取前台应用名通常不需要。
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
    // PowerShell 内嵌少量 Win32 调用，避免为一个前台窗口查询引入原生 Node 依赖。
    // 返回字段与 macOS 结果对齐，后续隐私规则无需按平台分支。
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
    // Linux 当前依赖系统安装的 xdotool；Wayland 环境可能需要增加独立实现。
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
    // 旧版“当前窗口截图”保留此匹配器供测试和未来扩展使用。匹配顺序从可靠到宽松：
    // 原生 ID -> 完整标题 -> 包含关系 -> 应用名 -> 标题 token 相似度。
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
    // 当前产品策略是捕获整个主显示器，以规避不同平台窗口源名称不一致的问题。
    return sources.find(source => String(source.display_id) === String(primaryDisplayId)) || sources[0] || null;
}

function createFrameSignature(image) {
    // 将画面缩成 16x9 灰度签名。它不是内容识别，只用于低成本估算两帧变化比例。
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
    // paused 是用户临时暂停；suspended 表示桌宠被隐藏。二者必须分开保存，
    // 否则重新显示桌宠会意外覆盖用户主动选择的暂停状态。
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
        // 5 秒轮询会反复得到同一状态；去重可避免托盘重建和 IPC 日志刷屏。
        if (key === lastStatusKey) return;
        lastStatusKey = key;
        onStatus?.(payload);
    }

    async function scan({ force = false } = {}) {
        // 所有高成本操作之前先执行状态、空闲和隐私门禁。force 仅绕过空闲/变化/间隔，
        // 不绕过“功能未启用”和“桌宠已隐藏”，以保持用户开关的语义。
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

            // 常规采样需要同时满足最短间隔，并且应用变化或画面变化达到阈值。
            if (!force && (!intervalElapsed || (!activityChanged && difference < settings.changeThreshold))) {
                reportStatus('watching');
                return { ok: false, message: '当前画面没有达到分析条件' };
            }

            const dataUrl = `data:image/jpeg;base64,${source.thumbnail.toJPEG(55).toString('base64')}`;
            // 截图只以 data URL 驻留内存，不写入 data/、日志或会话文件。
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
            // 关闭后清除视觉基线，避免下次启用时与很久以前的截图做差分。
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
