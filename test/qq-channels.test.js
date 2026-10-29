const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { challenge, verifyCallback, signingKey, createOfficialBot, normalizeOfficialEvent } = require('../lib/qq-official');
const { normalizeMessage } = require('../lib/message-chain');
const { rememberMember, memberContext } = require('../lib/group-social');
const { createConfigManager } = require('../lib/config');
const { normalizeBotConfig } = require('../lib/schemas');
const { createOneBotClient } = require('../lib/onebot-client');
const { createQQTransport } = require('../lib/qq-transport');
const config = { qqProvider: 'qqbot', qqBotAppId: '123', qqBotSecret: 'test-secret' };
const event = (id = 'msg-1') => ({ op: 0, t: 'GROUP_AT_MESSAGE_CREATE', d: { id, group_openid: 'GROUPabc', author: { member_openid: 'USERabc', username: '群友' }, content: '叫我白玉楼', timestamp: new Date().toISOString() } });
const response = data => ({ ok: true, status: 200, json: async () => data });

test('QQ signature matches official published challenge vector', () => {
    assert.deepEqual(challenge('DG5g3B4j9X2KOErG', { plain_token: 'Arq0D5A61EgUu4OxUvOp', event_ts: '1725442341' }), {
        plain_token: 'Arq0D5A61EgUu4OxUvOp', signature: '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706',
    });
});
test('callback verification preserves raw bytes and rejects tampering, malformed signature and stale timestamp', () => {
    const raw = Buffer.from('{ "op": 0, "d":{} }'), timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.sign(null, Buffer.concat([Buffer.from(timestamp), raw]), signingKey(config.qqBotSecret)).toString('hex');
    assert.equal(verifyCallback(config.qqBotSecret, raw, timestamp, signature), true);
    assert.equal(verifyCallback(config.qqBotSecret, Buffer.from('{}'), timestamp, signature), false);
    assert.equal(verifyCallback(config.qqBotSecret, raw, timestamp, '123'), false);
    assert.equal(verifyCallback(config.qqBotSecret, raw, timestamp, signature, Date.now() + 400000), false);
});
test('official OpenIDs survive message chain and member memory without colliding with OneBot identities', () => {
    const message = normalizeMessage(normalizeOfficialEvent(event(), config));
    assert.equal(message.sessionId, 'group_qbot_123_live_GROUPabc');
    assert.equal(message.senderId, 'qbot_123_live_USERabc');
    assert.equal(message.atMe, true);
    const facts = []; rememberMember(facts, message);
    assert.deepEqual(memberContext(facts, [], message.sessionId)[0].aliases, ['白玉楼']);
    assert.equal(normalizeMessage({ ...normalizeOfficialEvent(event(), config), channel: undefined }), null);
    assert.notEqual(normalizeMessage(normalizeOfficialEvent(event(), { ...config, qqBotSandbox: true })).sessionId, message.sessionId);
});
test('C2C and other-member mentions retain official identities; unsupported events are ignored', () => {
    const incoming = event(); incoming.d.mentions = [{ member_openid: 'OTHER' }];
    incoming.d.attachments = [{ content_type: 'image/png', url: 'https://example.com/a.png' }];
    const m = normalizeMessage(normalizeOfficialEvent(incoming, config));
    assert.ok(m.mentions.includes('qbot_123_live_OTHER')); assert.equal(m.imageCount, 1);
    assert.match(m.contentText, /ID:qbot_123_live_OTHER/);
    assert.equal(normalizeOfficialEvent({ op: 0, t: 'MESSAGE_DELETE', d: {} }, config), null);
    assert.equal(normalizeOfficialEvent({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'm', author: { user_openid: 'user1' }, content: 'hi' } }, config).message_type, 'private');
});
test('duplicate callbacks suppressed; reply sequence and target belong to each original event', async () => {
    const requests = [];
    const adapter = createOfficialBot({ getConfig: () => config, fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body); requests.push({ url, body });
        return response(url.endsWith('getAppAccessToken') ? { access_token: 'token', expires_in: 7200 } : { id: `sent-${requests.length}` });
    } });
    const first = adapter.accept(event()), second = adapter.accept(event('msg-2'));
    assert.equal(adapter.accept(event()), null);
    const send = item => item.transport.sendOfficial('回复', 'group', item.event.user_id, item.event.group_id);
    await send(first); await send(second); await send(first);
    assert.deepEqual(requests.filter(r => r.url.endsWith('/messages')).map(r => [r.body.msg_id, r.body.msg_seq]), [['msg-1', 1], ['msg-2', 1], ['msg-1', 2]]);
    assert.equal(requests.filter(r => r.url.endsWith('getAppAccessToken')).length, 1);
    await assert.rejects(first.transport.sendOfficial('wrong', 'group', first.event.user_id, 'other'), /目标不匹配/);
    adapter.reset(); await assert.rejects(send(first), /切换/);
});
test('official image delivery uploads without proactive send then acknowledges resulting message', async () => {
    const bodies = [];
    const adapter = createOfficialBot({ getConfig: () => config, fetchImpl: async (url, options) => {
        bodies.push(JSON.parse(options.body));
        return response(url.endsWith('getAppAccessToken') ? { access_token: 'token', expires_in: 7200 } : url.endsWith('/files') ? { file_info: 'FILE' } : { id: 'message' });
    } });
    const { transport, event: e } = adapter.accept(event());
    const result = await createQQTransport().sendToQQ(transport, [{ type: 'image', data: { file: 'base64://aGVsbG8=' } }], 'group', e.user_id, e.group_id);
    assert.equal(result.messageId, 'message');
    assert.equal(bodies[1].srv_send_msg, false); assert.equal(bodies[1].file_data, 'aGVsbG8=');
    assert.equal(bodies[2].media.file_info, 'FILE'); assert.equal(bodies[2].msg_id, 'msg-1');
});
test('ambiguous official send is never retried and tokens are not included in errors', async () => {
    let sends = 0;
    const adapter = createOfficialBot({ getConfig: () => config, fetchImpl: async url => {
        if (url.endsWith('getAppAccessToken')) return response({ access_token: 'SECRET_TOKEN', expires_in: 7200 });
        sends++; throw new Error('SECRET_TOKEN');
    } });
    const { event: e, transport } = adapter.accept(event());
    await assert.rejects(transport.sendOfficial('hi', 'group', e.user_id, e.group_id), error => error.code === 'delivery-unknown' && !error.message.includes('SECRET_TOKEN'));
    assert.equal(sends, 1);
});
test('provider config validates URLs and defaults old configurations to NapCat', async t => {
    assert.equal(normalizeBotConfig({}).qqProvider, 'napcat');
    for (const url of ['https://example.com', 'ws://user:secret@example.com', 'ws://example.com?access_token=secret']) assert.throws(() => normalizeBotConfig({ snowlumaUrl: url }));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-channel-config-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const manager = createConfigManager({ configFile: path.join(dir, 'config.json') });
    await manager.loadConfig();
    await manager.saveConfig({ ...config, onebotToken: 'one', snowlumaToken: 'snow' });
    await manager.saveConfig({ ...config, qqBotSecret: '***', onebotToken: '***', snowlumaToken: '***', charName: '风堇' });
    assert.equal(manager.getConfig().qqBotSecret, config.qqBotSecret);
    assert.equal(manager.getConfig().snowlumaToken, 'snow');
    await manager.saveConfig({ ...manager.getConfig(), qqBotSecret: '' }); assert.equal(manager.getConfig().qqBotSecret, '');
});
test('SnowLuma authenticates via header, reconnects and cancels old reconnect timers on stop', () => {
    const sockets = [], scheduled = [], cancelled = [];
    class Socket extends EventEmitter { constructor(url, options) { super(); this.url = url; this.options = options; sockets.push(this); } send(value) { this.packet = JSON.parse(value); } terminate() { this.emit('close'); } }
    const client = createOneBotClient({ WebSocketImpl: Socket, attach() {}, schedule: callback => { scheduled.push(callback); return callback; }, cancel: timer => cancelled.push(timer) });
    client.start({ url: 'ws://localhost:3002/', token: 'secret' });
    sockets[0].emit('open'); assert.equal(sockets[0].options.headers.Authorization, 'Bearer secret');
    assert.equal(sockets[0].packet.action, 'get_login_info');
    sockets[0].emit('close'); assert.equal(scheduled.length, 1);
    scheduled[0](); assert.equal(sockets.length, 2);
    sockets[1].emit('close'); client.stop(); assert.ok(cancelled.includes(scheduled[1]));
    scheduled[1](); assert.equal(sockets.length, 2);
});
