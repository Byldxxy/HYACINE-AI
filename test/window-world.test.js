const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WindowWorld, visibleWindows } = require('../electron/window-world');
const area = { x: 0, y: 0, width: 1200, height: 900 };
const window = (id, x = 300, y = 400, width = 500, height = 400) => ({ id, bounds: { x, y, width, height } });
function world(x, y) {
    const w = new WindowWorld({ random: () => 0.5 }); w.setArea(area);
    w.setActor({ x, y, radius: 30, height: 250 }); w.setWindows([window('a')]); return w;
}
function advance(w, seconds) { for (let i = 0; i < seconds * 30; i++) w.tick(1 / 30); }

test('window list excludes pet, minimized, cloaked and invalid windows and keeps z-order', () => {
    const windows = visibleWindows([
        { ...window('self'), pid: 20 }, { ...window('hidden'), minimized: true },
        { ...window('cloak'), cloaked: true }, { id: 'bad', bounds: { x: NaN } },
        { ...window('front'), pid: 10 }, { ...window('back'), pid: 11 },
    ], 20, b => ({ ...b, x: b.x / 2 }));
    assert.deepEqual(windows.map(w => w.id), ['front', 'back']); assert.equal(windows[0].bounds.x, 150);
});
test('drag to a top edge attaches and follows window movement and resize', () => {
    const w = world(500, 420); w.setEnabled(true);
    assert.equal(w.attachment.edge, 'top'); assert.equal(w.actor.y, 400);
    w.setWindows([window('a', 360, 450, 180, 400)]);
    assert.equal(w.actor.y, 450); assert.equal(w.actor.x, 510);
    w.paused = true; advance(w, 2); assert.equal(w.actor.x, 510);
});
test('side climbing reaches the roof and transitions into walking', () => {
    const w = world(270, 650); w.setEnabled(true);
    assert.equal(w.state, 'climbing'); advance(w, 7);
    assert.equal(w.attachment.edge, 'top'); assert.equal(w.actor.y, 400);
    assert.ok(w.actor.x >= 330 && w.actor.x <= 770);
});
test('chat pauses climbing without changing the grip position', () => {
    const w = world(270, 650); w.setEnabled(true); w.paused = true; advance(w, 2);
    assert.equal(w.actor.y, 650); assert.equal(w.state, 'climbing');
    w.paused = false; advance(w, 1); assert.ok(w.actor.y < 650);
});
test('closing or minimizing the support window falls to the work-area floor', () => {
    const w = world(500, 410); w.setEnabled(true); w.setWindows([]); advance(w, 3);
    assert.equal(w.attachment, null); assert.equal(w.actor.y, 900);
});
test('an overlapping front window releases an occluded ledge', () => {
    const w = world(500, 410); w.setEnabled(true);
    w.setWindows([window('front', 200, 200, 700, 600), window('a')]);
    assert.equal(w.attachment, null); assert.equal(w.state, 'falling');
});
test('return to desktop does not immediately land on the same window', () => {
    const w = world(500, 410); w.setEnabled(true); w.returnToFloor(); advance(w, 3);
    assert.equal(w.actor.y, 900); assert.equal(w.attachment, null);
});
test('walk bounces at screen edges and remains bounded with negative monitor coordinates', () => {
    const w = world(-900, 850); w.setWindows([]); w.setArea({ x: -1200, y: -50, width: 1200, height: 900 }); w.setEnabled(true);
    advance(w, 120); assert.ok(w.actor.x >= -1170 && w.actor.x <= -30); assert.equal(w.actor.y, 850);
});
test('drag and disabled modes never move the native pet automatically', () => {
    const w = world(500, 410); w.setEnabled(true); w.beginDrag(); w.setActor({ x: 600, y: 600 }); advance(w, 5);
    assert.equal(w.actor.y, 600); w.endDrag(); w.setEnabled(false); advance(w, 5); assert.equal(w.actor.y, 600);
});
test('a roof without headroom reverses the climb instead of hiding the pet offscreen', () => {
    const w = world(270, 650); w.setWindows([window('a',300,80,500,700)]); w.setEnabled(true);
    let minY = Infinity;
    for (let i = 0; i < 30 * 15; i++) { w.tick(1 / 30); minY = Math.min(minY, w.actor.y); }
    assert.ok(minY >= 245); assert.notEqual(w.attachment?.edge, 'top');
});

test('mantle starts when hands reach the roof and follows a moved window without a teleport', () => {
    const w = world(270, 650); w.setEnabled(true);
    while (w.state === 'climbing') w.tick(1 / 30);
    assert.equal(w.state, 'mantling'); assert.ok(w.actor.y > 400 + 150);
    const start = { ...w.actor }; w.tick(1 / 30);
    assert.ok(Math.abs(w.actor.y - start.y) < 4);
    w.paused = true; const t = w.snapshot().progress; advance(w, 1); assert.equal(w.snapshot().progress, t);
    w.setWindows([window('a', 340, 420)]); assert.ok(Math.abs(w.actor.x - start.x - 40) < 4);
    w.paused = false; advance(w, 1.8); assert.equal(w.attachment.edge, 'top'); assert.equal(w.actor.y, 420);
});
test('missing support interrupts mantle immediately', () => {
    const w = world(270, 650); w.setEnabled(true); advance(w, 1.6);
    assert.equal(w.state, 'mantling'); w.setWindows([]); assert.equal(w.state, 'falling'); assert.equal(w.mantle, null);
});
test('a fast release throws instead of snapping and dissipates velocity on landing', () => {
    const w = world(500, 410); w.setEnabled(true); w.beginDrag(); w.setActor({ x: 500, y: 350 });
    w.endDrag({ x: 900, y: -250 }); assert.equal(w.state, 'falling'); assert.equal(w.attachment, null);
    advance(w, .2); assert.ok(w.actor.x > 600); assert.ok(w.actor.y < 350);
    advance(w, 4); assert.equal(w.vx, 0); assert.equal(w.vy, 0);
});
