import React, { useEffect, useRef, useState } from 'react';
import { Button, InputGroup } from '../UIComponents';
import PinkSelect from '../PinkSelect';
import { apiRequest, apiUrl } from '../../lib/api';

const STORAGE = 'hyacine.group-replay.examples.v1';
const OUTCOMES = [{ value: 'reply', label: '接话' }, { value: 'sticker', label: '只发表情' }, { value: 'silent', label: '旁听' }];
const PRESETS = [
    { id: 'example-topic', title: '两件事同时聊', expected: 'reply', targetLine: 3, transcript: '小白：@机器人 周日怎么还要上班？\n机器人：调休把周末借走了。\n小白：好想请假，公司连中间三天都不给批。\n阿洛：@阿青 今晚还打游戏吗？\n阿青：[#4] 九点上。' },
    { id: 'example-sticker', title: '接群里的梗', expected: 'sticker', transcript: '阿青：领导同意放假了吗？\n机器人：他怎么说？\n阿青：原话是“原则上可以”。' },
    { id: 'example-silent', title: '群友之间的问答', expected: 'silent', transcript: '阿青：周日要加班。\n机器人：好惨，还是原来那家公司？\n小白：@阿洛 今晚九点还打吗？\n阿洛：[#3] 我九点半到。' },
];
function loadCases() {
    try {
        const items = JSON.parse(localStorage.getItem(STORAGE) || '[]');
        return Array.isArray(items) ? items.filter(s => s && typeof s.id === 'string' && typeof s.title === 'string' && typeof s.transcript === 'string' && OUTCOMES.some(o => o.value === s.expected)).slice(0, 24) : [];
    } catch { return []; }
}
export default function GroupReplay() {
    const [saved, setSaved] = useState(loadCases);
    const [selected, setSelected] = useState(PRESETS[0]);
    const [scopes, setScopes] = useState([]), [result, setResult] = useState(null), [error, setError] = useState('');
    const [running, setRunning] = useState(false);
    const request = useRef(null);
    useEffect(() => {
        const controller = new AbortController();
        apiRequest('/api/stickers', { signal: controller.signal })
            .then(list => setScopes([...new Set(list.map(s => s.scope).filter(Boolean))]))
            .catch(e => { if (!controller.signal.aborted) setError(e.message); });
        return () => { controller.abort(); request.current?.abort(); };
    }, []);
    const apply = next => { setSelected(next); setError(''); setResult(null); };
    const change = patch => apply({ ...selected, ...patch });
    const cases = [...PRESETS, ...saved];
    const isSaved = saved.some(s => s.id === selected.id);
    function persist(items) {
        try { localStorage.setItem(STORAGE, JSON.stringify(items)); setSaved(items); return true; }
        catch { setError('浏览器未能保存片段'); return false; }
    }
    function save() {
        if (!selected.title.trim() || !selected.transcript.trim()) return;
        if (!isSaved && saved.length >= 24) { setError('最多保存 24 个片段'); return; }
        const value = { ...selected, id: isSaved ? selected.id : 'local-' + (globalThis.crypto?.randomUUID?.() ?? Date.now()), title: selected.title.trim() };
        if (persist(isSaved ? saved.map(item => item.id === value.id ? value : item) : [...saved, value])) apply(value);
    }
    async function run() {
        if (request.current || !selected.transcript.trim()) return;
        const controller = new AbortController(); request.current = controller;
        setRunning(true); setResult(null); setError('');
        try {
            const data = await apiRequest('/api/group-replay', { method: 'POST', body: { transcript: selected.transcript, scope: selected.scope || '', targetLine: selected.targetLine ? Number(selected.targetLine) : undefined }, signal: controller.signal });
            if (!controller.signal.aborted) setResult(data);
        } catch (e) { if (!controller.signal.aborted) setError(e.message); }
        finally { if (!controller.signal.aborted) setRunning(false); if (request.current === controller) request.current = null; }
    }
    return <div className="group-replay custom-scrollbar">
        <fieldset disabled={running} className="replay-fields">
            <div className="replay-pair">
                <div className="field-group"><span className="field-label">选择片段</span><PinkSelect label="选择片段" value={selected.id}
                    options={cases.map(s => ({ value: s.id, label: s.title }))} onChange={id => apply(cases.find(s => s.id === id))} /></div>
                <InputGroup label="片段名称" value={selected.title} onChange={e => change({ title: e.target.value.slice(0, 48) })} />
            </div>
            <label className="field-group"><span className="field-label">群聊片段</span>
                <textarea className="conversation-input replay-script" value={selected.transcript} maxLength={12000} rows={7}
                    onChange={e => change({ transcript: e.target.value })} />
                <span className="field-hint">每行写「成员：消息」；@机器人 表示点名，消息开头的 [#2] 引用第 2 行。</span>
            </label>
            <div className="replay-pair">
                <InputGroup label="回放行号" type="number" placeholder="默认最后一行" value={selected.targetLine ?? ''} onChange={e => change({ targetLine: e.target.value })} hint="后续群友发言模拟等待回复时的插话。" />
                <div className="field-group"><span className="field-label">期望反应</span><PinkSelect label="期望反应" value={selected.expected} options={OUTCOMES} onChange={expected => change({ expected })} /></div>
                <div className="field-group"><span className="field-label">表情素材范围</span><PinkSelect label="表情素材范围" value={selected.scope || ''}
                    options={[{ value: '', label: '共享素材' }, ...[...new Set([...scopes, selected.scope].filter(Boolean))].map(scope => ({ value: scope, label: scope }))]} onChange={scope => change({ scope })} /></div>
            </div>
            <InputGroup label="参考接法 · 可选" hint="仅供对照，模型不会看到这段文字。" value={selected.reference || ''}
                onChange={e => change({ reference: e.target.value.slice(0, 240) })} />
            <div className="replay-actions">
                <Button variant="primary" disabled={!selected.transcript.trim() || running} onClick={run}>{running ? '回放中…' : '运行回放'}</Button>
                <Button disabled={!selected.title.trim() || !selected.transcript.trim()} onClick={save}>保存片段</Button>
                {isSaved && <Button variant="ghost" onClick={() => { if (persist(saved.filter(s => s.id !== selected.id))) apply(PRESETS[0]); }}>移除片段</Button>}
            </div>
        </fieldset>
        {error && <p className="conversation-error" role="alert">{error}</p>}
        {result && <section className="replay-result" aria-live="polite">
            <strong>{OUTCOMES.find(o => o.value === result.kind)?.label} · {result.kind === selected.expected ? '符合预期' : '与预期不同'}</strong>
            {result.outputs.map((output, index) => output.type === 'sticker'
                ? <img key={index} src={apiUrl('/api/stickers/' + encodeURIComponent(output.id) + '/image')} alt="选中的表情" />
                : <p key={index}>{output.type === 'text' ? output.text : '生图请求'}</p>)}
            {result.kind === 'silent' && <p>{result.modelCalled ? '已调用模型，本轮未发送内容。' : '本条消息未触发回复。'}</p>}
            {selected.reference && <p>参考接法 · {selected.reference}</p>}
        </section>}
    </div>;
}
