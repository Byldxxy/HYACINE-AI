const { test } = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../src/lib/editorDrafts.mjs');

test('config PATCH omits display defaults and detects changes behind an identical secret mask', async () => {
    const { configPatch, mergeConfig } = await helpers;
    const baseline = { voiceApiKey: '***', shortMem: 50, modelName: 'a' };
    const server = { voiceApiKey: '***', modelName: 'a', _secretVersions: { voiceApiKey: 'old' } };
    const draft = { ...baseline, shortMem: 20, voiceApiKey: 'new' };
    assert.deepEqual(configPatch(draft, baseline, server), { changes: { shortMem: 20, voiceApiKey: 'new' }, base: { voiceApiKey: '***' }, secretVersions: { voiceApiKey: 'old' } });
    const remote = { ...baseline, modelName: 'b' };
    const result = mergeConfig({ draft, previous: baseline, oldServer: server, remote, server: { _secretVersions: { voiceApiKey: 'updated' } } });
    assert.deepEqual(result, { config: { ...draft, modelName: 'b' }, conflicts: ['voiceApiKey'] });
    const acknowledged = mergeConfig({ draft: { ...draft, shortMem: 25 }, previous: draft, remote: { ...remote, shortMem: 20 }, acknowledge: true });
    assert.deepEqual(acknowledged.config, { ...remote, shortMem: 25 });
});

test('fact refresh preserves unrelated learning and staged rows, and flags conflicting edits or deletes', async () => {
    const { mergeRows, rowOperations } = await helpers;
    const a = { rowId: 'a', fact: 'old', enabled: true }, b = { rowId: 'b', fact: 'delete' }, c = { rowId: 'c', fact: 'newly learnt' };
    const edited = { ...a, fact: 'mine' };
    assert.deepEqual(rowOperations([a, b], [edited]), [{ id: 'a', before: a, after: edited }, { id: 'b', before: b, after: null }]);
    const unrelated = mergeRows([a, b], [edited], [c, { ...a, enabled: false }, b]);
    assert.deepEqual(unrelated, { rows: [c, { ...edited, enabled: false }], conflicts: [] });
    const remote = [c, { ...a, fact: 'theirs' }, { ...b, fact: 'changed' }];
    const merged = mergeRows([a, b], [edited], remote);
    assert.deepEqual(merged, { rows: [c, edited], conflicts: ['a', 'b'] });
    assert.deepEqual(mergeRows(remote, merged.rows, remote, { conflicts: merged.conflicts }), merged);
    assert.deepEqual(mergeRows([a], [edited], []), { rows: [edited], conflicts: ['a'] });
});

test('paged history retains edits across pages and requires a full snapshot to recognize a trimmed row', async () => {
    const { reconcileMessageEdits, pendingMessageEdits } = await helpers;
    const edits = { a: { id: 'a', before: 'old', after: 'mine' }, b: { id: 'b', before: 'delete', after: null } };
    assert.deepEqual(reconcileMessageEdits(edits, [{ rowId: 'unrelated', content: 'later' }]), edits);
    const latest = [{ rowId: 'a', content: 'theirs' }];
    assert.deepEqual(reconcileMessageEdits(edits, latest, true), { a: { ...edits.a, before: 'theirs', conflict: true } });
    assert.deepEqual(reconcileMessageEdits({ a: edits.a }, [], true).a, { ...edits.a, before: null, conflict: true });
    assert.deepEqual(pendingMessageEdits(edits, { b: edits.b }), { a: { id: 'a', before: 'mine', after: 'old' } });
    assert.deepEqual(pendingMessageEdits(edits, { ...edits, a: { ...edits.a, after: 'newer' } }), { a: { id: 'a', before: 'mine', after: 'newer' } });
});
