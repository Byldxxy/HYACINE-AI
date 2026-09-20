/** OneBot message segments are the source of truth; raw CQ is a compatibility input. */
const { extractImageSources } = require('./vision');
const decode = value => String(value ?? '').replace(/&#44;/g, ',').replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&amp;/g, '&');
function parseCq(raw) {
    const segments = []; let offset = 0;
    for (const match of String(raw || '').matchAll(/\[CQ:([\w-]+)((?:,[^\]]*)?)\]/g)) {
        if (match.index > offset) segments.push({ type: 'text', data: { text: decode(raw.slice(offset, match.index)) } });
        const data = {};
        for (const item of match[2].slice(1).split(',')) { const split = item.indexOf('='); if (split > 0) data[item.slice(0, split)] = decode(item.slice(split + 1)); }
        segments.push({ type: match[1], data }); offset = match.index + match[0].length;
    }
    if (offset < raw.length) segments.push({ type: 'text', data: { text: decode(raw.slice(offset)) } });
    return segments;
}
function normalizeMessage(event, config = {}) {
    if (event?.post_type !== 'message' || !['group', 'private'].includes(event.message_type)) return null;
    const senderId = String(event.user_id ?? ''), groupId = event.message_type === 'group' ? String(event.group_id ?? '') : null;
    const selfId = String(event.self_id || config.botQQ || '');
    if (!/^\d+$/.test(senderId) || (groupId !== null && !/^\d+$/.test(groupId)) || senderId === selfId || senderId === String(config.botQQ || '')) return null;
    const segments = Array.isArray(event.message) ? event.message.filter(s => s && typeof s.type === 'string' && s.data && typeof s.data === 'object') : parseCq(String(event.message || event.raw_message || ''));
    const mentions = segments.filter(s => s.type === 'at').map(s => String(s.data.qq));
    const text = segments.map(s => s.type === 'text' ? String(s.data.text || '') : s.type === 'face' ? '[表情]' : s.type === 'record' ? '[语音，未转写]' : s.type === 'video' ? '[视频]' : s.type === 'forward' ? '[合并转发，未展开]' : '').join('').trim().slice(0, 20000);
    const images = extractImageSources({ message: segments });
    const imageCount = segments.filter(s => s.type === 'image').length;
    return { senderId, groupId, selfId, type: event.message_type, id: event.message_id == null ? null : String(event.message_id),
        time: Number(event.time) || null, sessionId: groupId ? `group_${groupId}` : `user_${senderId}`,
        sender: String(event.sender?.card || event.sender?.nickname || senderId).replace(/[\r\n]/g, ' ').slice(0, 100),
        text, images, imageCount, mentions, atMe: Boolean(selfId && mentions.includes(selfId)),
        replyTo: segments.find(s => s.type === 'reply')?.data?.id == null ? null : String(segments.find(s => s.type === 'reply').data.id),
        observation: (text + (imageCount ? ` [附带 ${imageCount} 张图片]` : '')).trim(),
    };
}
function isDirect(message, config, isReplyToBot = false) {
    return message.type === 'private' || config.alwaysReply === true || message.atMe || isReplyToBot ||
        (config.customKeywords || []).some(k => typeof k === 'string' && k.trim() && message.text.startsWith(k.trim()));
}
module.exports = { parseCq, normalizeMessage, isDirect };
