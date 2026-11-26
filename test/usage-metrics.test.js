const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { createUsageMetrics } = require('../lib/usage-metrics');

test('counts unreported usage, restores partial days and expires old aggregates', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-usage-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    let clock = new Date(2026, 10, 20, 12).getTime();
    const options = { file: path.join(dir, 'usage.json'), now: () => clock };
    const metrics = createUsageMetrics(options);
    const task = metrics.start('continuation', 'group_1', clock - 60);
    await task.model(async () => { clock += 50; return { choices: [] }; });
    task.finish('silent'); task.finish('sent');
    await metrics.flush();
    const restored = createUsageMetrics(options); await restored.load();
    const [row] = restored.snapshot().rows;
    assert.equal(row.turns, 1); assert.equal(row.silent, 1); assert.equal(row.sent, 0);
    assert.equal(row.calls, 1); assert.equal(row.unknownUsage, 1);
    assert.equal(row.modelMs, 50); assert.equal(row.queueMs, 60);
    clock = new Date(2026, 10, 27, 12).getTime();
    assert.deepEqual(restored.snapshot().rows, []);
});
