const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');

let vite;
let MotionController;
let removeSolverOwnedTracks;
let loadManifestMotions;

before(async () => {
    const { createServer } = await import('vite');
    vite = await createServer({
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'silent',
    });
    ({ MotionController } = await vite.ssrLoadModule('/src/pet/runtime/MotionController.js'));
    ({ removeSolverOwnedTracks, loadManifestMotions } = await vite.ssrLoadModule('/src/pet/runtime/loadMotions.js'));
});

after(async () => {
    await vite?.close();
});

function vectorTrack(name) {
    return new THREE.VectorKeyframeTrack(`.bones[${name}].position`, [0], [0, 0, 0]);
}

test('removes Grant and dynamic-physics tracks without removing normal motion bones', () => {
    const clip = new THREE.AnimationClip('motion', -1, [
        vectorTrack('leg'),
        vectorTrack('derivedLeg'),
        vectorTrack('hair'),
    ]);
    const mesh = {
        geometry: {
            userData: {
                MMD: {
                    bones: [
                        { name: 'leg', rigidBodyType: -1 },
                        { name: 'derivedLeg', rigidBodyType: 0, grant: { parentIndex: 0 } },
                        { name: 'hair', rigidBodyType: 2 },
                    ],
                },
            },
        },
    };

    assert.equal(removeSolverOwnedTracks(clip, mesh), 2);
    assert.deepEqual(clip.tracks.map(track => track.name), ['.bones[leg].position']);
});

test('direct interaction survives desktop events and finalizes before the next MMD update', () => {
    class FakeAction {
        constructor(clip) {
            this.clip = clip;
            this.stops = 0;
            this.effectiveWeight = 0;
        }

        getClip() { return this.clip; }
        reset() { return this; }
        setLoop() { return this; }
        setEffectiveTimeScale() { return this; }
        fadeIn() { return this; }
        fadeOut() { return this; }
        play() { return this; }
        stop() { this.stops += 1; return this; }
        setEffectiveWeight(weight) { this.effectiveWeight = weight; return this; }
    }

    const clips = {
        idle: new THREE.AnimationClip('idle', 1, [vectorTrack('leg')]),
        thinking: new THREE.AnimationClip('thinking', 1, [vectorTrack('leg')]),
        dance: new THREE.AnimationClip('dance', 1, [vectorTrack('leg')]),
    };
    const actions = new Map(Object.values(clips).map(clip => [clip, new FakeAction(clip)]));
    const mixer = {
        time: 0,
        stopAllAction() {},
        addEventListener() {},
        removeEventListener() {},
        clipAction: clip => actions.get(clip),
    };
    const leg = new THREE.Bone();
    leg.name = 'leg';
    const mesh = { skeleton: { bones: [leg] } };
    const helperObjects = { mixer, backupBones: new Float32Array(7), looped: true };
    const helper = { objects: new Map([[mesh, helperObjects]]) };
    const motions = {
        idle: { clip: clips.idle, definition: { loop: true, priority: 0, fadeIn: 0.4, fadeOut: 0.4 } },
        thinking: { clip: clips.thinking, definition: { loop: true, priority: 10, fadeIn: 0.3, fadeOut: 0.35 } },
        dance: { clip: clips.dance, definition: { priority: 20, fadeIn: 0.45, fadeOut: 0.5 } },
    };
    const controller = new MotionController({ helper, mesh, motions });

    assert.equal(controller.play('idle', { force: true }), true);
    assert.equal(controller.play('thinking', { priority: 30 }), true);
    assert.equal(controller.play('dance', { priority: 40 }), true);
    assert.equal(controller.play('idle', { priority: 30 }), false);
    assert.equal(controller.state, 'dance');

    mixer.time = 0.5;
    controller.beforeAnimationUpdate();
    assert.equal(actions.get(clips.idle).stops, 1);
    assert.equal(actions.get(clips.thinking).stops, 1);
    assert.equal(actions.get(clips.dance).effectiveWeight, 1);

    controller.handleFinished({ action: actions.get(clips.dance) });
    assert.equal(controller.state, 'idle');
    mixer.time = 1.01;
    controller.beforeAnimationUpdate();
    assert.equal(actions.get(clips.dance).stops, 1);
    assert.equal(actions.get(clips.idle).effectiveWeight, 1);
});


test('in-place external walking removes world travel and preserves the missing base-pose channels', async () => {
    const center = new THREE.Bone(); center.name = 'センター'; center.position.set(0, 10, 0);
    const foot = new THREE.Bone(); foot.name = '左足ＩＫ'; foot.position.set(1, 1, 0);
    const clip = new THREE.AnimationClip('source', 2, [
        new THREE.VectorKeyframeTrack('.bones[全ての親].position', [0, 2], [0, 0, 0, 0, 0, -100]),
        new THREE.VectorKeyframeTrack('.bones[センター].position', [0, 2], [0, 10, -5, 0, 10, -5]),
        new THREE.VectorKeyframeTrack('.bones[左足ＩＫ].position', [0, 2], [1, 1, -7, 1, 1, -3]),
    ]);
    const base = new THREE.AnimationClip('base', 1, [
        new THREE.QuaternionKeyframeTrack('.bones[head].quaternion', [0, 1], [0,0,0,1, 0,0,0,1]),
    ]);
    const mesh = { skeleton: { bones: [center, foot] } };
    const loader = { loadAnimation: (_file, _mesh, done) => done(clip) };
    const { motions } = await loadManifestMotions(loader, mesh, { walking: { file: 'walk.vmd', inPlace: true, strideScale: 0.5 } }, { walking: { clip: base } });
    assert.equal(motions.walking.clip.tracks.some(t => t.name.includes('全ての親')), false);
    assert.deepEqual(Array.from(motions.walking.clip.tracks.find(t => t.name.includes('左足')).values), [1,1,-1,1,1,1]);
    assert.ok(motions.walking.clip.tracks.some(t => t.name.includes('head')));
});

test('missing optional VMD is reported without discarding a successfully loaded motion', async () => {
    const loader = { loadAnimation: (file, _mesh, done, _progress, fail) => file === 'missing.vmd' ? fail(new Error('missing')) : done(new THREE.AnimationClip('ok', 1, [])) };
    const { motions, errors } = await loadManifestMotions(loader, {}, { idle: { file: 'ok.vmd' }, greet: { file: 'missing.vmd' } });
    assert.ok(motions.idle); assert.equal(errors[0].name, 'greet'); assert.equal(errors.length, 1);
});
