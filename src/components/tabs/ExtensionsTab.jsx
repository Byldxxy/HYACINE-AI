import React, { useEffect, useState } from 'react';
import { PageHeader, Section, Toggle, InputGroup, Button, TabContent } from '../UIComponents';
import PinkSelect from '../PinkSelect';
import { apiRequest, apiUrl } from '../../lib/api';
const splitExamples = value => [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
const validExamples = examples => examples.length <= 6 && examples.every(line => line.length <= 60);
function ExampleField({ value, onChange, busy }) {
    return <label className="field-group"><span className="field-label">触发例句 · 可选</span>
        <textarea rows={2} className="ui-input" value={value} placeholder="例如，原则上可以" disabled={busy} onChange={e => onChange(e.target.value)} />
        <span className="field-hint">每行一句，最多 6 句，每句 60 字。</span></label>;
}
function StickerRow({ item, busy, onSave, onRemove }) {
    const [meaning, setMeaning] = useState(item.meaning), [scope, setScope] = useState(item.scope);
    const [examples, setExamples] = useState((item.triggers || []).join('\n'));
    const triggers = splitExamples(examples);
    const dirty = meaning !== item.meaning || scope !== item.scope || JSON.stringify(triggers) !== JSON.stringify(item.triggers || []);
    return <details className="border-t border-pink-100 py-2">
        <summary className="flex cursor-pointer items-center gap-4 rounded-xl p-1 hover:bg-pink-50/60">
            <img loading="lazy" src={apiUrl('/api/stickers/' + item.id + '/image')} alt="" className="w-14 h-14 object-contain" />
            <span className="min-w-0 flex-1 break-words"><strong className="block text-sm">{item.meaning}</strong><span className="field-hint">{item.scope || '共享素材'}</span></span>
            <span className="field-hint">编辑</span>
        </summary>
        <div className="space-y-3 py-3">
            <InputGroup disabled={busy} label="含义与使用场景" value={meaning} onChange={e => setMeaning(e.target.value.slice(0, 200))} />
            <ExampleField value={examples} busy={busy} onChange={setExamples} />
            <InputGroup disabled={busy} label="限定会话" hint="留空共享；群内收录默认限定原会话。" value={scope} onChange={e => setScope(e.target.value.slice(0, 150))} />
            <span className="field-hint">{item.source?.startsWith('chat:') ? '教学者 ' + item.source.slice(5) : '后台素材'}{item.imageAuthor && ' · 原图作者 ' + item.imageAuthor} · {Math.ceil(item.bytes / 1024)} KB</span>
            <div className="flex gap-3"><Button disabled={busy || !dirty || !meaning.trim() || !validExamples(triggers)} onClick={() => onSave(item.id, { meaning, scope, triggers })}>保存素材</Button>
                <Button variant="ghost" disabled={busy} onClick={() => onRemove(item.id)}>移除</Button></div>
        </div>
    </details>;
}
export default function ExtensionsTab({ config, handleChange }) {
    const [error, setError] = useState(''), [items, setItems] = useState([]), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [page, setPage] = useState(0);
    const [search, setSearch] = useState(''), [scopeFilter, setScopeFilter] = useState('all');
    const [uploadDraft, setUploadDraft] = useState(null);
    useEffect(() => {
        const controller = new AbortController();
        apiRequest('/api/stickers', { signal: controller.signal }).then(data => { setItems(data); setLoaded(true); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
        return () => controller.abort();
    }, []);
    const refresh = async () => { setItems(await apiRequest('/api/stickers')); setLoaded(true); };
    const mutate = async (path, method, body) => {
        setBusy(true); setError('');
        try { const result = await apiRequest(path, { method, body }); await refresh(); return result; }
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
            setUploadDraft({ data, meaning: '', examples: '', scope: scopeFilter.startsWith('scope:') ? scopeFilter.slice(6) : '' });
        } catch (e) { setError(e.message || '图片读取失败。'); } finally { setBusy(false); }
    };
    const scopeOptions = [...new Set(items.map(item => item.scope).filter(Boolean))];
    const query = search.trim().toLocaleLowerCase();
    const filtered = [...items].reverse().filter(item => (scopeFilter === 'all' || (scopeFilter === 'shared' ? !item.scope : item.scope === scopeFilter.slice(6)))
        && (!query || [item.meaning, item.scope, item.source, ...(item.triggers || [])].some(value => String(value || '').toLocaleLowerCase().includes(query))));
    const pages = Math.max(1, Math.ceil(filtered.length / 8)), currentPage = Math.min(page, pages - 1);
    async function confirmUpload() {
        if (!uploadDraft?.meaning.trim()) return;
        const { examples, ...image } = uploadDraft;
        const triggers = splitExamples(examples);
        if (!validExamples(triggers)) return;
        const added = await mutate('/api/stickers', 'POST', { ...image, triggers });
        if (added) {
            setUploadDraft(null); setSearch(''); setScopeFilter(added.item?.scope ? 'scope:' + added.item.scope : 'shared');
            setPage(0);
            if (added.item?.meaning !== image.meaning.trim()) setError('这张图已收录，可展开已有素材修改含义。');
        }
    }
    return <TabContent>
        <PageHeader title="扩展" description="独立启用，共用会话与消息发送流程。" />
        <Section title="表情包">
            <Toggle label="使用表情包" checked={config.enableStickers === true} onChange={v => handleChange('enableStickers', v)} description="合适时只回一张图，同群的回复和主动发言共用发送间隔。" />
            <div className="mt-4 space-y-4">
                <InputGroup label="发送间隔（秒）" type="number" value={config.stickerCooldown ?? 180} onChange={e => handleChange('stickerCooldown', Math.min(3600, Math.max(30, Number(e.target.value) || 30)))} />
                <div className="field-group"><span className="field-label">群内收录</span><PinkSelect label="群内收录" value={config.stickerLearning || 'off'} options={[{ value: 'off', label: '关闭' }, { value: 'owner', label: '仅主人' }, { value: 'members', label: '所有成员' }]} onChange={v => handleChange('stickerLearning', v)} /><span className="field-hint">引用一张图说「风堇，记一下，这张在我们群是‘表面赞同’」，或随图发送「/收录表情 含义」。</span></div>
            </div>
        </Section>
        <Section title={`素材库 · ${items.length}/100`} description="素材操作单独保存；开关和间隔使用页面底部的保存配置。" action={<Button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>刷新</Button>}>
            <label className="field-group mb-5"><span className="field-label">添加图片</span><input disabled={busy || !loaded} aria-label="添加表情包" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={upload} /><span className="field-hint">单张最多 512 KB，图片独立保存在本地。</span></label>
            {uploadDraft && <div className="mb-5 grid gap-3 rounded-2xl bg-pink-50/50 p-4">
                <img src={uploadDraft.data} className="max-w-28 max-h-28 object-contain" alt="待收录表情" />
                <InputGroup label="这张图适合什么时候发？" placeholder="例如，嘴上同意，其实在吐槽" disabled={busy} value={uploadDraft.meaning} onChange={e => setUploadDraft({ ...uploadDraft, meaning: e.target.value.slice(0, 200) })} />
                <ExampleField value={uploadDraft.examples} busy={busy} onChange={examples => setUploadDraft({ ...uploadDraft, examples })} />
                <InputGroup label="限定会话" placeholder="留空共享，或填写 group_群号" disabled={busy} value={uploadDraft.scope} onChange={e => setUploadDraft({ ...uploadDraft, scope: e.target.value.trim().slice(0, 150) })} />
                <div className="flex gap-3"><Button disabled={busy || !uploadDraft.meaning.trim() || !validExamples(splitExamples(uploadDraft.examples))} onClick={confirmUpload}>收录素材</Button><Button disabled={busy} variant="ghost" onClick={() => setUploadDraft(null)}>取消</Button></div>
            </div>}
            {items.length > 0 && <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <InputGroup label="查找素材" placeholder="含义、例句、群号或教学者" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
                <div className="field-group"><span className="field-label">素材范围</span><PinkSelect label="素材范围" value={scopeFilter}
                    options={[{ value: 'all', label: '全部会话' }, { value: 'shared', label: '共享素材' }, ...scopeOptions.map(scope => ({ value: 'scope:' + scope, label: scope }))]}
                    onChange={value => { setScopeFilter(value); setPage(0); }} /></div>
            </div>}
            {error && <p role="alert" className="text-rose-600 my-3">{error}</p>}
            {!loaded && !error && <p role="status">正在读取素材…</p>}
            {loaded && !filtered.length && <p className="field-hint">{items.length ? '没有匹配的表情' : '暂无素材'}</p>}
            {filtered.slice(currentPage * 8, currentPage * 8 + 8).map(item => <StickerRow key={`${item.id}:${item.meaning}:${item.scope}:${JSON.stringify(item.triggers)}`} item={item} busy={busy} onSave={(id, body) => mutate(`/api/stickers/${id}`, 'PATCH', body)} onRemove={id => mutate(`/api/stickers/${id}`, 'DELETE')} />)}
            {pages > 1 && <div className="flex items-center justify-end gap-3"><Button disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button><span>{currentPage + 1} / {pages}</span><Button disabled={busy || currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</Button></div>}
        </Section>
        <Section title="短语音">
            <Toggle label="NapCat 语音转文字" checked={config.enableVoiceTranscription === true} onChange={v => handleChange('enableVoiceTranscription', v)}
                description="开启后，收到的群聊和私聊短语音会交给所选转写服务。支持 60 秒以内、转换后不超过 6 MiB 的音频。" />
            {config.enableVoiceTranscription && <div className="mt-4 space-y-4">
                <InputGroup label="转写模型" value={config.voiceModel ?? 'whisper-1'} onChange={e => handleChange('voiceModel', e.target.value)} />
                <InputGroup label="转写接口" placeholder="留空使用聊天服务的转写接口" value={config.voiceEndpoint || ''} onChange={e => handleChange('voiceEndpoint', e.target.value)} />
                <InputGroup label="转写 API Key" type="password" hint="同源服务可沿用聊天密钥；独立服务可单独填写。" value={config.voiceApiKey || ''} onChange={e => handleChange('voiceApiKey', e.target.value)} />
            </div>}
        </Section>
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
    </TabContent>;
}
