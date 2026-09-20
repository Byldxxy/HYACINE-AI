/* global ObjC, $ */
// Executed by macOS JavaScript for Automation. CoreGraphics returns front-to-back order.
ObjC.import('CoreGraphics');
const list = $.CGWindowListCopyWindowInfo(17, 0);
// Modern macOS returns an opaque CFArrayRef; older versions bridged it directly.
let entries = ObjC.deepUnwrap(list);
if (!Array.isArray(entries)) entries = ObjC.deepUnwrap(ObjC.castRefToObject(list));
if (!Array.isArray(entries)) throw new Error('CoreGraphics window list unavailable');
const windows = [];
for (const item of entries) {
    const b = item.kCGWindowBounds;
    if (Number(item.kCGWindowLayer) !== 0 || !b || Number(item.kCGWindowAlpha) === 0) continue;
    windows.push({ id: Number(item.kCGWindowNumber), pid: Number(item.kCGWindowOwnerPID), layer: 0,
        bounds: { x: Number(b.X), y: Number(b.Y), width: Number(b.Width), height: Number(b.Height) } });
}
JSON.stringify(windows);
