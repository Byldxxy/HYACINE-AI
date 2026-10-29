/** One owned WebSocket and retry timer per consumer, including during teardown. */
export function createReconnectingSocket({
    url,
    identity,
    onOpen,
    onMessage,
    onSocketChange,
    WebSocketImpl = globalThis.WebSocket,
    schedule = globalThis.setTimeout,
    cancel = globalThis.clearTimeout,
}) {
    let socket = null;
    let retryTimer = null;
    let attempts = 0;
    let disposed = false;

    function retry() {
        if (disposed || retryTimer !== null) return;
        const delay = Math.min(30_000, 3000 * (2 ** Math.min(attempts++, 4)));
        retryTimer = schedule(() => {
            retryTimer = null;
            connect();
        }, delay);
    }

    function detach(current) {
        current.onopen = null;
        current.onmessage = null;
        current.onclose = null;
        current.onerror = null;
    }

    function connect() {
        if (disposed) return;
        let current;
        try {
            current = new WebSocketImpl(url);
        } catch {
            retry();
            return;
        }
        socket = current;
        onSocketChange?.(current);
        const isCurrent = () => !disposed && socket === current;
        current.onopen = () => {
            if (!isCurrent()) return;
            attempts = 0;
            current.send(identity);
            onOpen?.();
        };
        current.onmessage = event => {
            if (isCurrent()) onMessage?.(event);
        };
        current.onclose = () => {
            if (!isCurrent()) return;
            detach(current);
            socket = null;
            onSocketChange?.(null);
            retry();
        };
    }

    connect();
    return () => {
        disposed = true;
        if (retryTimer !== null) cancel(retryTimer);
        retryTimer = null;
        if (socket) {
            detach(socket);
            socket.close();
            socket = null;
        }
        onSocketChange?.(null);
    };
}
