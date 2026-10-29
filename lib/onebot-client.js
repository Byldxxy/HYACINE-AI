/** SnowLuma forward WebSocket lifecycle, separated from message and delivery logic. */
const { WebSocket } = require('ws');
function createOneBotClient({ attach, onState = () => {}, WebSocketImpl = WebSocket, schedule = setTimeout, cancel = clearTimeout }) {
    let socket = null, timer = null, stopped = true, attempt = 0;
    function stop() {
        stopped = true; cancel(timer); timer = null;
        const old = socket; socket = null;
        old?.terminate();
    }
    function start({ url, token }) {
        stop(); stopped = false; attempt = 0;
        const connect = () => {
            if (stopped) return;
            onState('connecting');
            const current = new WebSocketImpl(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, handshakeTimeout: 10000, followRedirects: false });
            socket = current;
            attach(current);
            current.on('open', () => {
                if (stopped || socket !== current) return;
                attempt = 0; onState('connected');
                current.send(JSON.stringify({ action: 'get_login_info', echo: 'hyacine:login' }));
            });
            current.on('error', () => { if (socket === current) onState('connection-error'); });
            current.on('close', () => {
                if (stopped || socket !== current) return;
                socket = null; onState('reconnecting');
                timer = schedule(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)));
                timer?.unref?.();
            });
        };
        connect();
    }
    return { start, stop };
}
module.exports = { createOneBotClient };
