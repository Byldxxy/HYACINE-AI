const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');

let vite;
let MotionController;
let removeSolverOwnedTracks;

before(async () => {
    const { createServer } = await import('vite');
    vite = await createServer({
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'silent',
    });
    ({ MotionController } = await vite.ssrLoadModule('/src/pet/runtime/MotionController.js'));
    ({ removeSolverOwnedTracks } = await vite.ssrLoadModule('/src/pet/runtime/loadMotions.js'));
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
