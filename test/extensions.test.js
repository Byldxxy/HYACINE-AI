const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createExtensions } = require('../lib/extensions');
const { createBilibili } = require('../lib/extensions/bilibili');
const { normalizeBotConfig } = require('../lib/schemas');
const image = { id: 'smile', meaning: '开心', scope: 'group_1', data: 'data:image/png;base64,aGVsbG8=' };
const json = value => new Response(JSON.stringify(value));
test('disabled extensions do no network work; scoped stickers and cooldown are isolated', async () => {
    const config = {}; let time = 1000;
    const ext = createExtensions({ getConfig: () => config, now: () => time, fetcher: () => { throw new Error('unexpected network'); } });
    assert.equal(await ext.context({ text: 'BV1d8pU6xEZX', sessionId: 'group_1' }, () => true), '');
    Object.assign(config, { enableStickers: true, stickers: [image], stickerCooldown: 30 });
    assert.equal(ext.select('好 [[sticker:smile]]', 'group_2').sticker, undefined);
    assert.equal(ext.select('好 [[sticker:fake]]', 'group_1').text, '好');
    assert.ok(ext.reserve('group_1', 'smile'));
    assert.equal(ext.reserve('group_1', 'smile'), null);
    time += 30001; assert.ok(ext.reserve('group_1', 'smile'));
    config.enableStickers = false;
    assert.equal(ext.reserve('group_1', 'smile'), null);
});
test('Bili metadata is cached and never fetches unapproved subtitle hosts', async () => {
    const calls = [];
    const bili = createBilibili({ fetcher: async url => {
        calls.push(url);
        if (url.includes('/view?')) return json({ code: 0, data: { title: '测试', aid: 1, cid: 2 } });
        return json({ data: { subtitle: { subtitles: [{ subtitle_url: 'http://127.0.0.1/secret' }] } } });
    } });
    const text = await bili('https://www.bilibili.com/video/BV1d8pU6xEZX', AbortSignal.timeout(1000));
    assert.match(text, /"subtitle":null/);
    assert.match(text, /不得声称看过/);
    await bili('BV1d8pU6xEZX', AbortSignal.timeout(1000));
    assert.equal(calls.length, 2);
});
test('public subtitles are bounded and included as untrusted evidence', async () => {
    const bili = createBilibili({ fetcher: async url => url.includes('/view?') ? json({ code: 0, data: { aid: 1, cid: 2 } }) : url.includes('/v2?') ? json({ data: { subtitle: { subtitles: [{ subtitle_url: '//aisubtitle.hdslb.com/a.json' }] } } }) : json({ body: [{ content: '字幕内容' }] }) });
    assert.match(await bili('BV1d8pU6xEZX', AbortSignal.timeout(1000)), /字幕内容/);
});
test('Bili errors fail open for chat; disabled/invalidated turns discard enrichment', async () => {
    let config = { enableBilibili: true };
    const ext = createExtensions({ getConfig: () => config, fetcher: async () => { throw new Error('offline'); } });
    assert.equal(await ext.context({ text: 'BV1d8pU6xEZX' }, () => true), '');
    const ext2 = createExtensions({ getConfig: () => config, fetcher: async () => { config = {}; return json({ code: 0, data: {} }); } });
    assert.equal(await ext2.context({ text: 'BV1d8pU6xEZX' }, () => false), '');
});
test('configuration rejects arbitrary media sources, duplicate IDs and excessive library size', () => {
    assert.throws(() => normalizeBotConfig({ stickers: [{ ...image, data: 'file:///etc/passwd' }] }));
    assert.throws(() => normalizeBotConfig({ stickers: [image, image] }));
    assert.throws(() => normalizeBotConfig({ stickers: Array.from({ length: 13 }, (_, i) => ({ ...image, id: `a${i}` })) }));
    assert.equal(normalizeBotConfig({ stickers: [image] }).stickers.length, 1);
});

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStickerStore } = require('../lib/extensions/sticker-store');
const { resolveVideo } = require('../lib/extensions/bilibili');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('media store serializes writes, deduplicates per scope and survives reload', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyacine-stickers-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const store = createStickerStore(dir); await store.load();
    const [a,b,c] = await Promise.all([store.add({ data: png, meaning: '开心', scope: 'group_1' }), store.add({ data: png, meaning: '开心', scope: 'group_1' }), store.add({ data: png, meaning: '开心', scope: 'group_2' })]);
    assert.equal(a.id,b.id); assert.notEqual(a.id,c.id); assert.equal(store.list().length,2);
    await assert.rejects(store.add({ data: image.data, meaning: '假图片' }), /不是受支持/);
    await store.update(a.id, { meaning: '笑死', scope: 'group_1' });
    const reloaded = createStickerStore(dir); await reloaded.load(); assert.equal(reloaded.list()[0].meaning,'笑死');
    assert.equal((await reloaded.image(a.id)).mime, 'image/png');
    await reloaded.remove(a.id); await assert.rejects(reloaded.image(a.id), /不存在/);
    assert.equal(reloaded.list().length,1);
});
test('short links only follow bounded Bilibili redirects and preserve page', async () => {
    const signal = AbortSignal.timeout(1000);
    assert.deepEqual(await resolveVideo('https://b23.tv/abc', signal, async () => new Response(null, { status:302, headers:{ location:'https://www.bilibili.com/video/BV1d8pU6xEZX?p=2' } })), { bvid:'BV1d8pU6xEZX',page:2 });
    await assert.rejects(resolveVideo('https://b23.tv/abc', signal, async () => new Response(null,{ status:302,headers:{ location:'http://127.0.0.1/private' } })),/拒绝/);
    let count=0; await assert.rejects(resolveVideo('https://b23.tv/abc', signal, async () => { count++; return new Response(null,{status:302,headers:{location:'https://b23.tv/loop'}}); }),/过多/); assert.equal(count,3);
});
test('different video pages use different subtitle IDs and cache entries', async () => {
    const calls=[];
    const bili=createBilibili({fetcher:async url=>{calls.push(url); return url.includes('/view?') ? json({code:0,data:{aid:1,cid:10,pages:[{page:1,cid:10},{page:2,cid:20}]}}) : json({data:{}});}});
    await bili('BV1d8pU6xEZX?p=1',AbortSignal.timeout(1000));
    await bili('BV1d8pU6xEZX?p=2',AbortSignal.timeout(1000));
    assert.ok(calls.some(url=>url.endsWith('cid=20'))); assert.equal(calls.length,4);
});
