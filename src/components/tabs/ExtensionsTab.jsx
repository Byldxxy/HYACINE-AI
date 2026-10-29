import React, { useEffect, useState } from 'react';
import { PageHeader, Section, Toggle, InputGroup, Button, TabContent } from '../UIComponents';
import PinkSelect from '../PinkSelect';
import { apiRequest, apiUrl } from '../../lib/api';
function StickerRow({ item, busy, onSave, onRemove }) {
    const [meaning, setMeaning] = useState(item.meaning), [scope, setScope] = useState(item.scope);
    const dirty = meaning !== item.meaning || scope !== item.scope;
    return <div className="flex flex-wrap items-start gap-4 border-t border-pink-100 py-5">
        <img loading="lazy" src={apiUrl(`/api/stickers/${item.id}/image`)} alt={item.meaning} className="w-20 h-20 object-contain" />
        <div className="flex-1 min-w-48 space-y-3">
            <InputGroup disabled={busy} label="含义与使用场景" value={meaning} onChange={e => setMeaning(e.target.value.slice(0, 200))} />
            <InputGroup disabled={busy} label="限定会话" hint="留空共享；群内收录默认只在原会话使用。" value={scope} onChange={e => setScope(e.target.value.slice(0, 150))} />
            <span className="field-hint">{item.source?.startsWith('chat:') ? `群内教学 · ${item.source.slice(5)}` : '后台素材'} · {Math.ceil(item.bytes / 1024)} KB</span>
        </div>
        <Button disabled={busy || !dirty || !meaning.trim()} onClick={() => onSave(item.id, { meaning, scope })}>保存素材</Button>
        <Button disabled={busy} onClick={() => onRemove(item.id)}>移除</Button>
    </div>;
}
export default function ExtensionsTab({ config, handleChange }) {
    const [error, setError] = useState(''), [items, setItems] = useState([]), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [page, setPage] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        apiRequest('/api/stickers', { signal: controller.signal }).then(data => { setItems(data); setLoaded(true); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
        return () => controller.abort();
    }, []);
    const refresh = async () => { setItems(await apiRequest('/api/stickers')); setLoaded(true); };
    const mutate = async (path, method, body) => {
        setBusy(true); setError('');
        try { await apiRequest(path, { method, body }); await refresh(); }
        catch (e) { setError(e.message); } finally { setBusy(false); }
    };
    const upload = async event => {
        const file = event.target.files?.[0]; event.target.value = ''; setError('');
        if (!file) return;
        if (items.length >= 100) { setError('最多保存 100 张表情。'); return; }
        if (!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type) || file.size > 512 * 1024) { setError('请选择不超过 512 KB 的 PNG、JPEG、GIF 或 WebP。'); return; }
        setBusy(true);
        try {
            const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
            await apiRequest('/api/stickers', { method: 'POST', body: { data, meaning: file.name.replace(/\.[^.]+$/, '').slice(0,200) || '表情', scope: '' } });
            await refresh();
        } catch (e) { setError(e.message || '图片读取失败。'); } finally { setBusy(false); }
    };
    const pages = Math.max(1, Math.ceil(items.length / 8)), currentPage = Math.min(page, pages - 1);
    return <TabContent>
        <PageHeader title="扩展" description="独立启用，共用会话与消息发送流程。" />
        <Section title="情绪与记忆" description="短期情绪影响表达，长期品味继续在记忆页管理。">
            <Toggle label="情绪连续性" checked={config.enableAffect === true} onChange={v => handleChange('enableAffect', v)} description="按会话与成员隔离，依据当前发言形成短期表达倾向，不增加模型请求。" />
            <div className="mt-4 space-y-4">
                <InputGroup label="情绪半衰期（分钟）" type="number" value={config.affectHalfLife ?? 30} onChange={e => handleChange('affectHalfLife', Math.max(5, Math.min(120, Number(e.target.value) || 30)))} />
                <div className="field-group"><span className="field-label">记忆召回</span><PinkSelect label="记忆召回" value={config.memoryRecallMode || 'balanced'} options={[{ value: 'balanced', label: '均衡 · 保留少量背景' }, { value: 'focused', label: '聚焦 · 优先当前话题' }]} onChange={v => handleChange('memoryRecallMode', v)} /><span className="field-hint">需要在记忆页启用长期记忆。后台固定条目始终优先，自动形成的无关偏好可被聚焦模式过滤。</span></div>
                <Button disabled={busy} onClick={() => mutate('/api/extensions/affect', 'DELETE')}>清除短期情绪</Button>
            </div>
        </Section>
        <Section title="B 站" description="支持 BV 号、完整视频链接、b23 短链接及 OneBot 视频卡片。">
            <Toggle label="链接理解" checked={config.enableBilibili === true} onChange={v => handleChange('enableBilibili', v)} description="获取标题、简介及可公开读取的字幕；支持分 P，不主动刷视频或发表评论。" />
        </Section>
        <Section title="表情包">
            <Toggle label="使用表情包" checked={config.enableStickers === true} onChange={v => handleChange('enableStickers', v)} description="每轮最多一张，发送间隔按会话独立计算。" />
            <div className="mt-4 space-y-4">
                <InputGroup label="发送间隔（秒）" type="number" value={config.stickerCooldown ?? 180} onChange={e => handleChange('stickerCooldown', Math.min(3600, Math.max(30, Number(e.target.value) || 30)))} />
                <div className="field-group"><span className="field-label">群内收录</span><PinkSelect label="群内收录" value={config.stickerLearning || 'off'} options={[{ value: 'off', label: '关闭' }, { value: 'owner', label: '仅主人' }, { value: 'members', label: '所有成员' }]} onChange={v => handleChange('stickerLearning', v)} /><span className="field-hint">将一张图片与「/收录表情 含义」一起发送。收录开关独立于发送开关；仅主人模式使用当前 QQ 渠道的主人配置。</span></div>
            </div>
        </Section>
        <Section title={`素材库 · ${items.length}/100`} description="素材操作单独保存；开关和间隔使用页面底部的保存配置。" action={<Button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>刷新</Button>}>
            <label className="field-group mb-5"><span className="field-label">添加图片</span><input disabled={busy || !loaded} aria-label="添加表情包" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={upload} /><span className="field-hint">单张最多 512 KB，图片独立保存在本地。</span></label>
            {error && <p role="alert" className="text-rose-600 my-3">{error}</p>}
            {!loaded && !error && <p role="status">正在读取素材…</p>}
            {loaded && !items.length && <p className="field-hint">暂无素材</p>}
            {items.slice(currentPage * 8, currentPage * 8 + 8).map(item => <StickerRow key={`${item.id}:${item.meaning}:${item.scope}`} item={item} busy={busy} onSave={(id, body) => mutate(`/api/stickers/${id}`, 'PATCH', body)} onRemove={id => mutate(`/api/stickers/${id}`, 'DELETE')} />)}
            {pages > 1 && <div className="flex items-center justify-end gap-3"><Button disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button><span>{currentPage + 1} / {pages}</span><Button disabled={busy || currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</Button></div>}
        </Section>
    </TabContent>;
}
