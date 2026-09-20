/** Both pet and tray menus use the same snapshot and command dispatcher. */
function createPetMenuTemplate(state, execute) {
    const command = (id, label, extra = {}) => ({ id, label, ...extra, click: item => execute(id, item.checked) });
    const check = (id, label, checked, enabled = true) => command(id, label, { type: 'checkbox', checked: Boolean(checked), enabled });
    return [
        command('config', '打开配置面板'),
        { type: 'separator' },
        check('visible', '显示桌宠', state.visible),
        check('passthrough', '鼠标穿透', state.passthrough),
        check('topmost', '始终置顶', state.topmost),
        check('roaming', '窗口散步与攀爬', state.roaming),
        command('floor', '回到桌面', { enabled: state.visible }),
        command('greet', '打个招呼', { enabled: state.visible }),
        command('size', '调整大小…'),
        { type: 'separator' },
        check('awareness', '桌面感知', state.awareness, state.serverReady),
        check('capture', '截图隐藏桌宠', state.hideFromCapture, state.serverReady),
        command('observe', '看看桌面', { enabled: state.serverReady && state.visible }),
        { type: 'separator' },
        command('quit', '退出'),
    ];
}
function visiblePetViewport(bounds, area) {
    const x = Math.max(0, area.x - bounds.x), y = Math.max(0, area.y - bounds.y);
    return { x, y, width: Math.max(0, Math.min(bounds.width, area.x + area.width - bounds.x) - x), height: Math.max(0, Math.min(bounds.height, area.y + area.height - bounds.y) - y) };
}
module.exports = { createPetMenuTemplate, visiblePetViewport };
