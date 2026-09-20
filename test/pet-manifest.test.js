const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.join(__dirname, '..', 'public', 'pet-manifest.example.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

test('pet manifest example defines the runtime contract without bundling assets', () => {
    assert.equal(manifest.version, 2);
    assert.match(manifest.model, /^\/models\/.+\.pmx$/);
    assert.equal(manifest.states.idle.motion, 'idle');
    assert.equal(manifest.interactions.head.motion, 'tapHead');
    assert.equal(manifest.events.thinking.motion, 'thinking');
});

test('external VMD resources remain optional in the public example', () => {
    assert.deepEqual(manifest.motions, {});
    assert.equal(manifest.states.climbing.motion, 'climbing');
    assert.equal(manifest.states.walking.motion, 'walking');
});
