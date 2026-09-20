const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
let vite, THREE, LookAtController;
before(async () => {
    const { createServer } = await import('vite');
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    ({ LookAtController } = await vite.ssrLoadModule('/src/pet/runtime/LookAtController.js'));
    THREE = await import('three');
});
after(async () => { await vite?.close(); });
function setup() {
    const bones = ['頭', '両目', '右目', '左目', '右目先', '左目先'].map(name => { const b = new THREE.Bone(); b.name = name; return b; });
    const [head, common, right, left, rightTip, leftTip] = bones;
    head.add(common, right, left); right.add(rightTip); left.add(leftTip);
    right.position.x = -0.3; left.position.x = 0.3;
    const grants = [{ index: 2, parentIndex: 1, ratio: 1 }, { index: 3, parentIndex: 1, ratio: 1 }, { index: 4, parentIndex: 2, ratio: -0.7 }, { index: 5, parentIndex: 3, ratio: -0.7 }].map(g => ({ ...g, affectRotation: true }));
    const mesh = { skeleton: { bones }, geometry: { userData: { MMD: { grants } } } };
    const controller = new LookAtController(mesh, { head: ['頭'], eyes: ['両目'] });
    return { controller, head, common, right, left, rightTip };
}
test('PMX grant eyes and compensation move together without rotating the unused common control', () => {
    const { controller: c, common, right, left, rightTip } = setup();
    c.setTarget(1, -0.5); c.update(0.1);
    assert.deepEqual(c.eyes, [right, left]);
    assert.ok(right.quaternion.angleTo(new THREE.Quaternion()) > 0.01);
    assert.ok(right.quaternion.angleTo(left.quaternion) < 1e-7);
    assert.deepEqual(common.quaternion.toArray(), [0, 0, 0, 1]);
    assert.ok(rightTip.quaternion.y < 0 && right.quaternion.y > 0);
});
test('nearby targets use eye center and distant desktop cursor returns to neutral', () => {
    const { controller: c, head } = setup();
    const camera = new THREE.PerspectiveCamera(30, 250 / 400, 0.1, 100);
    camera.position.z = 10; camera.updateMatrixWorld(); head.updateMatrixWorld(true);
    c.setPointerTarget(125, 200, camera, 250, 400);
    assert.equal(Math.abs(c.targetX) + Math.abs(c.targetY), 0);
    c.setPointerTarget(220, 140, camera, 250, 400);
    assert.ok(c.targetX < 0 && c.targetY > 0);
    c.setPointerTarget(-1400, -800, camera, 250, 400);
    assert.equal(Math.abs(c.targetX) + Math.abs(c.targetY), 0);
    c.setPointerTarget(NaN, Infinity, camera, 250, 400);
    assert.equal(c.targetX + c.targetY, 0);
});
test('thousands of mixer updates cannot accumulate or bake a VMD eye offset into neutral', () => {
    const { controller: c, head, right, left } = setup();
    const authored = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.12));
    for (let i = 0; i < 3000; i++) {
        c.beforeAnimation(); head.quaternion.copy(authored);
        right.quaternion.setFromEuler(new THREE.Euler(-0.3, -0.6, 0));
        left.quaternion.copy(right.quaternion);
        c.setTarget(0.6, -0.4); c.update(1 / 60);
    }
    assert.ok(right.quaternion.angleTo(left.quaternion) < 1e-7);
    assert.ok(right.quaternion.angleTo(new THREE.Quaternion()) < 0.14);
    c.beforeAnimation(); assert.ok(head.quaternion.angleTo(authored) < 1e-7);
    for (let i = 0; i < 180; i++) { c.beforeAnimation(); head.quaternion.copy(authored); c.update(1 / 60); }
    assert.ok(right.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
    assert.ok(head.quaternion.angleTo(authored) < 1e-6);
    c.dispose(); assert.ok(head.quaternion.angleTo(authored) < 1e-7);
});
test('missing eye bones are safe and direct eye rigs remain supported', () => {
    const c = new LookAtController({}); c.setTarget(1, 1); c.update(1 / 60); c.dispose();
    const b = new THREE.Bone(); b.name = 'Eyes';
    const direct = new LookAtController({ skeleton: { bones: [b] } }, { eyes: ['Eyes'] });
    direct.setTarget(0.5, 0); direct.update(0.1); assert.ok(b.quaternion.y > 0);
});
