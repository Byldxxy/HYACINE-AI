const test = require('node:test');
const assert = require('node:assert/strict');
const {
    compareSignatures,
    getTitleMatchScore,
    normalizeSourceName,
    selectPrimaryDisplaySource,
    selectWindowSource,
} = require('../electron/desktop-observer');

test('selects a macOS window source by native window ID before title matching', () => {
    const sources = [
        { id: 'window:101:0', name: 'Other window' },
        { id: 'window:202:0', name: 'Different title' },
    ];
    assert.equal(selectWindowSource(sources, {
        windowId: 202,
        title: 'Current window',
        ownerName: 'Code',
    }), sources[1]);
});

test('falls back to normalized title matching when a native ID is unavailable', () => {
    const sources = [{ id: 'window:101:0', name: 'README.md - HYACINE-AI' }];
    assert.equal(normalizeSourceName('README.md — HYACINE-AI'), 'readme.md - hyacine-ai');
    assert.equal(selectWindowSource(sources, {
        title: 'README.md — HYACINE-AI',
        ownerName: 'Code',
    }), sources[0]);
});

test('matches a source whose title omits part of the frontmost app title', () => {
    const source = { id: 'window:101:0', name: 'Visual Studio Code' };
    const windowInfo = {
        title: 'main.js - my-bot-ui - Visual Studio Code',
        ownerName: 'Visual Studio Code',
    };
    assert.equal(getTitleMatchScore(source.name, windowInfo), 1);
    assert.equal(selectWindowSource([source], windowInfo), source);
});

test('selects the primary display source without relying on a window title', () => {
    const sources = [
        { id: 'screen:2:0', display_id: '2' },
        { id: 'screen:1:0', display_id: '1' },
    ];
    assert.equal(selectPrimaryDisplaySource(sources, '1'), sources[1]);
});

test('measures signature differences as a 0 to 1 ratio', () => {
    assert.equal(compareSignatures([0, 255], [0, 255]), 0);
    assert.equal(compareSignatures([0, 0], [255, 255]), 1);
    assert.equal(compareSignatures(null, [0, 0]), 1);
});

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function observerHarness(overrides = {}) {
    const { createDesktopObserver } = require('../electron/desktop-observer');
    const frames = [], statuses = [], reads = [];
    const thumbnail = {
        isEmpty: () => false,
        resize: () => ({ toBitmap: () => Buffer.from([0, 0, 0, 255]) }),
        toJPEG: () => Buffer.from('synthetic-test-frame'),
    };
    const sources = [{ display_id: '1', thumbnail }];
    const observer = createDesktopObserver({
        sendFrame: frame => frames.push(frame),
        onStatus: state => statuses.push(state.status),
        services: {
            getActiveApplication: async () => { reads.push('activity'); return { ownerName: 'Editor' }; },
            desktopCapturer: { getSources: async () => { reads.push('capture'); return sources; } },
            powerMonitor: { getSystemIdleTime: () => 0 },
            screen: { getPrimaryDisplay: () => ({ id: 1 }) },
            ...overrides,
        },
    });
    observer.updateConfig({ enableDesktopAwareness: true, desktopAwarenessInterval: 120 });
    return { observer, frames, statuses, reads, sources };
}

test('a hidden pet cancels an in-flight activity query before capture starts', async () => {
    const activity = deferred();
    const h = observerHarness({ getActiveApplication: () => activity.promise });
    const pending = h.observer.requestTest();
    h.observer.setSuspended(true);
    activity.resolve({ ownerName: 'Editor' });
    assert.equal((await pending).ok, false);
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.frames, []);
    assert.equal(h.statuses.at(-1), 'pet-hidden');
});

test('disabling, pausing or stopping during capture prevents sending the stale frame', async () => {
    for (const action of ['disable', 'pause', 'stop']) {
        const capture = deferred(), started = deferred();
        const h = observerHarness({ desktopCapturer: { getSources: () => { started.resolve(); return capture.promise; } } });
        const pending = h.observer.requestTest();
        await started.promise;
        if (action === 'disable') h.observer.updateConfig({ enableDesktopAwareness: false });
        if (action === 'pause') h.observer.togglePaused();
        if (action === 'stop') h.observer.stop();
        const statusAfterCancel = h.statuses.at(-1);
        capture.resolve(h.sources);
        assert.equal((await pending).ok, false, action);
        assert.deepEqual(h.frames, [], action);
        assert.equal(h.statuses.at(-1), statusAfterCancel, action);
    }
});

test('stop and restart retain the scan lock until the cancelled native query completes', async () => {
    const capture = deferred(), started = deferred();
    let captures = 0;
    const h = observerHarness({ desktopCapturer: { getSources: () => { captures++; started.resolve(); return capture.promise; } } });
    const pending = h.observer.requestTest();
    await started.promise;
    h.observer.stop();
    h.observer.start();
    try {
        assert.equal((await h.observer.requestTest()).ok, false);
        assert.equal(captures, 1);
        capture.resolve(h.sources);
        assert.equal((await pending).ok, false);
        assert.equal((await h.observer.requestTest()).ok, true);
        assert.equal(captures, 2);
        assert.equal(h.frames.length, 1);
    } finally {
        h.observer.stop();
    }
});

test('sampling interval avoids redundant native reads while manual tests remain immediate', async () => {
    const h = observerHarness();
    assert.equal((await h.observer.requestTest()).ok, true);
    assert.equal((await h.observer.scan()).ok, false);
    assert.deepEqual(h.reads, ['activity', 'capture']);
    assert.equal((await h.observer.requestTest()).ok, true);
    assert.equal(h.frames.length, 2);
});
