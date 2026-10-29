const { WindowWorld, visibleWindows } = require('./window-world');
const { readWindowList } = require('./window-provider');

// Electron's native Point conversion requires signed 32-bit integer coordinates.
const validCoordinate = value => Number.isFinite(value) && Math.round(value) >= -2147483648 && Math.round(value) <= 2147483647;

function createWindowCompanion({ getWindow, screen, onStatus = () => {}, onEnabledChange = () => {} }) {
    const world = new WindowWorld();
    let metrics = { anchorX: 125, anchorY: 380, radius: 32, height: 300 };
    let timer = null, scanning = false, nextScan = 0, failures = 0, lastTime = Date.now();
    let disposed = false, lastSent = '', lastError = '', ready = false;
    let suspended = false, behaviorBusy = false, resizing = false;
    const uiPauses = new Map();

    const getBounds = () => {
        const win = getWindow();
        return win && !win.isDestroyed() ? win.getBounds() : null;
    };
    function syncPosition() {
        const b = getBounds();
        if (b) {
            world.setActor({ x: b.x + metrics.anchorX, y: b.y + metrics.anchorY, radius: metrics.radius, height: metrics.height });
            world.setArea(screen.getDisplayNearestPoint({ x: Math.round(world.actor.x), y: Math.round(world.actor.y) }).workArea);
        }
    }
    function publish(force = false) {
        const state = { ...world.snapshot(), available: ['darwin', 'win32'].includes(process.platform), status: lastError || (world.enabled ? 'ready' : 'disabled'), paused: world.paused, interactionPaused: uiPauses.size > 0 };
        // Per-frame geometry stays in main; IPC changes only on semantic state changes.
        const key = JSON.stringify([state.enabled, state.state, state.direction, state.edge, state.attached, state.status, state.paused, state.interactionPaused, state.climbDirection, state.progress === null ? null : Math.round(state.progress * 1000), state.cycle === null ? null : Math.round(state.cycle * 1000)]);
        if (force || key !== lastSent) {
            lastSent = key;
            getWindow()?.webContents.send('window-companion-state', state);
            onStatus(state);
        }
        return state;
    }
    async function scan() {
        if (scanning || !world.enabled || suspended || disposed || uiPauses.size > 0) return;
        scanning = true;
        try {
            const list = await readWindowList();
            if (disposed || suspended || !world.enabled || uiPauses.size > 0) return;
            world.setWindows(visibleWindows(list, process.pid, rect => process.platform === 'win32' ? screen.screenToDipRect(null, rect) : rect));
            failures = 0; lastError = '';
        } catch (error) {
            failures += 1;
            lastError = error.code === 'UNSUPPORTED_PLATFORM' ? 'screen-only' : 'window-query-unavailable';
            // Never cling forever to a stale window after permission loss/provider failure.
            if (failures >= 2) world.setWindows([]);
        } finally { scanning = false; }
    }
    function recoverPosition() {
        world.release();
        syncPosition();
        lastError = 'position-recovered';
    }
    function moveWindow(win, x, y) {
        if (!validCoordinate(x) || !validCoordinate(y)) { recoverPosition(); return; }
        try {
            win.setPosition(Math.round(x), Math.round(y), false);
        } catch (error) {
            if (win.isDestroyed()) return;
            // A native move must not escape the interval as an uncaught exception.
            recoverPosition();
            lastError = 'window-move-unavailable';
            console.warn('[WindowCompanion] Window movement failed:', error.message);
        }
    }
    function step() {
        const time = Date.now();
        const dt = Math.min(0.05, (time - lastTime) / 1000); lastTime = time;
        const win = getWindow();
        if (!win || win.isDestroyed() || !win.isVisible() || suspended || !ready || !world.enabled) return;
        // Hover may stop a walk, but should never suspend gravity in mid-air.
        const pointerOnly = uiPauses.size > 0 && [...uiPauses.values()].every(mode => mode === 'pointer');
        if (resizing || (uiPauses.size > 0 && !(pointerOnly && world.state === 'falling'))) { publish(); return; }
        if (!validCoordinate(world.actor.x) || !validCoordinate(world.actor.y)) recoverPosition();
        world.setArea(screen.getDisplayNearestPoint({ x: Math.round(world.actor.x), y: Math.round(world.actor.y) }).workArea);
        if (time >= nextScan) { nextScan = time + (process.platform === 'win32' ? 1500 : 600); void scan(); }
        const state = world.tick(dt);
        if (!world.dragging) {
            const b = win.getBounds();
            const x = Math.round(state.x - metrics.anchorX), y = Math.round(state.y - metrics.anchorY);
            if (b.x !== x || b.y !== y) moveWindow(win, x, y);
        }
        publish();
    }
    function updatePause() { world.paused = uiPauses.size > 0 || behaviorBusy; publish(); }
    function placeActor() {
        const win = getWindow();
        if (win && !win.isDestroyed()) moveWindow(win, world.actor.x - metrics.anchorX, world.actor.y - metrics.anchorY);
    }
    return {
        start() { if (!timer) { timer = setInterval(step, 33); timer.unref?.(); } },
        stop() { disposed = true; clearInterval(timer); timer = null; },
        getState: () => publish(true),
        getEnabled: () => world.enabled,
        prepareResize() { resizing = true; },
        setEnabled(enabled) { syncPosition(); world.setEnabled(enabled); nextScan = 0; publish(true); onEnabledChange(); return world.enabled; },
        setSuspended(value) { suspended = Boolean(value); lastTime = Date.now(); if (!suspended) nextScan = 0; },
        setBusy(value) { behaviorBusy = Boolean(value); updatePause(); },
        setUiPaused(value, reason = 'renderer', mode = 'controls') {
            if (value) uiPauses.set(reason, mode); else uiPauses.delete(reason);
            if (!uiPauses.size) nextScan = 0;
            updatePause();
        },
        updateMetrics(value) {
            if (!value || !['anchorX','anchorY','radius','height'].every(k => Number.isFinite(value[k]))) return;
            const b = getBounds();
            if (!b || value.anchorX < 0 || value.anchorX > b.width || value.anchorY < 0 || value.anchorY > b.height || value.radius < 5 || value.radius > 200 || value.height < 20 || value.height > 1000) return;
            const wasReady = ready;
            metrics = { ...value }; ready = true;
            // During resize retain the world-space foot anchor, including speech headroom changes.
            if (!wasReady || (!world.enabled && !resizing)) syncPosition();
            world.setActor({ radius: metrics.radius, height: metrics.height });
            if (wasReady && resizing) placeActor();
            resizing = false;
            publish();
        },
        beginDrag() { syncPosition(); world.beginDrag(); publish(); },
        endDrag(velocity, point) { if (point) world.setActor(point); else syncPosition(); world.endDrag(velocity); nextScan = 0; publish(); },
        returnToFloor() {
            syncPosition(); world.returnToFloor();
            if (!world.enabled) { world.actor.y = world.area.y + world.area.height; world.state = 'idle'; placeActor(); }
            publish();
        },
    };
}
module.exports = { createWindowCompanion };
