const { readAction } = require('../qq-transport');

const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_SECONDS = 60;
class VoiceError extends Error {}

// NapCat converts received voice IDs into WAV in its own container. Only its returned
// audio bytes cross the WebSocket; paths and URLs never address the bot host.
function wavAudio(base64) {
    if (typeof base64 !== 'string' || !base64.length || base64.length > 4 * Math.ceil(MAX_AUDIO_BYTES / 3)) {
        throw new VoiceError('未收到可用的短语音数据');
    }
    const audio = Buffer.from(base64, 'base64');
    if (audio.length < 44 || audio.length > MAX_AUDIO_BYTES || audio.toString('ascii', 0, 4) !== 'RIFF' ||
        audio.toString('ascii', 8, 12) !== 'WAVE' || audio.readUInt32LE(4) + 8 !== audio.length) throw new VoiceError('语音格式不可用');
    let byteRate = 0, samples = 0;
    for (let offset = 12; offset < audio.length;) {
        if (offset + 8 > audio.length) throw new VoiceError('语音数据不完整');
        const tag = audio.toString('ascii', offset, offset + 4), size = audio.readUInt32LE(offset + 4);
        const start = offset + 8;
        if (start + size > audio.length) throw new VoiceError('语音数据不完整');
        if (tag === 'fmt ') {
            if (byteRate || size < 16 || audio.readUInt16LE(start) !== 1) throw new VoiceError('需要 PCM WAV 音频');
            const channels = audio.readUInt16LE(start + 2), rate = audio.readUInt32LE(start + 4), bits = audio.readUInt16LE(start + 14);
            if (![1, 2].includes(channels) || rate < 8000 || rate > 96000 || ![8,16,24,32].includes(bits)) throw new VoiceError('语音采样格式无效');
            byteRate = rate * channels * bits / 8;
            if (audio.readUInt32LE(start + 8) !== byteRate || audio.readUInt16LE(start + 12) !== channels * bits / 8) throw new VoiceError('语音采样格式无效');
        }
        if (tag === 'data') samples += size;
        offset = start + size + (size % 2);
    }
    if (!samples || !byteRate || samples > byteRate * MAX_SECONDS) throw new VoiceError('仅支持 60 秒以内的语音');
    return audio;
}

function transcriptionService(config) {
    const chat = new URL(config.apiEndpoint || 'https://api.openai.com/v1');
    const url = config.voiceEndpoint ? new URL(config.voiceEndpoint) : new URL(chat.href);
    if (!config.voiceEndpoint) url.pathname = url.pathname.replace(/\/$/, '') + '/audio/transcriptions';
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new VoiceError('转写接口地址无效');
    return { url, key: config.voiceApiKey || (url.origin === chat.origin ? config.apiKey : ''), model: config.voiceModel?.trim() || 'whisper-1' };
}

function createVoiceTranscriber({ read = readAction, fetchImpl = fetch } = {}) {
    let active = 0;
    return async function transcribe(ws, message, config, current) {
        if (active >= 2) throw new VoiceError('转写服务忙');
        if (message.voiceCount !== 1 || !message.voiceFile) throw new VoiceError('需要一条可读取的语音');
        if (message.voiceSeconds > MAX_SECONDS) throw new VoiceError('仅支持 60 秒以内的语音');
        const { url, key, model } = transcriptionService(config);
        active++;
        try {
            let data;
            try { data = await read(ws, 'get_record', { file: message.voiceFile, out_format: 'wav' }); }
            catch { throw new VoiceError('NapCat 读取或转换 WAV 失败'); }
            if (!current()) return '';
            const audio = wavAudio(data?.base64);
            const form = new FormData();
            form.append('file', new Blob([audio], { type: 'audio/wav' }), 'voice.wav');
            form.append('model', model);
            form.append('response_format', 'json');
            const result = await fetchImpl(url, { method: 'POST', body: form, redirect: 'error',
                headers: key ? { Authorization: 'Bearer ' + key } : {}, signal: AbortSignal.timeout(20000) });
            if (!result.ok) { await result.body?.cancel(); throw new VoiceError('转写服务返回 HTTP ' + result.status); }
            // Some compatible endpoints return HTML error pages, raw files or large debug payloads.
            const chunks = [];
            let size = 0;
            for await (const chunk of result.body) {
                size += chunk.length;
                if (size > 32768) throw new VoiceError('转写结果过大');
                chunks.push(chunk);
            }
            const text = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.text;
            if (typeof text !== 'string' || !text.trim()) throw new VoiceError('没有识别出文字');
            return text.trim().slice(0, 2000);
        } finally { active--; }
    };
}
module.exports = { createVoiceTranscriber, wavAudio, transcriptionService, VoiceError };
