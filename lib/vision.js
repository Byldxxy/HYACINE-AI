const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

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

async function fetchImageAsDataUrl(source, fetchImpl = fetch) {
    if (/^(data:image\/|base64:\/\/)/i.test(source)) {
        return validateDataUrl(source);
    }
    if (!/^https?:\/\//i.test(source)) throw new Error('不支持的图片地址');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
        const response = await fetchImpl(source, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'User-Agent': 'HYACINE-AI/1.0' },
        });
        if (!response.ok) throw new Error(`图片下载失败 (${response.status})`);

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
    const results = await Promise.allSettled(
        sources.slice(0, MAX_IMAGES).map(source => fetchImageAsDataUrl(source, fetchImpl))
    );
    return {
        images: results.filter(result => result.status === 'fulfilled').map(result => result.value),
        errors: results.filter(result => result.status === 'rejected').map(result => result.reason?.message || '图片读取失败'),
    };
}

function buildVisionContent(text, images) {
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
    prepareVisionImages,
    stripImageSegments,
};
