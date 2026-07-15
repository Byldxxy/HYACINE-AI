const test = require('node:test');
const assert = require('node:assert/strict');
const { buildImageGenerationContent } = require('../lib/image-gen');

test('labels the local image as base and chat images as references', () => {
    const content = buildImageGenerationContent(
        '站在海边，沿用参考图构图',
        'LOCAL_BASE64',
        ['data:image/jpeg;base64,CHAT_REFERENCE']
    );

    const imageParts = content.filter(part => part.type === 'image_url');
    const instructions = content.filter(part => part.type === 'text').map(part => part.text).join('\n');

    assert.equal(imageParts.length, 2);
    assert.equal(imageParts[0].image_url.url, 'data:image/png;base64,LOCAL_BASE64');
    assert.equal(imageParts[1].image_url.url, 'data:image/jpeg;base64,CHAT_REFERENCE');
    assert.match(instructions, /图 1：角色基底图/);
    assert.match(instructions, /用户参考图/);
    assert.match(instructions, /角色身份以图 1 为最高优先级/);
    assert.match(instructions, /站在海边/);
});

test('keeps text-only generation behavior when no images are available', () => {
    assert.deepEqual(buildImageGenerationContent('一片花海'), [
        { type: 'text', text: '请画一幅图：一片花海。请直接返回图片链接。' },
    ]);
});
