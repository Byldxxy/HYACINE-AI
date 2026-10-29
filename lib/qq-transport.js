/** OneBot echo-correlated delivery. Never retry an ambiguous send automatically. */
const { randomUUID } = require('node:crypto');
function createQQTransport({ timeoutMs = 15000 } = {}) {
    const pending = new Map();
    function sendToQQ(ws, message, type, senderId, groupId, shouldAt = false) {
        if (typeof ws?.sendOfficial === 'function') return ws.sendOfficial(message, type, senderId, groupId);
        if (!ws || ws.readyState !== 1) return Promise.reject(new Error('OneBot 未连接，消息未发送'));
        const chain = Array.isArray(message) ? [...message] : [{ type: 'text', data: { text: String(message) } }];
        if (shouldAt && type === 'group') chain.unshift({ type: 'at', data: { qq: String(senderId) } }, { type: 'text', data: { text: ' ' } });
        const echo = `hyacine:${randomUUID()}`;
        return new Promise((resolve, reject) => {
            const finish = (error, value) => { clearTimeout(timer); pending.delete(echo); error ? reject(error) : resolve(value); };
            const timer = setTimeout(() => finish(Object.assign(new Error('发送回执超时，结果未知；不会自动重发'), { code: 'delivery-unknown' })), timeoutMs);
            pending.set(echo, { ws, finish });
            const params = { message_type: type, message: chain, ...(type === 'group' ? { group_id: String(groupId) } : { user_id: String(senderId) }) };
            try { ws.send(JSON.stringify({ action: 'send_msg', params, echo }), error => { if (error) finish(Object.assign(error, { code: 'delivery-unknown' })); }); }
            catch (error) { finish(error); }
        });
    }
    function handleResponse(ws, message) {
        const item = pending.get(message?.echo); if (!item || item.ws !== ws) return false;
        if (message.status === 'ok' && Number(message.retcode) === 0) item.finish(null, { messageId: message.data?.message_id ?? null });
        else item.finish(Object.assign(new Error(`OneBot 发送未确认 (${message.retcode ?? message.status})`), { code: message.status === 'async' ? 'delivery-unknown' : 'delivery-failed' }));
        return true;
    }
    function disconnect(ws) { for (const item of pending.values()) if (item.ws === ws) item.finish(Object.assign(new Error('连接中断，发送结果未知；不会自动重发'), { code: 'delivery-unknown' })); }
    return { sendToQQ, handleResponse, disconnect };
}
const transport = createQQTransport();
module.exports = { createQQTransport, ...transport };
