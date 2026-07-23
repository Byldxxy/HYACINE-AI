const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildImageGenerationContent,
    buildImageGenerationPlan,
    detectReferenceMode,
    generateImage,
    selectImageGenerationPrompt,
} = require('../lib/image-gen');

test('uses exact user wording unless prompt optimization is explicitly enabled', () => {
    const userRequest = '把照片里的手办换成你的样子，保留玻璃柜构图';
    const modelRewrite = 'A plastic action figure inside a glass showcase';

    assert.equal(
        selectImageGenerationPrompt({ optimizeImgPrompt: false }, userRequest, modelRewrite),
        userRequest
    );
    assert.equal(
        selectImageGenerationPrompt({}, userRequest, modelRewrite),
        userRequest
    );
    assert.equal(
        selectImageGenerationPrompt({ optimizeImgPrompt: true }, userRequest, modelRewrite),
        `${modelRewrite}, masterpiece, best quality`
    );
});

test('uses an outfit-and-pose reference contract for clothing transfer requests', () => {
    assert.equal(detectReferenceMode('换上这身衣服'), 'outfit');
    assert.equal(detectReferenceMode('keep the same pose'), 'general');

    const plan = buildImageGenerationPlan(
        '换上这身衣服',
        'LOCAL_BASE64',
        ['data:image/jpeg;base64,OUTFIT_REFERENCE']
    );
    const content = plan.content;
    const instructions = content.filter(part => part.type === 'text').map(part => part.text).join('\n');

    assert.equal(plan.pipeline, 'multi-source');
    assert.equal(plan.referenceMode, 'outfit');
    assert.deepEqual(plan.imageOrder, ['primary-composition', 'character-identity']);
    assert.match(instructions, /服装的版型、材质、颜色、纹理和配饰/);
    assert.match(instructions, /角色身份参考.*只提供面部、发型、发色、瞳色和标志性头饰/s);
    assert.match(instructions, /不提供姿势、构图、背景、服装或身体比例/);
    assert.match(instructions, /自然、均衡、非 Q 版的二次元比例/);
    assert.match(instructions, /禁止换头、换脸、照片拼贴、局部粘贴或复制原图像素/);
    assert.match(instructions, /先依据“主构图参考”确定姿势和画面结构/);
    assert.match(instructions, /不得退回身份参考图的原始姿势/);
});

test('labels the local image as base and chat images as references', () => {
    const plan = buildImageGenerationPlan(
        '站在海边，沿用参考图构图',
        'LOCAL_BASE64',
        [
            'data:image/jpeg;base64,CHAT_REFERENCE',
            'data:image/jpeg;base64,SUPPLEMENTARY_REFERENCE',
        ]
    );
    const content = plan.content;

    const imageParts = content.filter(part => part.type === 'image_url');
    const instructions = content.filter(part => part.type === 'text').map(part => part.text).join('\n');

    assert.equal(imageParts.length, 3);
    assert.equal(imageParts[0].image_url.url, 'data:image/jpeg;base64,CHAT_REFERENCE');
    assert.equal(imageParts[1].image_url.url, 'data:image/png;base64,LOCAL_BASE64');
    assert.equal(imageParts[2].image_url.url, 'data:image/jpeg;base64,SUPPLEMENTARY_REFERENCE');
    assert.deepEqual(plan.imageOrder, ['primary-composition', 'character-identity', 'supplementary']);
    assert.match(instructions, /【主构图参考】/);
    assert.match(instructions, /【角色身份参考】/);
    assert.match(instructions, /【补充参考 1】/);
    assert.match(instructions, /不得覆盖主构图或角色身份/);
    assert.match(instructions, /不同图片只控制指定属性/);
    assert.match(instructions, /站在海边/);
});

test('builds separate plans for identity-only and reference-only inputs', () => {
    const identityPlan = buildImageGenerationPlan('换一个站姿', 'LOCAL_BASE64');
    assert.equal(identityPlan.pipeline, 'identity-only');
    assert.deepEqual(identityPlan.imageOrder, ['character-identity']);
    assert.match(identityPlan.content[0].text, /不要照搬参考图原姿势/);

    const referencePlan = buildImageGenerationPlan(
        '换上这件外套',
        null,
        ['data:image/jpeg;base64,REFERENCE']
    );
    assert.equal(referencePlan.pipeline, 'reference-only');
    assert.equal(referencePlan.referenceMode, 'outfit');
    assert.deepEqual(referencePlan.imageOrder, ['primary-composition']);
    assert.match(referencePlan.content[0].text, /主要服装、姿势与构图参考/);
});

test('keeps text-only generation behavior when no images are available', () => {
    assert.deepEqual(buildImageGenerationContent('一片花海'), [
        { type: 'text', text: '请画一幅图：一片花海。请直接返回图片链接。' },
    ]);
});

test('requires explicit image provider and model configuration', async () => {
    await assert.rejects(
        generateImage({ apiKey: 'key', imageModel: 'image-model' }, 'scene'),
        /生图 API Endpoint/
    );
    await assert.rejects(
        generateImage({ apiEndpoint: 'https://example.com/v1', apiKey: 'key' }, 'scene'),
        /生图模型/
    );
});

test('serializes the primary composition image before the identity image', async (t) => {
    const originalFetch = global.fetch;
    let payload;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async (_url, options) => {
        payload = JSON.parse(options.body);
        return new Response(JSON.stringify({
            choices: [{ message: { content: 'https://example.com/generated.png' } }],
        }), { headers: { 'content-type': 'application/json' } });
    };

    await generateImage(
        {
            imageEndpoint: 'https://example.com/v1',
            apiKey: 'key',
            imageModel: 'image-model',
        },
        '沿用参考图姿势',
        'LOCAL_BASE64',
        ['data:image/jpeg;base64,PRIMARY_REFERENCE']
    );

    const imageParts = payload.messages[0].content.filter(part => part.type === 'image_url');
    assert.equal(imageParts[0].image_url.url, 'data:image/jpeg;base64,PRIMARY_REFERENCE');
    assert.equal(imageParts[1].image_url.url, 'data:image/png;base64,LOCAL_BASE64');
});
