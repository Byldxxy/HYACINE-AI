const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildVisionContent,
    extractImageSources,
    fetchImageAsDataUrl,
    stripImageSegments,
} = require('../lib/vision');

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
        await fetchImageAsDataUrl('https://example.com/a.png', fakeFetch),
        'data:image/png;base64,AQID'
    );
});

test('rejects non-image responses', async () => {
    const fakeFetch = async () => new Response('not an image', {
        headers: { 'content-type': 'text/plain' },
    });

    await assert.rejects(
        fetchImageAsDataUrl('https://example.com/a.png', fakeFetch),
        /非图片内容/
    );
});
