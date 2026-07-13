// lib/image-gen.js - 生图引擎模块

/** @typedef {import('../types').BotConfig} BotConfig */
/** @typedef {import('../types').ImageResult} ImageResult */

/**
 * 生成图片 - 调用外部生图 API
 * @param {Partial<BotConfig>} config - 全局配置对象
 * @param {string} promptTags - 图片描述提示词
 * @param {string|null} initImageBase64 - 参考图 base64 (可选)
 * @returns {Promise<ImageResult>}
 */
function resolveChatCompletionsUrl(endpoint) {
    const base = (endpoint || "https://api.qhaigc.net/v1").replace(/\/$/, '');
    if (base.endsWith('/chat/completions')) return base;
    return `${base}/chat/completions`;
}

async function generateImage(config, promptTags, initImageBase64 = null) {
    const API_URL = resolveChatCompletionsUrl(config.imageEndpoint || config.apiEndpoint);
    const API_KEY = config.apiKey; 

    if (!API_KEY) throw new Error("未配置 API Key");

    console.log(`🎨 请求生图... Prompt: ${promptTags.substring(0, 20)}...`);

    let messagesContent = [];
    
    if (initImageBase64) {
        messagesContent.push({ 
            type: "image_url", 
            image_url: { 
                url: `data:image/png;base64,${initImageBase64}` 
            } 
        });

        messagesContent.push({ 
            type: "text", 
            text: `这是一张【角色设定参考图】。
            请基于这张图中的人物形象（包括发型、发色、瞳色、面部特征、服饰风格），创作一张**全新的图片**。
        
            ⚠️ 约束条件：
            1. 主角必须是参考图里的这个人，保持高度一致 (Keep Character Consistent)。
            2. 不要照抄原图的构图，请根据我的描述改变动作和背景，如果用户有服饰的要求则允许修改服饰，否则请严格按照原服饰生成。
            3. 必须严格保持原图的**二次元/动漫插画风格** (Anime Style, Flat Color, Cel Shading)。
               - **严禁 (STRICTLY FORBIDDEN)** :生成真实世界风格、照片质感、真人Cosplay、3D渲染或写实厚涂风格。
            
            🎬 新场景描述：
            ${promptTags}
            
            请直接返回生成的图片链接。` 
        });
        
    } else {
        messagesContent = [{ type: "text", text: `请画一幅图：${promptTags}。请直接返回图片链接。` }];
    }

    const payload = {
        model: config.imageModel || "gemini-3-pro-image-preview",
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

module.exports = { generateImage };
