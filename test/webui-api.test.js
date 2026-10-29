const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const api = fs.readFile(path.join(__dirname, '../src/lib/api.js'), 'utf8').then(source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));

test('API origin preserves deployed ports, supports Vite development and explicit overrides', async () => {
    const { resolveBackendOrigin } = await api;
    const location = { origin: 'https://example.test:8443' };
    assert.equal(resolveBackendOrigin({ location }), 'https://example.test:8443');
    assert.equal(resolveBackendOrigin({ location, development: true }), 'https://example.test:3001');
    assert.equal(resolveBackendOrigin({ location, development: true, override: 'https://api.example.test/bot/' }), 'https://api.example.test/bot');
    assert.equal(resolveBackendOrigin({ location: { origin: 'http://[::1]:5173' }, development: true }), 'http://[::1]:3001');
});

test('JSON requests encode objects, preserve cancellation and reject HTTP and business errors', async () => {
    const { requestJson } = await api;
    const controller = new AbortController();
    const result = await requestJson('/test', { method: 'POST', body: [{ fact: 'hello' }], signal: controller.signal, expectSuccess: true,
        fetchImpl: async (url, options) => {
            assert.equal(url, '/test'); assert.equal(options.body, '[{"fact":"hello"}]');
            assert.equal(options.headers.get('Content-Type'), 'application/json'); assert.equal(options.signal, controller.signal);
            return new Response('{"success":true}', { status: 200 });
        } });
    assert.equal(result.success, true);
    for (const [body, status, expected] of [
        ['{"error":"不允许保存"}', 403, /不允许保存/],
        ['{"success":false,"error":"写入失败"}', 200, /写入失败/],
        ['<html>error</html>', 500, /HTTP 500/],
        ['not-json', 200, /无效的 JSON/],
    ]) await assert.rejects(requestJson('/test', { fetchImpl: async () => new Response(body, { status }) }), expected);
    await assert.rejects(requestJson('/test', { expectSuccess: true, fetchImpl: async () => new Response('{}') }), /请求失败/);
    controller.abort();
    await assert.rejects(requestJson('/test', { signal: controller.signal, fetchImpl: async (_url, options) => { options.signal.throwIfAborted(); } }), { name: 'AbortError' });
});
