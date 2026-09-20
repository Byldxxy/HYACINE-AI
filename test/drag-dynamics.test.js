const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
let vite, DragDynamics, HandDragController, THREE;
before(async () => {
    const { createServer } = await import('vite');
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    ({ DragDynamics } = await vite.ssrLoadModule('/src/pet/runtime/DragDynamics.js'));
    ({ HandDragController } = await vite.ssrLoadModule('/src/pet/runtime/HandDragController.js'));
    THREE = await import('three');
});
after(async () => { await vite?.close(); });
test('a flick excites the pendulum, stops decay to rest and spikes stay bounded', () => {
    const d = new DragDynamics(); d.sample(0, 0); d.sample(100, 30);
    for (let i = 0; i < 20; i++) d.update(1 / 60);
    assert.ok(Math.abs(d.angle) > 0.1);
    for (let i = 0; i < 900; i++) d.update(1 / 60);
    assert.ok(Math.abs(d.angle) < 0.001);
    d.sample(100000, 60); for (let i = 0; i < 100; i++) { d.update(.05); assert.ok(Math.abs(d.angle) <= 1.05); }
});
test('pendulum motion is consistent at 30 and 120 FPS', () => {
    const a = new DragDynamics(), b = new DragDynamics();
    for (const d of [a, b]) { d.sample(0, 0); d.sample(50, 40); }
    for (let i = 0; i < 30; i++) a.update(1 / 30);
    for (let i = 0; i < 120; i++) b.update(1 / 120);
    assert.ok(Math.abs(a.angle - b.angle) < .002);
});
test('hand remains at the pointer while the body swings, stop restores the root transform', () => {
    const mesh = new THREE.Object3D(), hand = new THREE.Bone(); hand.name = '右手首'; hand.position.set(-1, 7, 0); mesh.add(hand); mesh.skeleton = { bones: [hand] };
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 100); camera.position.z = 20; camera.updateMatrixWorld(true);
    const c = new HandDragController(mesh); c.start({ x: 300, y: 90 }); c.dynamics.sample(0, 0); c.dynamics.sample(150, 30);
    for (let i = 0; i < 40; i++) {
        c.restore(); c.update(1 / 60, camera, 600, 500); const s = c.snapshot(camera, 600, 500);
        assert.ok(Math.hypot(s.hand.x - 300, s.hand.y - 90) < .001);
    }
    c.stop(); assert.equal(mesh.rotation.z, 0); assert.equal(mesh.position.length(), 0);
});
