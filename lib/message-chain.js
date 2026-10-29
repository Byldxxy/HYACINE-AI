/** OneBot message segments are the source of truth; raw CQ is a compatibility input. */
const { isChatIdentity } = require('./qq-identity');
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
function videoCard(data) {
    try {
        const raw = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
        if (!raw || raw.length > 30000) return '';
        const card = JSON.parse(raw), meta = card.meta || {};
        const links = Object.values(meta).filter(v => v && typeof v === 'object').flatMap(v => [v.qqdocurl, v.jumpUrl, v.url]);
        const link = links.find(v => typeof v === 'string' && /^https?:\/\/(?:www\.)?bilibili\.com\/video\/BV[\w]+|^https?:\/\/b23\.tv\/[A-Za-z0-9]+/.test(v));
        return link ? ` [B站视频 ${link.slice(0, 1000)}] ` : '';
    } catch { return ''; }
}
function normalizeMessage(event, config = {}) {
    if (event?.post_type !== 'message' || !['group', 'private'].includes(event.message_type)) return null;
    const senderId = String(event.user_id ?? ''), groupId = event.message_type === 'group' ? String(event.group_id ?? '') : null;
    const selfId = String(event.self_id || config.botQQ || '');
    const validId = event.channel === 'qqbot' ? isChatIdentity : value => /^\d+$/.test(value);
    if (!validId(senderId) || (groupId !== null && !validId(groupId)) || senderId === selfId || senderId === String(config.botQQ || '')) return null;
    const segments = Array.isArray(event.message) ? event.message.filter(s => s && typeof s.type === 'string' && s.data && typeof s.data === 'object') : parseCq(String(event.message || event.raw_message || ''));
    const mentions = segments.filter(s => s.type === 'at').map(s => String(s.data.qq));
    const segmentText = s => s.type === 'json' ? videoCard(s.data) : s.type === 'text' ? String(s.data.text || '') : s.type === 'face' ? '[表情]' : s.type === 'record' ? '[语音，未转写]' : s.type === 'video' ? '[视频]' : s.type === 'forward' ? '[合并转发，未展开]' : '';
    // Plain text remains separate for commands/keywords; model content preserves mention positions.
    const text = segments.map(segmentText).join('').trim().slice(0, 20000);
    const contentText = segments.map(s => {
        if (s.type !== 'at') return segmentText(s);
        const id = String(s.data.qq);
        if (id === 'all') return ' [@全体成员] ';
        if (!validId(id)) return ' [@未知对象] ';
        return ` [@${id === selfId ? '机器人' : '成员'} ${event.channel === 'qqbot' ? 'ID' : 'QQ'}:${id}] `;
    }).join('').trim().slice(0, 20000);
    const images = extractImageSources({ message: segments });
    const imageCount = segments.filter(s => s.type === 'image').length;
    return { senderId, groupId, selfId, type: event.message_type, id: event.message_id == null ? null : String(event.message_id),
        time: Number(event.time) || null, sessionId: groupId ? `group_${groupId}` : `user_${senderId}`,
        sender: String(event.sender?.card || event.sender?.nickname || senderId).replace(/[\r\n]/g, ' ').slice(0, 100),
        text, contentText, images, imageCount, mentions, atMe: Boolean(selfId && mentions.includes(selfId)),
        replyTo: segments.find(s => s.type === 'reply')?.data?.id == null ? null : String(segments.find(s => s.type === 'reply').data.id),
        observation: (contentText + (imageCount ? ` [附带 ${imageCount} 张图片]` : '')).trim(),
    };
}
function isDirect(message, config, isReplyToBot = false) {
    return message.type === 'private' || config.alwaysReply === true || message.atMe || isReplyToBot ||
        (config.customKeywords || []).some(k => typeof k === 'string' && k.trim() && message.text.startsWith(k.trim()));
}
module.exports = { parseCq, normalizeMessage, isDirect };
