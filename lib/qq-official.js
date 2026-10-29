/** QQ Open Platform group/C2C Webhook adapter. No automatic retries of message sends. */
const crypto = require('node:crypto');
const { officialIdentity } = require('./qq-identity');
const validOpenId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function signingKey(secret) {
    if (!secret) throw new Error('未配置官方 QQ Bot AppSecret');
    let seed = Buffer.from(secret);
    while (seed.length < 32) seed = Buffer.concat([seed, seed]);
    return crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
}
function challenge(secret, data) {
    if (typeof data?.plain_token !== 'string' || typeof data?.event_ts !== 'string' || data.plain_token.length > 2048 || !/^\d{1,15}$/.test(data.event_ts)) throw new Error('回调验证参数无效');
    return { plain_token: data.plain_token, signature: crypto.sign(null, Buffer.from(data.event_ts + data.plain_token), signingKey(secret)).toString('hex') };
}
function verifyCallback(secret, raw, timestamp, signature, now = Date.now()) {
    if (!Buffer.isBuffer(raw) || !/^\d{1,15}$/.test(timestamp || '') || !/^[a-fA-F0-9]{128}$/.test(signature || '') || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
    try { return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), raw]), crypto.createPublicKey(signingKey(secret)), Buffer.from(signature, 'hex')); }
    catch { return false; }
}
function normalizeOfficialEvent(payload, config) {
    if (payload?.op !== 0 || !['GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE'].includes(payload.t)) return null;
    const d = payload.d, group = payload.t !== 'C2C_MESSAGE_CREATE';
    const user = group ? d?.author?.member_openid : d?.author?.user_openid;
    if (!validOpenId(user) || (group && !validOpenId(d.group_openid)) || typeof d.id !== 'string' || !d.id || d.author.bot) return null;
    const selfId = officialIdentity(config, 'bot'), mentions = Array.isArray(d.mentions) ? d.mentions : [];
    const message = [{ type: 'text', data: { text: String(d.content || '') } }];
    if (payload.t === 'GROUP_AT_MESSAGE_CREATE') message.unshift({ type: 'at', data: { qq: selfId } });
    for (const mention of mentions) {
        const id = mention.member_openid || mention.user_openid || mention.id;
        if (validOpenId(id)) message.push({ type: 'at', data: { qq: officialIdentity(config, id) } });
    }
    for (const attachment of Array.isArray(d.attachments) ? d.attachments : []) {
        let url = String(attachment.url || '');
        if (url.startsWith('//')) url = `https:${url}`;
        if (!/^https?:\/\//.test(url)) continue;
        const type = /^image\//.test(attachment.content_type) ? 'image' : /^(voice|audio)/.test(attachment.content_type) ? 'record' : /^video/.test(attachment.content_type) ? 'video' : null;
        if (type) message.push({ type, data: { url, file: url } });
    }
    return { post_type: 'message', channel: 'qqbot', self_id: selfId, message_type: group ? 'group' : 'private', user_id: officialIdentity(config, user),
        group_id: group ? officialIdentity(config, d.group_openid) : undefined, message_id: d.id, message,
        sender: { nickname: d.author.username || user }, time: Date.parse(d.timestamp) / 1000 || undefined };
}
function createOfficialBot({ getConfig, fetchImpl = fetch, now = Date.now }) {
    let token = null, pendingToken = null, generation = 0, verifiedAt = 0, lastEventAt = 0;
    const seen = new Map();
    const configured = () => { const c = getConfig(); return c.qqProvider === 'qqbot' && Boolean(c.qqBotAppId && c.qqBotSecret); };
    const status = () => ({ provider: 'qqbot', connected: configured() && verifiedAt > 0, connections: 0,
        state: !configured() ? 'unconfigured' : verifiedAt ? 'callback-verified' : 'awaiting-callback', verifiedAt, lastEventAt });
    async function jsonRequest(url, body, headers = {}) {
        let response;
        try { response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error' }); }
        catch { throw Object.assign(new Error('QQ 官方接口请求中断，结果未知；未自动重试'), { code: 'delivery-unknown' }); }
        let data;
        try { data = await response.json(); } catch { throw Object.assign(new Error('QQ 官方接口返回无效响应，结果未知'), { code: 'delivery-unknown' }); }
        if (!response.ok || (data.code != null && Number(data.code) !== 0)) throw new Error(`QQ 官方接口失败（HTTP ${response.status}，code ${data.code ?? 'unknown'}）`);
        return data;
    }
    async function accessToken(config, epoch) {
        if (epoch !== generation) throw new Error('接入配置已切换');
        if (token && token.expires > now()) return token.value;
        if (!pendingToken) {
            const request = jsonRequest('https://api.bot.qq.com/app/getAppAccessToken', { appId: config.qqBotAppId, clientSecret: config.qqBotSecret }).then(data => {
                if (!data.access_token || !Number(data.expires_in)) throw new Error('QQ 官方访问凭证无效');
                if (epoch !== generation) throw new Error('接入配置已切换');
                token = { value: data.access_token, expires: now() + Math.max(1, Number(data.expires_in) - 60) * 1000 };
                return token.value;
            }).finally(() => { if (pendingToken === request) pendingToken = null; });
            pendingToken = request;
        }
        return pendingToken;
    }
    function reset() { generation++; token = null; pendingToken = null; verifiedAt = 0; lastEventAt = 0; seen.clear(); }
    // Accept before invoking the expensive model; duplicates never create a second reply task.
    function accept(payload) {
        const config = { ...getConfig() }, event = normalizeOfficialEvent(payload, config);
        verifiedAt = now();
        if (!event) return null;
        lastEventAt = now();
        for (const [key, expires] of seen) if (expires < now()) seen.delete(key);
        const key = `${event.group_id || event.user_id}:${event.message_id}`;
        if (seen.has(key)) return null;
        seen.set(key, now() + 3600000);
        if (seen.size > 10000) seen.delete(seen.keys().next().value);
        const epoch = generation, d = payload.d, group = event.message_type === 'group';
        const route = `/v2/${group ? 'groups' : 'users'}/${encodeURIComponent(group ? d.group_openid : d.author.user_openid)}`;
        const base = config.qqBotSandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.bot.qq.com';
        let seq = 0;
        const transport = { selfId: event.self_id, readyState: 1, async sendOfficial(message, type, senderId, groupId) {
            if (epoch !== generation || !configured()) throw new Error('QQ 官方接入配置已切换，已取消旧回复');
            if (type !== event.message_type || senderId !== event.user_id || (group && groupId !== event.group_id)) throw new Error('QQ 官方回复目标不匹配');
            if (now() - lastEventTime > 290000 || seq >= (group ? 5 : 4)) throw new Error('QQ 官方被动回复窗口或次数已用完');
            const chain = Array.isArray(message) ? message : [{ type: 'text', data: { text: String(message) } }];
            if (chain.some(s => !['text', 'image'].includes(s.type)) || chain.filter(s => s.type === 'image').length > 1) throw new Error('官方渠道当前支持文本或单张图片回复');
            const image = chain.find(s => s.type === 'image');
            const content = chain.filter(s => s.type === 'text').map(s => s.data.text).join('');
            if (image && content.trim()) throw new Error('官方渠道图片与文字需分开发送');
            const authorization = `QQBot ${await accessToken(config, epoch)}`;
            const api = async (path, body) => {
                if (epoch !== generation) throw new Error('接入配置已切换');
                return jsonRequest(base + path, body, { Authorization: authorization });
            };
            let body = { msg_type: 0, content };
            if (image) {
                const source = String(image.data.file || image.data.url || '');
                let upload;
                if (/^https?:\/\//.test(source)) upload = { url: source };
                else if (source.startsWith('base64://') && source.length < 7 * 1024 * 1024) {
                    const data = source.slice(9);
                    if (Buffer.byteLength(data, 'base64') > 5 * 1024 * 1024) throw new Error('官方渠道图片直传上限为 5 MB');
                    upload = { file_data: data, file_name: 'image.png' };
                } else throw new Error('官方渠道需要公网图片 URL 或不超过 5 MB 的图片数据');
                const media = await api(route + '/files', { file_type: 1, srv_send_msg: false, ...upload });
                if (!media.file_info) throw new Error('QQ 官方图片上传未返回 file_info');
                body = { msg_type: 7, media: { file_info: media.file_info } };
            }
            const result = await api(route + '/messages', { ...body, msg_id: d.id, msg_seq: ++seq });
            if (!result.id) throw Object.assign(new Error('QQ 官方发送未返回消息 ID，结果未知'), { code: 'delivery-unknown' });
            return { messageId: result.id };
        } };
        const lastEventTime = Number.isFinite(event.time) ? event.time * 1000 : now();
        return { event, transport };
    }
    return { reset, status, accept };
}
module.exports = { signingKey, challenge, verifyCallback, normalizeOfficialEvent, createOfficialBot };
