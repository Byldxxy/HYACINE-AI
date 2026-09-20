const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createPetMenuTemplate, visiblePetViewport } = require('../electron/pet-menu');
const { WindowWorld } = require('../electron/window-world');

test('shared menu dispatches checkbox values and reflects real topmost/roaming state', () => {
    const calls = [];
    const state = { visible: true, passthrough: true, topmost: false, roaming: false, serverReady: false };
    const menu = createPetMenuTemplate(state, (...args) => calls.push(args));
    assert.equal(menu.find(i => i.id === 'topmost').checked, false);
    assert.equal(menu.find(i => i.id === 'roaming').checked, false);
    assert.equal(menu.find(i => i.id === 'floor').enabled, true);
    assert.equal(menu.find(i => i.id === 'observe').enabled, false);
    menu.find(i => i.id === 'topmost').click({ checked: true });
    assert.deepEqual(calls, [['topmost', true]]);
    assert.equal(new Set(menu.filter(i => i.id).map(i => i.id)).size, 12);
});
test('safe viewport excludes taskbar overflow and handles negative monitor coordinates', () => {
    assert.deepEqual(visiblePetViewport({ x: 500, y: 565, width: 280, height: 400 }, { x: 0, y: 0, width: 1200, height: 900 }), { x: 0, y: 0, width: 280, height: 335 });
    assert.deepEqual(visiblePetViewport({ x: -1250, y: -100, width: 280, height: 400 }, { x: -1200, y: -50, width: 1200, height: 900 }), { x: 50, y: 50, width: 230, height: 350 });
});
function setup() {
    let tick, time = 0;
    const sandbox = { require: name => name === './window-world' ? { WindowWorld } : { readWindowList: async () => [] }, module: { exports: {} }, process: { platform: 'darwin', pid: 123 }, Date: { now: () => time }, setInterval: fn => { tick = fn; return { unref() {} }; }, clearInterval() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/window-companion.js'), 'utf8'), sandbox);
    const bounds = { x: 500, y: 520, width: 280, height: 400 };
    const win = { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({ ...bounds }), setPosition: (x, y) => Object.assign(bounds, { x, y }), webContents: { send() {} } };
    const service = sandbox.module.exports.createWindowCompanion({ getWindow: () => win, screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 900 } }) } });
    service.updateMetrics({ anchorX: 140, anchorY: 335, radius: 30, height: 300 });
    service.start(); service.setEnabled(true);
    return { service, bounds, tick: () => { time += 33; tick(); } };
}
test('independent native menu and renderer pauses cannot resume each other, including falling', () => {
    const { service: s, bounds, tick } = setup();
    s.setUiPaused(true, 'native-menu'); s.setUiPaused(true, 'renderer');
    s.setUiPaused(false, 'renderer');
    const before = { ...bounds };
    for (let i = 0; i < 100; i++) tick();
    assert.deepEqual(bounds, before); assert.equal(s.getState().interactionPaused, true);
    s.setUiPaused(false, 'native-menu'); assert.equal(s.getState().interactionPaused, false);
    s.setBusy(true); s.setUiPaused(true); s.setUiPaused(false); assert.equal(s.getState().paused, true);
    s.setBusy(false); assert.equal(s.getState().paused, false); s.stop();
});
test('resize preserves foot anchor while interaction stays paused, even with roaming off', () => {
    const { service: s, bounds } = setup(); s.setEnabled(false); s.setUiPaused(true);
    const foot = { x: bounds.x + 140, y: bounds.y + 335 };
    s.prepareResize(); Object.assign(bounds, { width: 500, height: 800, y: bounds.y - 400 });
    s.updateMetrics({ anchorX: 250, anchorY: 670, radius: 60, height: 600 });
    assert.equal(bounds.x + 250, foot.x); assert.equal(bounds.y + 670, foot.y);
    assert.equal(s.getState().interactionPaused, true);
    s.returnToFloor(); assert.equal(bounds.y + 670, 900); s.stop();
});

test('pointer hover allows a fall to finish, then keeps the landed pet still', () => {
    const { service: s, bounds, tick } = setup();
    s.setUiPaused(true, 'renderer', 'pointer');
    const y = bounds.y;
    for (let i = 0; i < 30; i++) tick();
    assert.ok(bounds.y > y);
    assert.equal(s.getState().state, 'landing');
    const landed = { ...bounds };
    for (let i = 0; i < 60; i++) tick();
    assert.deepEqual(bounds, landed); s.stop();
});
