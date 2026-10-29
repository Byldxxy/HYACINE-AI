/**
 * 连接与触发配置页。
 *
 * 管理 OneBot 连接、群聊触发、主动发言和桌面感知参数。desktopAwareness 是只读运行状态，
 * config 是尚未保存的表单草稿；更改参数后仍需点击面板底部“保存配置”。
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
    Button,
    IconButton,
    InputGroup,
    PageHeader,
    RangeField,
    Section,
    TabContent,
    Toggle,
} from '../UIComponents';
import PinkSelect from '../PinkSelect';
import { qqChannelLabel, qqConnectionLabel } from '../../lib/qqChannels';
import { apiUrl } from '../../lib/api';

const DESKTOP_STATUS = {
    loading: ['正在读取状态', 'bg-gray-100 text-gray-500'],
    unavailable: ['仅 Electron 可用', 'bg-gray-100 text-gray-500'],
    disabled: ['未启用', 'bg-gray-100 text-gray-500'],
    paused: ['已暂停', 'bg-amber-50 text-amber-700'],
    'pet-hidden': ['桌宠隐藏，采集已停止', 'bg-gray-100 text-gray-500'],
    watching: ['本地观察中', 'bg-emerald-50 text-emerald-700'],
    analyzing: ['视觉分析中', 'bg-pink-50 text-pink-700'],
    excluded: ['当前应用已排除', 'bg-emerald-50 text-emerald-700'],
    idle: ['用户空闲，已暂停', 'bg-gray-100 text-gray-500'],
    'permission-denied': ['缺少屏幕权限', 'bg-red-50 text-red-700'],
    'accessibility-required': ['缺少辅助功能权限', 'bg-red-50 text-red-700'],
    'window-unavailable': ['无法读取前台应用', 'bg-red-50 text-red-700'],
    'screen-source-unavailable': ['主显示器不可捕获', 'bg-red-50 text-red-700'],
    'screen-thumbnail-unavailable': ['主显示器缩略图不可读', 'bg-red-50 text-red-700'],
    'pet-focused': ['桌宠窗口已跳过', 'bg-gray-100 text-gray-500'],
    error: ['观察异常', 'bg-red-50 text-red-700'],
};

export default function ConnectTab({ config, handleChange, removeKeyword, desktopAwareness, onLog, runtimeStatus }) {
    const provider = config.qqProvider || 'napcat';
    const official = provider === 'qqbot';
    const [keyword, setKeyword] = useState('');
    const addKeyword = () => {
        const value = keyword.trim();
        if (value && !(config.customKeywords || []).includes(value)) handleChange('customKeywords', [...(config.customKeywords || []), value]);
        setKeyword('');
    };
    const targetGroups = config.proactiveTargetGroups || [];
    const excludedTerms = config.desktopAwarenessExcludedTerms || [];
    const [desktopStatusLabel, desktopStatusClass] = DESKTOP_STATUS[desktopAwareness?.status]
        || DESKTOP_STATUS.unavailable;

    const downloadDiagnostics = async () => {
        try {
            const response = await fetch(apiUrl('/api/diagnostics'));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const report = await response.json();
            const blobUrl = URL.createObjectURL(new Blob(
                [`${JSON.stringify(report, null, 2)}\n`],
                { type: 'application/json' }
            ));
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `hyacine-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            link.click();
            URL.revokeObjectURL(blobUrl);
        } catch (error) {
            onLog?.('error', `导出诊断失败：${error.message}`);
        }
    };

    return (
        <TabContent>
            <PageHeader
                title="连接与触发"
                description="选择 QQ 接入渠道，设置消息触发与参与策略。"
                actions={<Button onClick={downloadDiagnostics}>导出诊断</Button>}
            />

            <Section title="接入渠道" description="一次启用一个渠道，保存配置后切换。">
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="field-group"><span className="field-label">渠道</span><PinkSelect label="QQ 接入渠道" value={provider} onChange={value => handleChange('qqProvider', value)} options={[{ value: 'napcat', label: 'NapCat · 反向 WebSocket' }, { value: 'qqbot', label: '官方 QQ Bot · Webhook' }, { value: 'snowluma', label: 'SnowLuma · 正向 WebSocket' }]} /></div>
                    <div className="field-group"><span className="field-label">当前运行</span><p className="text-sm text-gray-500 py-2">{qqChannelLabel(runtimeStatus?.qq?.provider)} · {qqConnectionLabel(runtimeStatus?.qq)}</p></div>
                    {provider === 'napcat' && <>
                        <label className="field-group"><span className="field-label">反向 WebSocket 地址</span><input className="ui-input" value={config.wsUrl || ''} readOnly /><span className="field-hint">填入 NapCat 反向 WebSocket 设置。</span></label>
                        <InputGroup label="OneBot Access Token" type="password" value={config.onebotToken} onChange={e => handleChange('onebotToken', e.target.value)} hint="可选；两端需一致，使用 Bearer 请求头。" />
                    </>}
                    {provider === 'snowluma' && <>
                        <InputGroup label="SnowLuma WebSocket 地址" value={config.snowlumaUrl} placeholder="ws://127.0.0.1:3002/" onChange={e => handleChange('snowlumaUrl', e.target.value)} hint="填写 SnowLuma 的 OneBot WS 服务地址，不是 WebUI 地址；端口需与本后端区分。" />
                        <InputGroup label="SnowLuma WS Token" type="password" value={config.snowlumaToken} onChange={e => handleChange('snowlumaToken', e.target.value)} hint="与 SnowLuma WS 服务的 Token 一致。" />
                    </>}
                    {!official && <InputGroup label="机器人 QQ" placeholder="用于校验接入账号" value={config.botQQ} onChange={e => handleChange('botQQ', e.target.value)} />}
                    {official && <>
                        <InputGroup label="AppID" value={config.qqBotAppId} onChange={e => handleChange('qqBotAppId', e.target.value)} />
                        <InputGroup label="AppSecret" type="password" value={config.qqBotSecret} onChange={e => handleChange('qqBotSecret', e.target.value)} />
                        <InputGroup label="主人 OpenID" value={config.qqBotMasterId} onChange={e => handleChange('qqBotMasterId', e.target.value)} hint="可选；填当前应用的成员 OpenID，不是 QQ 号。" />
                        <Toggle label="沙箱环境" checked={Boolean(config.qqBotSandbox)} onChange={value => handleChange('qqBotSandbox', value)} />
                        <label className="field-group md:col-span-2"><span className="field-label">Webhook 回调路径</span><input className="ui-input" value="/api/qqbot/webhook" readOnly /><span className="field-hint">在开放平台填入「公网 HTTPS 域名 + 此路径」，反向代理只转发这个路径。</span></label>
                        <p className="field-hint md:col-span-2">支持群聊与单聊的文本、图片收发。订阅 GROUP_AT_MESSAGE_CREATE、C2C_MESSAGE_CREATE；全量群消息依赖平台权限。会话与 NapCat / SnowLuma 独立，定时主动发言在官方渠道停用。</p>
                    </>}
                </div>
            </Section>

            <Section title="消息触发" description="对接收到的消息进行判断；平台未推送的消息无法参与判断。">
                <div className="space-y-4">
                    <div className="field-group">
                        <span className="field-label">自定义唤醒词</span>
                        <div className="flex gap-2">
                            <input
                                value={keyword}
                                onChange={e => setKeyword(e.target.value)}
                                type="text"
                                placeholder="例如：助手，"
                                className="ui-input"
                                onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && addKeyword()}
                            />
                            <Button onClick={addKeyword}>添加</Button>
                        </div>
                        <div className="flex min-h-8 flex-wrap gap-2 pt-1">
                            {(config.customKeywords || []).map((keyword) => (
                                <span key={keyword} className="tag">
                                    {keyword}
                                    <IconButton icon={X} label={`删除 ${keyword}`} onClick={() => removeKeyword(keyword)} className="-mr-2 h-6 w-6" />
                                </span>
                            ))}
                            {(!config.customKeywords || config.customKeywords.length === 0) && (
                                <span className="text-xs text-gray-400">暂无自定义唤醒词</span>
                            )}
                        </div>
                    </div>

                    <Toggle
                        checked={Boolean(config.alwaysReply)}
                        onChange={(value) => handleChange('alwaysReply', value)}
                        label="回复所有消息"
                        description="开启后机器人会处理群内每条消息，可能显著增加 API 调用量。"
                    />
                </div>
            </Section>

            {!official && <Section
                title="主动发言"
                description="定期评估近期群聊，在置信度达到阈值后主动加入对话。"
            >
                <div className="space-y-4">
                    <Toggle
                        checked={Boolean(config.enableProactive)}
                        onChange={(value) => handleChange('enableProactive', value)}
                        label="启用主动发言"
                        description="根据群聊活跃度调整参与节奏，保留目标群限制。"
                    />

                    {config.enableProactive && (
                        <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2">
                            <RangeField
                                label="基础检查间隔"
                                value={config.proactiveInterval}
                                suffix=" 秒"
                                min="60"
                                max="1800"
                                step="60"
                                onChange={(e) => handleChange('proactiveInterval', Number(e.target.value))}
                            />
                            <RangeField
                                label="基础发言冷却"
                                value={config.proactiveCooldown}
                                suffix=" 秒"
                                min="60"
                                max="3600"
                                step="60"
                                onChange={(e) => handleChange('proactiveCooldown', Number(e.target.value))}
                            />
                            <RangeField
                                label="插话阈值"
                                value={config.proactiveThreshold}
                                min="0.1"
                                max="1"
                                step="0.1"
                                onChange={(e) => handleChange('proactiveThreshold', Number(e.target.value))}
                            />
                            <RangeField
                                label="上下文条数"
                                value={config.proactiveContextSize}
                                suffix=" 条"
                                min="3"
                                max="50"
                                step="1"
                                onChange={(e) => handleChange('proactiveContextSize', Number(e.target.value))}
                            />
                        </div>
                    )}

                    {config.enableProactive && (
                        <div className="field-group">
                            <span className="field-label">目标群</span>
                            <input
                                type="text"
                                placeholder="输入群号后按 Enter 添加；留空表示全部群"
                                className="ui-input"
                                onKeyDown={(e) => {
                                    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                                    const value = e.currentTarget.value.trim();
                                    if (value && !targetGroups.includes(value)) {
                                        handleChange('proactiveTargetGroups', [...targetGroups, value]);
                                        e.currentTarget.value = '';
                                    }
                                }}
                            />
                            <div className="flex min-h-8 flex-wrap gap-2 pt-1">
                                {targetGroups.map((group) => (
                                    <span key={group} className="tag">
                                        {group}
                                        <IconButton
                                            icon={X}
                                            label={`删除群 ${group}`}
                                            onClick={() => handleChange('proactiveTargetGroups', targetGroups.filter((item) => item !== group))}
                                            className="-mr-2 h-6 w-6"
                                        />
                                    </span>
                                ))}
                                {targetGroups.length === 0 && <span className="text-xs text-gray-400">当前对所有群生效</span>}
                            </div>
                        </div>
                    )}
                </div>
            </Section>

            }
            <details className="settings-disclosure"><summary>桌面感知<span>采样与隐私设置</span></summary>
            <Section
                title="采样与隐私"
                description="在 Electron 桌宠模式下观察主显示器画面，并在合适的时机互动。"
                action={(
                    <div className={`inline-flex min-h-7 items-center gap-2 rounded-md px-2.5 text-xs font-semibold ${desktopStatusClass}`} title={desktopAwareness?.detail || desktopStatusLabel}>
                        <span>{desktopStatusLabel}</span>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <Toggle
                        checked={Boolean(config.enableDesktopAwareness)}
                        onChange={(value) => handleChange('enableDesktopAwareness', value)}
                        label="启用桌面感知"
                        description="默认关闭。开启后系统会申请屏幕录制权限，截图仅驻留内存且不会写入聊天记录。"
                    />

                    {config.enableDesktopAwareness && (
                        <>
                            <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2">
                                <RangeField
                                    label="分析间隔"
                                    value={config.desktopAwarenessInterval}
                                    suffix=" 秒"
                                    min="30"
                                    max="900"
                                    step="30"
                                    onChange={(e) => handleChange('desktopAwarenessInterval', Number(e.target.value))}
                                />
                                <RangeField
                                    label="互动冷却"
                                    value={config.desktopAwarenessCooldown}
                                    suffix=" 秒"
                                    min="60"
                                    max="3600"
                                    step="60"
                                    onChange={(e) => handleChange('desktopAwarenessCooldown', Number(e.target.value))}
                                />
                                <RangeField
                                    label="视觉输出预算"
                                    value={config.desktopAwarenessMaxTokens}
                                    suffix=" Token"
                                    min="256"
                                    max="10000"
                                    step="256"
                                    onChange={(e) => handleChange('desktopAwarenessMaxTokens', Number(e.target.value))}
                                />
                                <RangeField
                                    label="气泡字符上限"
                                    value={config.desktopAwarenessMaxReplyLength}
                                    suffix=" 字"
                                    min="80"
                                    max="800"
                                    step="20"
                                    onChange={(e) => handleChange('desktopAwarenessMaxReplyLength', Number(e.target.value))}
                                />
                                <RangeField
                                    label="画面变化阈值"
                                    value={config.desktopAwarenessChangeThreshold}
                                    min="0.02"
                                    max="0.5"
                                    step="0.01"
                                    onChange={(e) => handleChange('desktopAwarenessChangeThreshold', Number(e.target.value))}
                                />
                            </div>

                            <div className="field-group">
                                <span className="flex items-center gap-2 field-label">
                                    隐私排除关键词
                                </span>
                                <input
                                    type="text"
                                    placeholder="输入前台应用或进程关键词后按 Enter"
                                    className="ui-input"
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                                        event.preventDefault();
                                        const value = event.currentTarget.value.trim();
                                        if (value && !excludedTerms.some(term => term.toLowerCase() === value.toLowerCase())) {
                                            handleChange('desktopAwarenessExcludedTerms', [...excludedTerms, value]);
                                            event.currentTarget.value = '';
                                        }
                                    }}
                                />
                                <div className="flex min-h-8 flex-wrap gap-2 pt-1">
                                    {excludedTerms.map((term) => (
                                        <span key={term} className="tag">
                                            {term}
                                            <IconButton
                                                icon={X}
                                                label={`删除排除项 ${term}`}
                                                onClick={() => handleChange(
                                                    'desktopAwarenessExcludedTerms',
                                                    excludedTerms.filter(item => item !== term)
                                                )}
                                                className="-mr-2 h-6 w-6"
                                            />
                                        </span>
                                    ))}
                                </div>
                                <span className="field-hint">前台应用名、进程名或包标识命中任一关键词时，会在截图生成前跳过本次采集。</span>
                            </div>
                        </>
                    )}
                </div>
            </Section>
            </details>
        </TabContent>
    );
}
