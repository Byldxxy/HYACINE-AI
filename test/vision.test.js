const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildVisionContent,
    extractImageSources,
    fetchImageAsDataUrl,
    isNonPublicIpAddress,
    stripImageSegments,
    validateRemoteImageUrl,
} = require('../lib/vision');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('builds OpenAI-compatible multimodal user content', () => {
    assert.deepEqual(buildVisionContent('这是什么？', ['data:image/png;base64,AQID']), [
        { type: 'text', text: '这是什么？' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ]);
});

test('extracts and deduplicates structured and CQ image URLs', () => {
    const message = {
        raw_message: '看看[CQ:image,file=cache.jpg,url=https://example.com/a.jpg]',
        message: [
            { type: 'text', data: { text: '看看' } },
            { type: 'image', data: { file: 'cache.jpg', url: 'https://example.com/a.jpg' } },
        ],
    };

    assert.deepEqual(extractImageSources(message), ['https://example.com/a.jpg']);
});

test('decodes escaped CQ image URL values', () => {
    const message = {
        raw_message: '[CQ:image,url=https://example.com/a.jpg?x=1&#44;y=2]',
    };

    assert.deepEqual(extractImageSources(message), ['https://example.com/a.jpg?x=1,y=2']);
});

test('strips image segments while retaining user text', () => {
    assert.equal(stripImageSegments('助手，看看 [CQ:image,file=a.jpg,url=https://example.com/a.jpg]'), '助手，看看');
});

test('converts a fetched image to a data URL', async () => {
    const fakeFetch = async () => new Response(Buffer.from([1, 2, 3]), {
        headers: { 'content-type': 'image/png', 'content-length': '3' },
    });

    assert.equal(
        await fetchImageAsDataUrl('https://example.com/a.png', fakeFetch, publicLookup),
        'data:image/png;base64,AQID'
    );
});

test('rejects non-image responses', async () => {
    const fakeFetch = async () => new Response('not an image', {
        headers: { 'content-type': 'text/plain' },
    });

    await assert.rejects(
        fetchImageAsDataUrl('https://example.com/a.png', fakeFetch, publicLookup),
        /非图片内容/
    );
});

test('rejects local, private, link-local, and non-public image hosts', async () => {
    assert.equal(isNonPublicIpAddress('127.0.0.1'), true);
    assert.equal(isNonPublicIpAddress('192.168.1.20'), true);
    assert.equal(isNonPublicIpAddress('169.254.169.254'), true);
    assert.equal(isNonPublicIpAddress('::1'), true);
    assert.equal(isNonPublicIpAddress('93.184.216.34'), false);

    await assert.rejects(validateRemoteImageUrl('http://127.0.0.1/private.png'), /非公网 IP/);
    await assert.rejects(
        validateRemoteImageUrl('https://images.example/a.png', async () => [{ address: '10.0.0.5', family: 4 }]),
        /非公网 IP/
    );
    await assert.rejects(validateRemoteImageUrl('https://localhost/a.png'), /本机或局域网/);
});

test('revalidates every image redirect before following it', async () => {
    let requestCount = 0;
    const redirectFetch = async () => {
        requestCount += 1;
        return new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data' },
        });
    };

    await assert.rejects(
        fetchImageAsDataUrl('https://example.com/a.png', redirectFetch, publicLookup),
        /非公网 IP/
    );
    assert.equal(requestCount, 1);
});
