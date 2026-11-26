const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceTranscriber, wavAudio, transcriptionService } = require('../lib/extensions/voice');
const { createQQTransport } = require('../lib/qq-transport');
const { normalizeMessage } = require('../lib/message-chain');

function wav(seconds) {
    const bytes = seconds * 16000;
    const buffer = Buffer.alloc(44 + bytes);
    buffer.write('RIFF'); buffer.writeUInt32LE(36 + bytes, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
    return buffer.toString('base64');
}
test('NapCat WAV on the connected socket becomes a multipart transcription with isolated credentials', async () => {
    const inherited = transcriptionService({ apiEndpoint: 'https://chat.example/v1', apiKey: 'chat-key' });
    assert.equal(inherited.url.href, 'https://chat.example/v1/audio/transcriptions');
    assert.equal(inherited.key, 'chat-key');
    const transport = createQQTransport(), payload = [];
    const ws = { readyState: 1, send: data => payload.push(JSON.parse(data)) };
    let requested;
    const transcribe = createVoiceTranscriber({ read: transport.readAction, fetchImpl: async (url, options) => {
        requested = url.href;
        assert.deepEqual(options.headers, {});
        assert.equal(options.body.get('model'), 'whisper-1');
        assert.equal(options.body.get('file').name, 'voice.wav');
        assert.equal(options.body.get('file').size, 16044);
        return Response.json({ text: '风堇，今天放假吗？' });
    } });
    const task = transcribe(ws, { voiceCount: 1, voiceFile: 'record.silk' },
        { apiKey: 'would-not-leave-origin', voiceEndpoint: 'https://stt.example/audio/transcriptions' }, () => true);
    assert.equal(payload[0].action, 'get_record'); assert.equal(payload[0].params.out_format, 'wav');
    const echo = { echo: payload[0].echo, retcode: 0, status: 'ok', data: { file: '/inside/napcat', base64: wav(1) } };
    assert.equal(transport.handleResponse({}, echo), false); assert.equal(transport.handleResponse(ws, echo), true);
    assert.equal(await task, '风堇，今天放假吗？'); assert.equal(requested, 'https://stt.example/audio/transcriptions');
});
test('untrusted paths, invalid audio and clips longer than 60s cannot be transcribed', async () => {
    for (const file of ['file:///etc/hosts','/tmp/test.wav','https://example.com/audio']) {
        const msg = normalizeMessage({ post_type: 'message', message_type: 'private', user_id: 7, message: [{ type: 'record', data: { file } }] });
        assert.equal(msg.voiceFile, null);
    }
    assert.throws(() => wavAudio(wav(61)), /60 秒/);
    assert.throws(() => wavAudio(Buffer.alloc(200).toString('base64')), /格式/);
});
