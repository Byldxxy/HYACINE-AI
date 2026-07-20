/**
 * Normalize parent-process IPC for two launch modes:
 * - Electron utilityProcess: process.parentPort
 * - Node child_process.fork / legacy development: process.send
 *
 * Keeping this adapter inside the backend prevents Electron-specific transport
 * details from leaking into routes and services.
 */
const utilityParentPort = process.parentPort || null;
const nodeForkAvailable = typeof process.send === 'function';

function onParentMessage(listener) {
    if (utilityParentPort) {
        const wrapped = event => listener(event.data);
        utilityParentPort.on('message', wrapped);
        return () => utilityParentPort.off('message', wrapped);
    }
    if (nodeForkAvailable) {
        process.on('message', listener);
        return () => process.off('message', listener);
    }
    return () => {};
}

function sendToParent(message) {
    if (utilityParentPort) {
        utilityParentPort.postMessage(message);
        return true;
    }
    if (nodeForkAvailable) {
        process.send(message);
        return true;
    }
    return false;
}

module.exports = {
    hasParentIpc: Boolean(utilityParentPort || nodeForkAvailable),
    onParentMessage,
    sendToParent,
};
