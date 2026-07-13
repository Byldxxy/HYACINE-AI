import React from 'react';
import { Activity, Cpu, Plus, X } from 'lucide-react';
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

export default function ConnectTab({ config, handleChange, addKeyword, removeKeyword }) {
    const targetGroups = config.proactiveTargetGroups || [];

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
                        <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-3">
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
        </TabContent>
    );
}
