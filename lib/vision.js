/**
 * OneBot 图片输入适配层。
 *
 * NapCat 可能同时提供结构化 message 段和 raw_message CQ 码，本模块从两处提取并去重，
 * 再把 URL/base64 统一为 OpenAI-compatible data URL。数量、体积和下载时间均有限制，
 * 防止超大图片、失效链接或慢响应长期阻塞同一会话队列。
 */
const { promises: dns } = require('dns');
const net = require('net');

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

function decodeCqValue(value) {
    return String(value || '')
        .replace(/&#44;/g, ',')
        .replace(/&#91;/g, '[')
        .replace(/&#93;/g, ']')
        .replace(/&amp;/g, '&');
}

function parseCqParams(rawParams) {
    const params = {};
    for (const item of String(rawParams || '').split(',')) {
        const separator = item.indexOf('=');
        if (separator === -1) continue;
        const key = item.slice(0, separator).trim();
        params[key] = decodeCqValue(item.slice(separator + 1));
    }
    return params;
}

function selectImageSource(data) {
    const candidates = [data?.url, data?.file];
    return candidates.find(value => /^(https?:\/\/|data:image\/|base64:\/\/)/i.test(value || '')) || '';
}

function extractImageSources(msgObj) {
    const sources = [];

    if (Array.isArray(msgObj?.message)) {
        for (const segment of msgObj.message) {
            if (segment?.type !== 'image') continue;
            const source = selectImageSource(segment.data);
            if (source) sources.push(source);
        }
    }

    const rawMessage = String(msgObj?.raw_message || '');
    for (const match of rawMessage.matchAll(/\[CQ:image,([^\]]+)\]/g)) {
        const source = selectImageSource(parseCqParams(match[1]));
        if (source) sources.push(source);
    }

    // 同一图片常同时出现在结构化消息和 CQ 码中，必须去重后再应用数量上限。
    return [...new Set(sources)].slice(0, MAX_IMAGES);
}

function stripImageSegments(text) {
    return String(text || '').replace(/\[CQ:image,[^\]]+\]/g, '').trim();
}

function normalizeDataUrl(source) {
    if (/^base64:\/\//i.test(source)) {
        return `data:image/jpeg;base64,${source.slice('base64://'.length)}`;
    }
    return source;
}

function validateDataUrl(source) {
    const normalized = normalizeDataUrl(source);
    const match = normalized.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) throw new Error('图片 Data URL 格式无效');

    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (buffer.length === 0) throw new Error('图片内容为空');
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过 6 MB 限制');
    return `data:${match[1].toLowerCase()};base64,${buffer.toString('base64')}`;
}

function isNonPublicIpAddress(address) {
    const normalized = String(address || '').split('%')[0].toLowerCase();
    if (normalized.startsWith('::ffff:')) {
        return isNonPublicIpAddress(normalized.slice('::ffff:'.length));
    }
    const version = net.isIP(normalized);
    if (version === 4) {
        const [a, b] = normalized.split('.').map(Number);
        return a === 0
            || a === 10
            || a === 127
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && [0, 168].includes(b))
            || (a === 198 && [18, 19, 51].includes(b))
            || (a === 203 && b === 0)
            || a >= 224;
    }
    if (version === 6) {
        return normalized === '::'
            || normalized === '::1'
            || normalized.startsWith('fc')
            || normalized.startsWith('fd')
            || /^fe[89ab]/.test(normalized)
            || normalized.startsWith('ff')
            || normalized.startsWith('2001:db8:');
    }
    return true;
}

async function validateRemoteImageUrl(source, lookupImpl = dns.lookup) {
    let url;
    try {
        url = new URL(source);
    } catch {
        throw new Error('图片地址格式无效');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('图片地址仅支持 HTTP/HTTPS');
    if (url.username || url.password) throw new Error('图片地址不能包含登录凭据');

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
        throw new Error('图片地址不能指向本机或局域网主机');
    }

    const literalVersion = net.isIP(hostname);
    const addresses = literalVersion
        ? [{ address: hostname }]
        : await lookupImpl(hostname, { all: true, verbatim: true });
    if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('图片主机无法解析');
    if (addresses.some(item => isNonPublicIpAddress(item.address))) {
        throw new Error('图片地址解析到非公网 IP，已拒绝下载');
    }
    return url;
}

async function fetchImageAsDataUrl(source, fetchImpl = fetch, lookupImpl = dns.lookup) {
    if (/^(data:image\/|base64:\/\/)/i.test(source)) {
        return validateDataUrl(source);
    }
    if (!/^https?:\/\//i.test(source)) throw new Error('不支持的图片地址');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
        let currentUrl = source;
        let response;
        for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
            const validatedUrl = await validateRemoteImageUrl(currentUrl, lookupImpl);
            response = await fetchImpl(validatedUrl.toString(), {
                signal: controller.signal,
                redirect: 'manual',
                headers: { 'User-Agent': 'HYACINE-AI/1.0' },
            });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get('location');
            if (!location) throw new Error('图片重定向缺少目标地址');
            if (redirectCount === MAX_REDIRECTS) throw new Error('图片重定向次数过多');
            currentUrl = new URL(location, validatedUrl).toString();
        }
        if (!response.ok) throw new Error(`图片下载失败 (${response.status})`);

        // 先检查声明长度以便尽早拒绝，再检查实际 buffer，防止服务端漏报或谎报。
        const declaredSize = Number(response.headers.get('content-length') || 0);
        if (declaredSize > MAX_IMAGE_BYTES) throw new Error('图片超过 6 MB 限制');

        const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
        if (!contentType.startsWith('image/')) throw new Error('图片地址返回了非图片内容');

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) throw new Error('图片内容为空');
        if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过 6 MB 限制');
        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('图片下载超时');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function prepareVisionImages(sources, fetchImpl = fetch) {
    // 单张失败不应拖累其他图片；调用方会决定“至少一张成功”是否足以继续回复。
    const results = await Promise.allSettled(
        sources.slice(0, MAX_IMAGES).map(source => fetchImageAsDataUrl(source, fetchImpl))
    );
    return {
        images: results.filter(result => result.status === 'fulfilled').map(result => result.value),
        errors: results.filter(result => result.status === 'rejected').map(result => result.reason?.message || '图片读取失败'),
    };
}

function buildVisionContent(text, images) {
    // 只把当前这条 user message 改成多模态数组，历史消息仍保持纯文本以控制请求体。
    if (!images || images.length === 0) return text;
    return [
        { type: 'text', text },
        ...images.map(dataUrl => ({
            type: 'image_url',
            image_url: { url: dataUrl },
        })),
    ];
}

module.exports = {
    buildVisionContent,
    extractImageSources,
    fetchImageAsDataUrl,
    isNonPublicIpAddress,
    prepareVisionImages,
    stripImageSegments,
    validateRemoteImageUrl,
};
