import React, { memo, useEffect, useMemo, useState } from 'react';
import PinkSelect from './PinkSelect';
import { apiRequest } from '../lib/api';

const kinds = { direct: '直接回复', continuation: '话题续聊', proactive: '主动参与', learning: '记忆学习', summary: '会话摘要' };
const outcomes = { sent: '已发送', silent: '沉默', stale: '已过期', error: '失败', completed: '已完成' };
const fields = ['turns', 'calls', 'unknownUsage', 'inputTokens', 'outputTokens', 'queued', 'queueMs', 'modelMs', 'deliveries', 'deliveryMs', ...Object.keys(outcomes)];
const empty = () => Object.fromEntries(fields.map(key => [key, 0]));
const number = new Intl.NumberFormat('zh-CN');
const groupLabel = group => group === 'private' ? '私聊汇总' : group === 'other' ? '其他群汇总' : '群 ' + group.replace(/^group_/, '');

function dayOptions(today) {
    const options = [{ value: 'all', label: '近 7 天' }, { value: 'today', label: '今天' }];
    const cursor = new Date(today + 'T12:00:00Z');
    for (let offset = 1; offset < 7; offset++) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
        const day = cursor.toISOString().slice(0, 10);
        options.push({ value: day, label: day });
    }
    return options;
}
function average(ms, count) {
    if (!count) return '—';
    const duration = ms / count;
    return duration < 1000 ? Math.round(duration) + ' ms' : (duration / 1000).toFixed(1) + ' s';
}
function Latency({ totals }) {
    return <dl className="usage-metrics-grid usage-latency">
        <div><dt>平均排队</dt><dd>{average(totals.queueMs, totals.queued)}</dd></div>
        <div><dt>平均生成</dt><dd>{average(totals.modelMs, totals.calls)}</dd></div>
        <div><dt>平均发送</dt><dd>{average(totals.deliveryMs, totals.deliveries)}</dd></div>
    </dl>;
}
function OutcomeList({ totals }) {
    return <dl className="usage-outcomes">{Object.entries(outcomes).map(([key, label]) =>
        totals[key] > 0 && <div key={key}><dt>{label}</dt><dd>{number.format(totals[key])}</dd></div>)}</dl>;
}
function UsageMetrics() {
    const [snapshot, setSnapshot] = useState(null), [failure, setFailure] = useState('');
    const [request, setRequest] = useState(0), [loading, setLoading] = useState(true);
    const [date, setDate] = useState('today'), [group, setGroup] = useState('all');
    useEffect(() => {
        const controller = new AbortController();
        apiRequest('/api/metrics', { signal: controller.signal }).then(data => {
            if (!Array.isArray(data?.rows) || !/^\d{4}-\d{2}-\d{2}$/.test(data.today)) throw new Error('统计数据格式无效');
            if (!controller.signal.aborted) setSnapshot(data);
        }).catch(error => { if (!controller.signal.aborted) setFailure(error.message); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [request]);
    const dates = useMemo(() => snapshot ? dayOptions(snapshot.today) : [], [snapshot]);
    const groups = useMemo(() => [{ value: 'all', label: '全部会话' }, ...[...new Set(snapshot?.rows.map(row => row.group))].sort()
        .map(value => ({ value, label: groupLabel(value) }))], [snapshot]);
    const selectedDate = dates.some(option => option.value === date) ? date : 'today';
    const selectedGroup = groups.some(option => option.value === group) ? group : 'all';
    const { totals, byKind } = useMemo(() => {
        const totals = empty(), byKind = {};
        for (const row of snapshot?.rows || []) {
            if (selectedDate !== 'all' && row.date !== (selectedDate === 'today' ? snapshot.today : selectedDate)) continue;
            if (selectedGroup !== 'all' && selectedGroup !== row.group) continue;
            if (!Object.hasOwn(kinds, row.kind)) continue;
            const part = byKind[row.kind] ||= empty();
            for (const key of fields) { totals[key] += row[key]; part[key] += row[key]; }
        }
        return { totals, byKind };
    }, [snapshot, selectedDate, selectedGroup]);

    return <>
        {snapshot && <div className="log-drawer-filters usage-filters">
            <PinkSelect label="统计日期" value={selectedDate} options={dates} onChange={setDate} />
            <PinkSelect label="统计会话" value={selectedGroup} options={groups} onChange={setGroup} />
        </div>}
        <div className="log-drawer-stream custom-scrollbar usage-metrics" aria-label="调用统计" aria-busy={loading}>
            {failure && <p className="usage-error" role="alert">统计读取失败。{failure}</p>}
            {!snapshot && loading && <div className="log-drawer-empty" role="status">正在读取统计…</div>}
            {snapshot && (totals.turns === 0 ? <div className="log-drawer-empty">所选范围暂无调用记录</div> : <>
                <dl className="usage-metrics-grid usage-totals">
                    <div><dt>模型调用</dt><dd>{number.format(totals.calls)}</dd></div>
                    <div><dt>输入 Token</dt><dd>{number.format(totals.inputTokens)}</dd></div>
                    <div><dt>输出 Token</dt><dd>{number.format(totals.outputTokens)}</dd></div>
                </dl>
                {totals.unknownUsage > 0 && <p className="usage-note">{number.format(totals.unknownUsage)} 次调用缺少完整用量，Token 仅累计已报告值。</p>}
                <Latency totals={totals} />
                <OutcomeList totals={totals} />
                <h3>按任务类型</h3>
                {Object.entries(kinds).map(([kind, label]) => {
                    const part = byKind[kind];
                    if (!part) return null;
                    return <details key={kind} className="usage-kind">
                        <summary><span>{label}</span><small>{number.format(part.calls)} 次调用</small></summary>
                        <dl className="usage-metrics-grid">
                            <div><dt>输入 Token</dt><dd>{number.format(part.inputTokens)}</dd></div>
                            <div><dt>输出 Token</dt><dd>{number.format(part.outputTokens)}</dd></div>
                            <div><dt>用量缺报</dt><dd>{number.format(part.unknownUsage)} 次</dd></div>
                        </dl>
                        <Latency totals={part} />
                        <OutcomeList totals={part} />
                    </details>;
                })}
            </>)}
        </div>
        <footer className="log-drawer-footer"><span>近 7 天 · 按后端本地日期统计</span>
            <button type="button" disabled={loading} onClick={() => { setFailure(''); setLoading(true); setRequest(i => i + 1); }}>{loading ? '读取中…' : '刷新统计'}</button>
        </footer>
    </>;
}
export default memo(UsageMetrics);
