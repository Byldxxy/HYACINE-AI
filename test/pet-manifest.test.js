const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.join(__dirname, '..', 'public', 'pet-manifest.example.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

test('pet manifest example defines the runtime contract without bundling assets', () => {
    assert.equal(manifest.version, 1);
    assert.match(manifest.model, /^\/models\/.+\.pmx$/);
    assert.equal(manifest.motions.idle.loop, true);
    assert.equal(manifest.interactions.head.motion, 'tapHead');
    assert.equal(manifest.events.thinking.motion, 'thinking');
});

test('all configured motion files are VMD paths', () => {
    Object.values(manifest.motions).forEach(motion => {
        assert.match(motion.file, /^\/models\/motions\/.+\.vmd$/);
    });
});
