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
