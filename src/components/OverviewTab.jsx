import React from 'react';
import { qqChannelLabel, qqConnectionLabel } from '../lib/qqChannels';
import { ArrowUpRight, Circle } from 'lucide-react';
import { Button, TabContent } from './UIComponents';

export default function OverviewTab({ config, status, statusError, loading, onNavigate, onLogs, logs, dirty }) {
    const items = [
        { id: 'connect', title: 'QQ 连接', value: qqConnectionLabel(status?.qq), ready: status?.qq.connected, detail: qqChannelLabel(status?.qq?.provider) },
        { id: 'ai', title: '模型', value: !status ? '等待后端' : status.model.configured ? '已配置' : '待配置', ready: status?.model.configured, detail: dirty ? '配置存在未保存修改' : config.modelName || '文本与图片理解' },
        { id: 'persona', title: '角色', value: config.charName && config.charName !== 'AI 助手' ? config.charName : '待设定', ready: Boolean(config.systemPrompt), detail: config.systemPrompt ? '角色提示已填写' : '设置风堇群聊预设' },
    ];
    const latest = logs.slice(-3).reverse();
    return <TabContent>
        <div className="overview-hero">
            <div className="hero-orbit" aria-hidden="true" />
            <span className="eyebrow">HYACINE AI</span>
            <h1>风堇<span>工作台</span></h1>

            <div className="hero-actions"><Button variant="primary" onClick={() => onNavigate('test')}>开始对话<ArrowUpRight size={16} /></Button><Button onClick={() => onNavigate('persona')}>编辑人设</Button></div>
            <div className="hero-footer"><span className={`status-dot ${status?.ready && !statusError ? 'is-online' : ''}`} />{loading ? '正在读取运行状态' : statusError ? '后端暂不可用' : status?.ready ? '后端已就绪' : '等待后端初始化'}<span className="hero-version">{status?.version ? `v${status.version}` : 'LOCAL WORKSPACE'}</span></div>
        </div>
        <div className="overview-status-grid">{items.map(({ id, title, value, ready, detail }) => <button key={id} type="button" className="overview-status-card" onClick={() => onNavigate(id)}>
            <span className="overview-label">{title}</span><strong>{value}</strong><small><span className={`status-dot ${ready ? 'is-online' : ''}`} />{detail}</small>
        </button>)}</div>
        <div className="overview-bottom-grid">
            <section className="overview-section"><div className="overview-section-heading"><h2>最近活动</h2><button type="button" onClick={onLogs}>查看日志<ArrowUpRight size={13} /></button></div>
                {latest.length ? latest.map((item, i) => <div className="activity-row" key={item.id || i}><Circle size={7} className={item.level === 'error' ? 'text-rose-500' : 'text-pink-300'} /><div><p>{item.content}</p><time>{item.time}</time></div></div>) : <div className="activity-empty">等待新的运行事件</div>}
            </section>
        </div>
    </TabContent>;
}
