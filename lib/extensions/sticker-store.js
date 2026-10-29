/** Metadata and content-addressed images live outside the configuration snapshot. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { atomicWriteJson, readJsonWithBackup } = require('../json-store');
const fail = message => Object.assign(new Error(message), { code: 'invalid-data' });
function decodeImage(data) {
    const match = String(data).match(/^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw fail('图片格式无效');
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.length > 512 * 1024) throw fail('图片必须小于 512 KB');
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : /^GIF8[79]a/.test(bytes.subarray(0, 6).toString()) ? 'image/gif' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : null;
    if (!mime) throw fail('文件不是受支持的图片');
    return { bytes, mime, hash: createHash('sha256').update(bytes).digest('hex') };
}
function fields(input) {
    if (typeof input.meaning !== 'string' || !input.meaning.trim() || input.meaning.length > 200) throw fail('请填写 1–200 字的含义');
    if (input.scope != null && (typeof input.scope !== 'string' || input.scope.length > 150)) throw fail('会话范围无效');
    return { meaning: input.meaning.trim(), scope: input.scope || '' };
}
function createStickerStore(dir) {
    const index = path.join(dir, 'index.json'); let items = [], queue = Promise.resolve();
    function mutate(fn) { const task = queue.then(fn); queue = task.catch(() => {}); return task; }
    async function cleanup() {
        try {
            const backup = JSON.parse(await fs.readFile(`${index}.bak`, 'utf8').catch(() => '[]'));
            const keep = new Set([...items, ...(Array.isArray(backup) ? backup : [])].map(s => s.hash));
            for (const name of await fs.readdir(dir)) if (/^[a-f0-9]{64}$/.test(name) && !keep.has(name)) await fs.rm(path.join(dir, name), { force: true });
        } catch { /* Failed cleanup must not roll back an acknowledged mutation. */ }
    }
    return {
        async load() {
            await fs.mkdir(dir, { recursive: true });
            items = await readJsonWithBackup(index, { fallback: [], label: '表情素材', validate(value) {
                if (!Array.isArray(value) || value.length > 100 || value.some(s => !/^[a-f0-9]{64}$/.test(s.hash) || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id))) throw fail('素材索引无效');
                value.forEach(fields); return value;
            } });
        },
        list: () => items.map(s => ({ ...s })),
        add(input) { return mutate(async () => {
            const meta = fields(input), image = decodeImage(input.data);
            const existing = items.find(s => s.hash === image.hash && s.scope === meta.scope);
            if (existing) return { ...existing };
            if (items.length >= 100) throw fail('素材库已达到 100 张上限');
            const record = { id: randomUUID(), ...meta, hash: image.hash, mime: image.mime, bytes: image.bytes.length, source: String(input.source || 'manual').slice(0, 160), createdAt: new Date().toISOString() };
            await fs.writeFile(path.join(dir, image.hash), image.bytes, { flag: 'w' });
            const next = [...items, record]; await atomicWriteJson(index, next); items = next; await cleanup(); return { ...record };
        }); },
        update(id, input) { return mutate(async () => {
            if (!items.some(s => s.id === id)) throw fail('素材不存在，请刷新');
            const meta = fields(input), next = items.map(s => s.id === id ? { ...s, ...meta } : s);
            await atomicWriteJson(index, next); items = next; await cleanup();
        }); },
        remove(id) { return mutate(async () => {
            const next = items.filter(s => s.id !== id); await atomicWriteJson(index, next); items = next; await cleanup();
            // Keep blobs referenced by the index backup available for crash recovery.
        }); },
        async image(id) {
            const item = items.find(s => s.id === id); if (!item) throw fail('素材不存在');
            return { bytes: await fs.readFile(path.join(dir, item.hash)), mime: item.mime };
        },
    };
}
module.exports = { createStickerStore, decodeImage };
