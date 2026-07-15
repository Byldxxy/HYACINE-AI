import React from 'react';
import { Activity, Cpu, Plus, ScanEye, ShieldCheck, X } from 'lucide-react';
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

export default function ConnectTab({ config, handleChange, addKeyword, removeKeyword, desktopAwareness }) {
    const targetGroups = config.proactiveTargetGroups || [];
    const excludedTerms = config.desktopAwarenessExcludedTerms || [];
    const [desktopStatusLabel, desktopStatusClass] = DESKTOP_STATUS[desktopAwareness?.status]
        || DESKTOP_STATUS.unavailable;

    return (
        <TabContent>
            <PageHeader
                icon={Cpu}
                title="连接与触发"
                description="设置 OneBot 连接、消息唤醒方式和主动发言策略。"
            />

            <Section title="连接信息" description="NapCat 使用反向 WebSocket 连接到机器人后端。">
                <div className="grid gap-4 md:grid-cols-2">
                    <InputGroup label="NapCat 反向 WebSocket 地址" value={config.wsUrl} onChange={(e) => handleChange('wsUrl', e.target.value)} />
                    <InputGroup label="机器人 QQ" placeholder="用于检测 @ 消息" value={config.botQQ} onChange={(e) => handleChange('botQQ', e.target.value)} />
                </div>
            </Section>

            <Section title="消息触发" description="机器人默认响应 @ 消息，也可以增加固定唤醒词。">
                <div className="space-y-4">
                    <div className="field-group">
                        <span className="field-label">自定义唤醒词</span>
                        <div className="flex gap-2">
                            <input
                                id="keyword-input"
                                type="text"
                                placeholder="例如：助手，"
                                className="ui-input"
                                onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                            />
                            <Button icon={Plus} onClick={addKeyword}>添加</Button>
                        </div>
                        <div className="flex min-h-8 flex-wrap gap-2 pt-1">
                            {(config.customKeywords || []).map((keyword) => (
                                <span key={keyword} className="tag">
                                    {keyword}
                                    <IconButton icon={X} label={`删除 ${keyword}`} onClick={() => removeKeyword(keyword)} className="-mr-2 h-6 w-6" />
                                </span>
                            ))}
                            {(!config.customKeywords || config.customKeywords.length === 0) && (
                                <span className="text-xs text-gray-400">暂无唤醒词，仅响应 @ 消息</span>
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

            <Section
                title="主动发言"
                description="定期评估近期群聊，在置信度达到阈值后主动加入对话。"
                action={<Activity className="h-4 w-4 text-emerald-600" />}
            >
                <div className="space-y-4">
                    <Toggle
                        checked={Boolean(config.enableProactive)}
                        onChange={(value) => handleChange('enableProactive', value)}
                        label="启用主动发言"
                        description="冷却时间和目标群限制仍会优先执行。"
                    />

                    {config.enableProactive && (
                        <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2 xl:grid-cols-4">
                            <RangeField
                                label="检查间隔"
                                value={config.proactiveInterval}
                                suffix=" 秒"
                                min="60"
                                max="1800"
                                step="60"
                                onChange={(e) => handleChange('proactiveInterval', Number(e.target.value))}
                            />
                            <RangeField
                                label="发言冷却"
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
                                    if (e.key !== 'Enter') return;
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

            <Section
                title="桌面感知"
                description="在 Electron 桌宠模式下观察主显示器画面，并在合适的时机互动。"
                action={(
                    <div className={`inline-flex min-h-7 items-center gap-2 rounded-md px-2.5 text-xs font-semibold ${desktopStatusClass}`} title={desktopAwareness?.detail || desktopStatusLabel}>
                        <ScanEye className="h-3.5 w-3.5" />
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
                            <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2 xl:grid-cols-4">
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
                                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                    隐私排除关键词
                                </span>
                                <input
                                    type="text"
                                    placeholder="输入前台应用或进程关键词后按 Enter"
                                    className="ui-input"
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter') return;
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
        </TabContent>
    );
}
