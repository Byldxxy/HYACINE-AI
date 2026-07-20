/**
 * OpenAI-compatible 生图适配层。
 *
 * 此项目通过 chat/completions 形式调用能够返回图片的多模态模型，而不是固定厂商的
 * images API。角色底图和聊天参考图有明确优先级：底图决定“是谁”，聊天图片只决定
 * 姿势、构图、场景等参考维度。调用方最终得到 URL 或纯 base64 两种统一结果。
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

function buildImageGenerationContent(promptTags, initImageBase64 = null, userReferenceImages = []) {
    const content = [];

    // 图片和紧随其后的文字标签成对发送，显式告诉模型每张图在生成任务中的角色。
    if (initImageBase64) {
        content.push({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${initImageBase64}` },
        });
        content.push({
            type: 'text',
            text: '【图 1：角色基底图】这是生成结果的主角与身份基准。必须优先保持其面部、发型、发色、瞳色、体型与整体角色特征。',
        });
    }

    userReferenceImages.forEach((dataUrl, index) => {
        content.push({
            type: 'image_url',
            image_url: { url: dataUrl },
        });
        content.push({
            type: 'text',
            text: initImageBase64
                ? `【图 ${index + 2}：用户参考图】参考这张图的姿势、构图、场景、道具、服装或画面风格，但不要用其中人物替换角色基底图的主角。`
                : `【图 ${index + 1}：用户参考图】将这张图作为主要视觉参考，提取用户要求的姿势、构图、场景、道具、服装或画面风格。`,
        });
    });

    // 四种组合分别写提示，避免无图时引用不存在的“图 1”，也避免参考图覆盖角色身份。
    if (initImageBase64 && userReferenceImages.length > 0) {
        content.push({
            type: 'text',
            text: `请创作一张全新的图片，不要拼贴或照抄原图。角色身份以图 1 为最高优先级；其余图片仅作为用户要求的视觉参考。\n\n新图片要求：${promptTags}\n\n请直接返回生成的图片链接。`,
        });
    } else if (initImageBase64) {
        content.push({
            type: 'text',
            text: `请基于角色基底图创作一张全新的图片。不要照抄原构图，根据描述改变动作和背景；未明确要求修改服装时保持原服装。保持原图的二次元插画风格，禁止生成真人照片、Cosplay、3D 渲染或写实厚涂。\n\n新场景描述：${promptTags}\n\n请直接返回生成的图片链接。`,
        });
    } else if (userReferenceImages.length > 0) {
        content.push({
            type: 'text',
            text: `请参考用户图片创作一张全新的图片，不要拼贴或照抄原图。\n\n新图片要求：${promptTags}\n\n请直接返回生成的图片链接。`,
        });
    } else {
        content.push({ type: 'text', text: `请画一幅图：${promptTags}。请直接返回图片链接。` });
    }

    return content;
}

async function generateImage(config, promptTags, initImageBase64 = null, userReferenceImages = []) {
    const API_URL = resolveChatCompletionsUrl(config.imageEndpoint || config.apiEndpoint);
    const API_KEY = config.apiKey;

    if (!API_KEY) throw new Error("未配置 API Key");
    if (!config.imageModel) throw new Error('未配置生图模型');

    console.log(`🎨 请求生图... Prompt: ${promptTags.substring(0, 20)}...`);

    const messagesContent = buildImageGenerationContent(
        promptTags,
        initImageBase64,
        userReferenceImages
    );

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

module.exports = { buildImageGenerationContent, generateImage };
