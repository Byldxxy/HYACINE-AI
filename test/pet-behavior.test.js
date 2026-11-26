const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
let vite, PetBehavior;
before(async () => {
    const { createServer } = await import('vite');
    vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    ({ PetBehavior } = await vite.ssrLoadModule('/src/pet/runtime/PetBehavior.js'));
});
after(async () => { await vite?.close(); });
function setup() { let clock = 0; const behavior = new PetBehavior({ now: () => clock }); return { behavior, advance: seconds => { clock += seconds; behavior.update(); } }; }

test('idle gestures stay optional, return to breathing, and reserve stretching for a longer rest', () => {
    let clock = 0;
    const b = new PetBehavior({ now: () => clock, random: () => 0 });
    const at = seconds => { clock = seconds; return b.resolve(); };
    assert.equal(at(1.9), 'idle');
    assert.equal(at(2), 'idleShift');
    assert.equal(b.busy, false);
    assert.equal(at(5), 'idle');
    assert.equal(at(13), 'idleGlance');
    assert.equal(at(17), 'idle');
    assert.equal(at(25), 'idleStretch');
    b.event('thinking');
    assert.equal(b.current, 'thinking');
    clock = 50;
    b.event('taskFinished');
    assert.equal(b.current, 'idle');
    assert.equal(at(51.9), 'idle');
});

test('a window snapshot resolves hover and movement together, interrupting idle immediately', () => {
    let clock = 0;
    const changes = [];
    const b = new PetBehavior({ now: () => clock, random: () => 0, onChange: state => changes.push(state) });
    clock = 2;
    b.update();
    changes.length = 0;
    b.setWindowState('climbing', true);
    assert.deepEqual(changes, ['clinging']);
    changes.length = 0;
    b.setWindowState('walking', false);
    assert.deepEqual(changes, ['walking']);
    assert.equal(b.busy, false);
});
test('touch interrupts thinking then resumes the pending task without dancing', () => {
    const { behavior: b, advance } = setup();
    b.event('thinking', { requestId: 'a' }); b.event('tapHead'); assert.equal(b.current, 'tapHead');
    advance(3); assert.equal(b.current, 'thinking'); b.event('taskFinished', { requestId: 'a' }); assert.equal(b.current, 'idle');
});
test('desktop completion does not cancel a concurrent QQ task', () => {
    const { behavior: b } = setup(); b.event('thinking', { requestId: 'qq' }); b.event('thinking', { activity: 'desktop-analysis' });
    b.event('desktopAnalysisFinished'); assert.equal(b.current, 'thinking'); b.event('taskFinished', { requestId: 'qq' }); assert.equal(b.current, 'idle');
});
test('speech resumes walking and repeated touches respect cooldown', () => {
    const { behavior: b, advance } = setup(); b.setLocomotion('walking'); b.event('speaking', { duration: 2 }); assert.equal(b.current, 'speaking');
    advance(3); assert.equal(b.current, 'walking'); b.event('tapHead'); advance(1); b.event('tapHead'); advance(1.3); assert.equal(b.current, 'walking');
});
test('climbing retains physical pose while chat marks movement busy', () => {
    const { behavior: b } = setup(); b.setLocomotion('climbing'); b.event('thinking'); assert.equal(b.current, 'clinging'); assert.equal(b.busy, true);
    b.event('taskFinished'); assert.equal(b.busy, false);
});
test('drag overrides all behaviors and lost task completion has a timeout', () => {
    const { behavior: b, advance } = setup(); b.event('thinking'); b.event('dragStart'); assert.equal(b.current, 'dragging');
    b.event('dragEnd'); assert.equal(b.current, 'thinking'); advance(121); assert.equal(b.current, 'idle');
});
test('pointer blends out of walking through notice and focus, then resumes locomotion', () => {
    const { behavior: b, advance } = setup(); b.setLocomotion('walking');
    b.setInteracting(true); assert.equal(b.current, 'pointerNotice');
    advance(0.7); assert.equal(b.current, 'pointerFocus'); assert.equal(b.busy, false);
    b.setInteracting(false); assert.equal(b.current, 'walking');
});
test('pointer interrupts a background greet but preserves touch and ongoing tasks', () => {
    const { behavior: b, advance } = setup(); b.event('greet'); b.setInteracting(true);
    assert.equal(b.current, 'pointerNotice'); b.event('tapHead'); assert.equal(b.current, 'tapHead');
    advance(3); assert.equal(b.current, 'pointerFocus');
    b.event('thinking', { requestId: 'a' }); assert.equal(b.current, 'thinking');
    b.event('taskFinished', { requestId: 'a' }); assert.equal(b.current, 'pointerFocus');
});
test('interaction on a wall uses a live gripping pose and never switches to standing', () => {
    const { behavior: b, advance } = setup(); b.setLocomotion('climbing'); b.setInteracting(true);
    assert.equal(b.current, 'clinging'); advance(10); assert.equal(b.current, 'clinging');
    b.setInteracting(false); assert.equal(b.current, 'climbing');
    b.setLocomotion('falling'); b.setInteracting(true); assert.equal(b.current, 'falling');
    b.setLocomotion('landing'); assert.equal(b.current, 'landing');
    b.setLocomotion('idle'); assert.equal(b.current, 'pointerNotice');
});

test('mantle cannot be replaced by hover or chat, but a direct drag interrupts it', () => {
    const { behavior: b } = setup(); b.setLocomotion('mantling'); b.setInteracting(true); b.event('thinking');
    assert.equal(b.current, 'mantling'); b.event('dragStart'); assert.equal(b.current, 'dragging');
    b.setLocomotion('falling'); b.event('dragEnd'); assert.equal(b.current, 'falling');
});
