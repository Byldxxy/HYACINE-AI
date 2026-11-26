const { createHash } = require('node:crypto');
const { parseSessionMessages, parseSummaries } = require('./schemas');
const { applyMessageEdits, isSafeId, apiError } = require('./session-history-store');

function entityTag(value) {
    return '"' + createHash('sha256').update(JSON.stringify(value)).digest('base64url') + '"';
}
function checkReplacement(req, previous, hasData) {
    const tag = req.get('If-Match');
    if (!tag && hasData) throw apiError(428, '覆盖已有内容需要 GET 响应中的 ETag');
    if (tag && tag !== entityTag(previous)) throw apiError(409, '内容已更新，请刷新后重试');
}

function pageOptions(query) {
    if (query.offset === undefined && query.limit === undefined) return null;
    const number = (value, fallback, min, max) => {
        if (value === undefined) return fallback;
        if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(+value) || +value < min || +value > max) throw apiError(400, '无效的分页参数');
        return +value;
    };
    return { offset: number(query.offset, 0, 0, Number.MAX_SAFE_INTEGER), limit: number(query.limit, 12, 1, 100) };
}
function historyPage(memory, id, options) {
    const rows = memory.getSessionMessages(id);
    const lastUpdate = memory.getLastUpdate(id);
    if (!options) return { messages: rows, lastUpdate };
    const total = rows.length, limit = options.limit;
    const offset = options.offset < total ? options.offset : Math.max(0, Math.floor((total - 1) / limit) * limit);
    return { messages: rows.slice(offset, offset + limit), limit, offset, total, lastUpdate };
}

function registerHistoryApi(app, { memory, runtime, ready, log, sendManagementError }) {
    function handle(action) {
        return async (req, res) => {
            try {
                await ready;
                const id = req.params.sessionId;
                if (id !== undefined && !isSafeId(id)) throw apiError(400, '无效的会话编号');
                await action(req, res, id);
            } catch (error) {
                if ([400, 409, 428].includes(error.status)) return res.status(error.status).json({ success: false, error: error.message });
                sendManagementError(res, error);
            }
        };
    }

    app.get('/api/memory/list', handle((_req, res) => {
        res.json(Object.entries(memory.getSessions()).map(([id, rows]) => ({
            id, count: rows.length, lastUpdate: memory.getLastUpdate(id),
            preview: rows.length ? rows.at(-1).content.slice(0, 30) : '(空)',
        })));
    }));
    app.get('/api/memory/:sessionId', handle((req, res, id) => {
        const options = pageOptions(req.query);
        const page = historyPage(memory, id, options);
        if (options) return res.json(page);
        return res.set('ETag', entityTag(page.messages)).json(page.messages);
    }));
    function editMessages(replace) {
        return handle(async (req, res, id) => {
            const options = pageOptions(req.query);
            const current = runtime.token(id);
            await runtime.enqueue(id, async () => {
                if (!current()) throw apiError(409, '会话已重置，请刷新后重试');
                const previous = memory.getSessionMessages(id);
                const rows = replace ? parseSessionMessages(req.body) : applyMessageEdits(previous, req.body?.operations);
                if (replace) checkReplacement(req, previous, previous.length > 0);
                if (replace || req.body.operations.length) {
                    await memory.commitHistory(id, rows, memory.getSummaries()[id] ?? null, current);
                    log('会话 [' + id + '] 记录已更新');
                }
            });
            res.json({ success: true, ...historyPage(memory, id, options) });
        });
    }
    app.patch('/api/memory/:sessionId', editMessages(false));
    app.post('/api/memory/:sessionId', editMessages(true));
    app.delete('/api/memory/:sessionId', handle(async (_req, res, id) => {
        runtime.reset(id);
        const current = runtime.token(id);
        await runtime.enqueue(id, async () => {
            if (!current()) throw apiError(409, '会话已重置，请刷新后重试');
            await memory.commitHistory(id, null, null, current);
        });
        log('会话 [' + id + '] 已删除');
        res.json({ success: true });
    }));
    app.delete('/api/memory', handle(async (_req, res) => {
        runtime.reset();
        await memory.clearHistory();
        log('会话记录与摘要已清空');
        res.json({ success: true });
    }));

    app.get('/api/summary/:sessionId', handle((_req, res, id) => {
        const summary = memory.getSummaries()[id] || '';
        res.set('ETag', entityTag(summary)).json({ summary });
    }));
    function editSummary(replace) {
        return handle(async (req, res, id) => {
            const after = replace ? req.body?.summary : req.body?.after;
            if (typeof after !== 'string' || !replace && typeof req.body?.before !== 'string') throw apiError(400, '无效的会话摘要');
            const summary = parseSummaries({ [id]: after })[id];
            const current = runtime.token(id);
            await runtime.enqueue(id, async () => {
                if (!current()) throw apiError(409, '会话已重置，请刷新后重试');
                const previous = memory.getSummaries()[id] || '';
                if (replace) checkReplacement(req, previous, Boolean(previous));
                else if (req.body.before !== previous) throw apiError(409, '摘要已更新，请刷新后重试');
                if (summary !== previous) {
                    await memory.commitHistory(id, memory.getSessions()[id] ?? null, summary, current);
                    log('会话 [' + id + '] 摘要已更新');
                }
            });
            res.json({ success: true, summary });
        });
    }
    app.patch('/api/summary/:sessionId', editSummary(false));
    app.post('/api/summary/:sessionId', editSummary(true));
}
module.exports = { registerHistoryApi };
