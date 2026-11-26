/** OneBot echo-correlated delivery. Never retry an ambiguous send automatically. */
const { randomUUID } = require('node:crypto');
function createQQTransport({ timeoutMs = 15000 } = {}) {
    const pending = new Map();
    function sendToQQ(ws, message, type, senderId, groupId, shouldAt = false) {
        if (typeof ws?.sendOfficial === 'function') return ws.sendOfficial(message, type, senderId, groupId);
        if (!ws || ws.readyState !== 1) return Promise.reject(new Error('OneBot 未连接，消息未发送'));
        const chain = Array.isArray(message) ? [...message] : [{ type: 'text', data: { text: String(message) } }];
        if (shouldAt && type === 'group') chain.unshift({ type: 'at', data: { qq: String(senderId) } }, { type: 'text', data: { text: ' ' } });
        const params = { message_type: type, message: chain, ...(type === 'group' ? { group_id: String(groupId) } : { user_id: String(senderId) }) };
        return request(ws, 'send_msg', params).then(data => ({ messageId: data?.message_id ?? null }));
    }
    function readAction(ws, action, params) {
        if (!['get_record', 'get_msg'].includes(action)) return Promise.reject(new Error('不支持的 OneBot 读取操作'));
        if (!ws || ws.readyState !== 1) return Promise.reject(new Error('OneBot 未连接'));
        return request(ws, action, params);
    }
    function request(ws, action, params) {
        const echo = `hyacine:${randomUUID()}`;
        const sending = action === 'send_msg';
        return new Promise((resolve, reject) => {
            const finish = (error, value) => { clearTimeout(timer); pending.delete(echo); error ? reject(error) : resolve(value); };
            const uncertain = () => Object.assign(new Error(sending ? '发送回执未收到，结果未知；不会自动重发' : 'OneBot 读取未完成'), { code: sending ? 'delivery-unknown' : 'read-failed' });
            const timer = setTimeout(() => finish(uncertain()), timeoutMs);
            pending.set(echo, { ws, finish, sending, uncertain });
            try { ws.send(JSON.stringify({ action, params, echo }), error => { if (error) finish(uncertain()); }); }
            catch (error) { finish(error); }
        });
    }
    function handleResponse(ws, message) {
        const item = pending.get(message?.echo); if (!item || item.ws !== ws) return false;
        if (message.status === 'ok' && Number(message.retcode) === 0) item.finish(null, message.data);
        else if (!item.sending) item.finish(new Error(`OneBot 读取失败 (${message.retcode ?? message.status})`));
        else item.finish(Object.assign(new Error(`OneBot 发送未确认 (${message.retcode ?? message.status})`), { code: message.status === 'async' ? 'delivery-unknown' : 'delivery-failed' }));
        return true;
    }
    function disconnect(ws) { for (const item of pending.values()) if (item.ws === ws) item.finish(item.uncertain()); }
    return { sendToQQ, readAction, handleResponse, disconnect };
}
const transport = createQQTransport();
module.exports = { createQQTransport, ...transport };
