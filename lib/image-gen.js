/**
 * OpenAI-compatible 生图适配层。
 *
 * 此项目通过 chat/completions 形式调用能够返回图片的多模态模型，而不是固定厂商的
 * images API。角色底图和聊天参考图有明确分工：底图决定“是谁”，首张聊天图片决定
 * 姿势和构图。两者同时存在时优先发送构图参考图，避免兼容服务把第一张图隐式锁定
 * 为 img2img 姿势底图。调用方最终得到 URL 或纯 base64 两种统一结果。
 */

/** @typedef {import('../types').BotConfig} BotConfig */
/** @typedef {import('../types').ImageResult} ImageResult */

/**
 * 生成图片 - 调用外部生图 API
 * @param {Partial<BotConfig>} config - 全局配置对象
 * @param {string} promptTags - 图片描述提示词
 * @param {string|null} initImageBase64 - 本地角色基底图 base64 (可选)
 * @param {string[]} userReferenceImages - 当前聊天附带的参考图 Data URL
 * @returns {Promise<ImageResult>}
 */
function resolveChatCompletionsUrl(endpoint) {
    // 允许用户填写 API 根地址或完整 chat/completions 地址，避免重复拼接路径。
    const base = String(endpoint || '').replace(/\/$/, '');
    if (!base) throw new Error('未配置生图 API Endpoint');
    if (base.endsWith('/chat/completions')) return base;
    return `${base}/chat/completions`;
}

function selectImageGenerationPrompt(config, userRequest, modelSceneDescription) {
    const originalRequest = String(userRequest || '').trim();
    const optimizedDescription = String(modelSceneDescription || '').trim();

    // 主聊天模型始终参与生图意图识别，但只有明确开启优化时才允许它改写提示词。
    // 关闭状态下绝不回退到模型输出，避免原始中文被静默翻译或扩写。
    if (config?.optimizeImgPrompt === true) {
        const prompt = optimizedDescription || originalRequest || 'selfie';
        return `${prompt}, masterpiece, best quality`;
    }
    return originalRequest || '自拍';
}

function detectReferenceMode(promptTags) {
    const prompt = String(promptTags || '');
    const outfitIntent = /(换上|穿上|试穿|这身|这套|同款|服装|衣服|衣着|裙子|裙装|外套|制服|套装)|\b(outfit|clothes|clothing|dress|shirt|coat|costume|wear|wearing)\b/i;
    return outfitIntent.test(prompt) ? 'outfit' : 'general';
}

function textPart(text) {
    return { type: 'text', text };
}

function imagePart(url) {
    return { type: 'image_url', image_url: { url } };
}

function buildMultiSourceContract(referenceMode) {
    const primaryAttributes = referenceMode === 'outfit'
        ? '姿势、肢体关系、手势、镜头、景别、构图，以及服装的版型、材质、颜色、纹理和配饰'
        : '姿势、肢体关系、手势、镜头、景别和整体构图，以及用户明确要求的场景或道具';
    return `【任务：多源参考完整重绘】
不同图片只控制指定属性，禁止把任一输入图整体当作输出底图：
1. “主构图参考”只提供${primaryAttributes}。
2. “角色身份参考”只提供面部、发型、发色、瞳色和标志性头饰，不提供姿势、构图、背景、服装或身体比例。
3. 人体比例需结合角色设定与参考姿势重新协调为自然、均衡、非 Q 版的二次元比例，不机械复制任一输入图的比例或透视失真。
4. 必须从头重绘完整人物和画面，将身份特征自然融合进主构图；禁止换头、换脸、照片拼贴、局部粘贴或复制原图像素。`;
}

function buildImageGenerationPlan(promptTags, initImageBase64 = null, userReferenceImages = []) {
    const prompt = String(promptTags || '').trim() || '自拍';
    const referenceMode = detectReferenceMode(prompt);
    const hasCharacterBase = Boolean(initImageBase64);
    const hasUserReferences = userReferenceImages.length > 0;

    if (hasCharacterBase && hasUserReferences) {
        const content = [
            textPart(buildMultiSourceContract(referenceMode)),
            textPart('【主构图参考】先以这张图建立新画面的姿势骨架、镜头和构图。'),
            imagePart(userReferenceImages[0]),
            textPart('【角色身份参考】随后只提取这张图的面部、发型、发色、瞳色和标志性头饰；严禁继承它的姿势和构图。'),
            imagePart(`data:image/png;base64,${initImageBase64}`),
        ];
        userReferenceImages.slice(1).forEach((dataUrl, index) => {
            content.push(
                textPart(`【补充参考 ${index + 1}】只补充用户要求的局部细节，不得覆盖主构图或角色身份。`),
                imagePart(dataUrl)
            );
        });
        content.push(textPart(`【执行】先依据“主构图参考”确定姿势和画面结构，再把“角色身份参考”的身份特征自然重绘到人物上。不得退回身份参考图的原始姿势。\n\n用户原始要求：${prompt}\n\n请只返回生成的图片链接。`));
        return {
            pipeline: 'multi-source',
            referenceMode,
            imageOrder: ['primary-composition', 'character-identity', ...userReferenceImages.slice(1).map(() => 'supplementary')],
            content,
        };
    }

    if (hasCharacterBase) {
        return {
            pipeline: 'identity-only',
            referenceMode,
            imageOrder: ['character-identity'],
            content: [
                textPart('【任务：角色参考重绘】以下图片只用于保持角色面部、发型、发色、瞳色、头饰和整体身份。根据用户要求重新设计姿势与构图，不要照搬参考图原姿势。人体比例保持自然均衡，禁止 Q 版、大头比例、拼贴或写实换脸。'),
                textPart('【角色身份参考】'),
                imagePart(`data:image/png;base64,${initImageBase64}`),
                textPart(`【执行】用户原始要求：${prompt}\n\n请只返回生成的图片链接。`),
            ],
        };
    }

    if (hasUserReferences) {
        const referenceTask = referenceMode === 'outfit'
            ? '首张图片是主要服装、姿势与构图参考。提取服装设计并按照参考姿势重新绘制完整人物，不要换头、拼贴或局部粘贴原图。'
            : '首张图片是主要姿势与构图参考。重新绘制完整画面，不要直接复制、拼贴或局部粘贴原图。';
        const content = [
            textPart(`【任务：参考图重绘】${referenceTask}`),
            textPart('【主构图参考】'),
            imagePart(userReferenceImages[0]),
        ];
        userReferenceImages.slice(1).forEach((dataUrl, index) => {
            content.push(textPart(`【补充参考 ${index + 1}】`), imagePart(dataUrl));
        });
        content.push(textPart(`【执行】用户原始要求：${prompt}\n\n请只返回生成的图片链接。`));
        return {
            pipeline: 'reference-only',
            referenceMode,
            imageOrder: ['primary-composition', ...userReferenceImages.slice(1).map(() => 'supplementary')],
            content,
        };
    }

    return {
        pipeline: 'text-only',
        referenceMode,
        imageOrder: [],
        content: [textPart(`请画一幅图：${prompt}。请直接返回图片链接。`)],
    };
}

function buildImageGenerationContent(promptTags, initImageBase64 = null, userReferenceImages = []) {
    return buildImageGenerationPlan(promptTags, initImageBase64, userReferenceImages).content;
}

async function generateImage(config, promptTags, initImageBase64 = null, userReferenceImages = []) {
    const API_URL = resolveChatCompletionsUrl(config.imageEndpoint || config.apiEndpoint);
    const API_KEY = config.apiKey;

    if (!API_KEY) throw new Error("未配置 API Key");
    if (!config.imageModel) throw new Error('未配置生图模型');

    console.log(`🎨 请求生图... Prompt: ${promptTags.substring(0, 20)}...`);

    const generationPlan = buildImageGenerationPlan(
        promptTags,
        initImageBase64,
        userReferenceImages
    );
    const messagesContent = generationPlan.content;
    console.log(`🧭 生图管线: ${generationPlan.pipeline}; 参考模式: ${generationPlan.referenceMode}; 图片顺序: ${generationPlan.imageOrder.join(' → ') || 'none'}`);

    const payload = {
        model: config.imageModel,
        messages: [{ role: "user", content: messagesContent }],
        stream: false
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || "";
        
        // 兼容供应商返回 Markdown、纯链接或 data URL；只把图片数据交回 OneBot 层。
        const base64Match = content.match(/data:image\/.*?;base64,([a-zA-Z0-9+/=]+)/);
        if (base64Match) return { type: 'base64', data: base64Match[1] };

        const urlMatch = content.match(/(https?:\/\/[^\s)\]"]+)/);
        if (urlMatch) return { type: 'url', data: urlMatch[0] };

        throw new Error("未找到图片数据: " + content.substring(0, 50));

    } catch (error) {
        console.error("❌ 生图请求失败:", error);
        throw error;
    }
}

module.exports = {
    buildImageGenerationContent,
    buildImageGenerationPlan,
    detectReferenceMode,
    generateImage,
    selectImageGenerationPrompt,
};
