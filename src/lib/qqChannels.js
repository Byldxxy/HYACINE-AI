export const qqChannelLabel = provider => ({ napcat: 'NapCat', snowluma: 'SnowLuma', qqbot: '官方 QQ Bot' }[provider] || 'NapCat');
export function qqConnectionLabel(qq) {
    if (!qq) return '等待后端';
    if (qq.provider === 'qqbot') return qq.state === 'unconfigured' ? '待配置' : qq.connected ? '回调已验证' : '等待事件回调';
    if (qq.connected) return '已连接';
    return ({ 'account-offline': 'QQ 账号离线', connecting: '连接中', reconnecting: '正在重连', 'connection-error': '连接异常', unconfigured: '待配置' })[qq.state] || '未连接';
}
