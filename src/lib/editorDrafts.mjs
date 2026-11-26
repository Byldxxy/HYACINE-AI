// The baseline always mirrors the last server response. Local differences survive refresh and save.
export const equal = (left, right) => left === right || JSON.stringify(left) === JSON.stringify(right);
export const secretFields = ['apiKey', 'onebotToken', 'snowlumaToken', 'qqBotSecret', 'voiceApiKey'];

export function configPatch(form, baseline, server) {
    const changes = {}, base = {}, secretVersions = {};
    for (const key of Object.keys(form)) {
        if (equal(form[key], baseline[key])) continue;
        changes[key] = form[key];
        if (Object.hasOwn(server, key)) base[key] = server[key];
        if (secretFields.includes(key)) secretVersions[key] = server._secretVersions?.[key];
    }
    return { changes, base, secretVersions };
}

export function mergeConfig({ draft, previous, remote, oldServer, server, conflicts = [], acknowledge = false }) {
    const config = { ...remote }, unresolved = [];
    for (const key of Object.keys(draft)) {
        if (equal(draft[key], previous[key]) || equal(draft[key], remote[key])) continue;
        config[key] = draft[key];
        const changed = !equal(previous[key], remote[key]) || (secretFields.includes(key) && oldServer?._secretVersions?.[key] !== server?._secretVersions?.[key]);
        if (!acknowledge && (changed || conflicts.includes(key))) unresolved.push(key);
    }
    return { config, conflicts: unresolved };
}

export function rowOperations(baseline, draft) {
    const existing = new Map(baseline.map(item => [item.rowId, item]));
    const operations = [];
    for (const item of draft) {
        const old = existing.get(item.rowId);
        if (!old || !equal(old, item)) {
            operations.push({ id: item.rowId, ...(old && { before: old }), after: item });
        }
        existing.delete(item.rowId);
    }
    for (const old of existing.values()) operations.push({ id: old.rowId, before: old, after: null });
    return operations;
}

// Replay unsaved edits on the latest list, retaining new remote entries and their order.
export function mergeRows(baseline, draft, latest, { conflicts = [], acknowledge = false } = {}) {
    const remote = new Map(latest.map(item => [item.rowId, item]));
    const unresolved = new Set();
    for (const op of rowOperations(baseline, draft)) {
        const incoming = remote.get(op.id);
        if (equal(incoming, op.after ?? undefined)) continue;
        let conflict = conflicts.includes(op.id);
        if (incoming && op.before && op.after) {
            const merged = { ...incoming };
            for (const field of new Set([...Object.keys(op.before), ...Object.keys(op.after)])) {
                if (equal(op.before[field], op.after[field])) continue;
                if (!equal(incoming[field], op.after[field]) && !equal(incoming[field], op.before[field])) conflict = true;
                if (Object.hasOwn(op.after, field)) merged[field] = op.after[field];
                else delete merged[field];
            }
            remote.set(op.id, merged);
            if (equal(merged, incoming)) conflict = false;
        } else {
            conflict ||= !equal(incoming, op.before);
            if (op.after === null) remote.delete(op.id);
            else remote.set(op.id, op.after);
        }
        if (!acknowledge && conflict) unresolved.add(op.id);
    }
    return { rows: [...remote.values()], conflicts: [...unresolved] };
}

// Only rows returned by a page can be compared. A complete snapshot also confirms removals.
export function reconcileMessageEdits(edits, rows, complete = false) {
    const lookup = new Map(rows.map(row => [row.rowId, row.content]));
    const next = { ...edits };
    for (const op of Object.values(edits)) {
        if (!lookup.has(op.id) && !complete) continue;
        const content = lookup.get(op.id) ?? null;
        if (content === op.after) delete next[op.id];
        else if (content !== op.before) next[op.id] = { ...op, before: content, conflict: true };
    }
    return next;
}

// An edit reverted while its PATCH was in flight is still an edit against the acknowledged value.
export function pendingMessageEdits(submitted, current) {
    const pending = { ...current };
    for (const op of Object.values(submitted)) {
        const after = current[op.id] ? current[op.id].after : op.before;
        if (op.after === after) delete pending[op.id];
        else pending[op.id] = { id: op.id, before: op.after, after };
    }
    return pending;
}
