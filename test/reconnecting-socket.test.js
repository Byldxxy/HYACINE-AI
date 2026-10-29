const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let createReconnectingSocket;
before(async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/reconnectingSocket.js'), 'utf8');
    ({ createReconnectingSocket } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
});

function harness(overrides = {}) {
    const sockets = [], timers = new Map(), delays = [], messages = [], opened = [];
    let sequence = 0;
    class FakeSocket {
        constructor() { sockets.push(this); this.sent = []; }
        send(value) { this.sent.push(value); }
        close() { this.closed = true; }
    }
    const stop = createReconnectingSocket({
        url: 'ws://test.invalid', identity: 'iam_pet', WebSocketImpl: FakeSocket,
        schedule: (callback, delay) => { delays.push(delay); timers.set(++sequence, callback); return sequence; },
        cancel: id => timers.delete(id),
        onOpen: () => opened.push(true),
        onMessage: event => messages.push(event.data),
        ...overrides,
    });
    const tick = () => {
        const [id, callback] = timers.entries().next().value;
        timers.delete(id); callback();
    };
    return { sockets, timers, delays, messages, opened, stop, tick };
}

test('disposing after disconnect cancels pending reconnection and stale callbacks', () => {
    const h = harness();
    h.sockets[0].onclose();
    const callback = [...h.timers.values()][0];
    h.stop();
    assert.equal(h.timers.size, 0);
    callback();
    assert.equal(h.sockets.length, 1);
});

test('disposal closes the owned socket and ignores late events', () => {
    const h = harness(), socket = h.sockets[0];
    const onOpen = socket.onopen, onMessage = socket.onmessage, onClose = socket.onclose;
    h.stop();
    onOpen(); onMessage({ data: 'stale' }); onClose();
    assert.equal(socket.closed, true);
    assert.deepEqual(socket.sent, []);
    assert.deepEqual(h.messages, []);
    assert.equal(h.timers.size, 0);
});

test('retries have a bounded backoff and reset after a successful connection', () => {
    const h = harness();
    for (let i = 0; i < 6; i++) { h.sockets.at(-1).onclose(); h.tick(); }
    assert.deepEqual(h.delays, [3000, 6000, 12000, 24000, 30000, 30000]);
    const current = h.sockets.at(-1);
    current.onopen(); current.onmessage({ data: 'current' }); current.onclose();
    assert.deepEqual(current.sent, ['iam_pet']);
    assert.deepEqual(h.messages, ['current']);
    assert.equal(h.delays.at(-1), 3000);
    h.stop();
});

test('constructor failures retry without leaking a task after disposal', () => {
    const h = harness({ WebSocketImpl: class { constructor() { throw new Error('offline'); } } });
    assert.equal(h.timers.size, 1);
    h.tick();
    assert.deepEqual(h.delays, [3000, 6000]);
    h.stop();
    assert.equal(h.timers.size, 0);
});
