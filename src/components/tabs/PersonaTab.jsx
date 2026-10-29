/**
 * 人设与关系提示词配置页。
 *
 * systemPrompt 会进入聊天、主动发言和桌面感知请求；master/stranger/groupPrompt 只由
 * QQ/测试消息流程追加。interactions 是 Web 看板娘点击台词，不是桌宠 manifest 动作。
 */
import React, { useState } from 'react';
import personaPresets from '../../data/personaPresets.json';

import {
    Button,
    PageTabs,
    InputGroup,
    PageHeader,
    PromptBlock,
    Section,
    TabContent,
    TextArea,
} from '../UIComponents';

export default function PersonaTab({ config, handleChange, handleInteractionChange }) {
    const interactions = config.interactions || [];
    const [section, setSection] = useState('identity');
    const [preview, setPreview] = useState(false);
    const [previous, setPrevious] = useState(null);
    const preset = personaPresets[0];
    const applyPreset = () => {
        setPrevious({ charName: config.charName, systemPrompt: config.systemPrompt, groupPrompt: config.groupPrompt });
        for (const key of ['charName', 'systemPrompt', 'groupPrompt']) handleChange(key, preset[key]);
        setPreview(false);
    };

    return (
        <TabContent>
            <PageHeader
                title="人格与认知"
                description="定义角色身份、关系语境和互动表达。"
            />

            <PageTabs label="人设设置分类" value={section} onChange={setSection} options={[{value:'identity',label:'核心人设'},{value:'context',label:'关系与群聊'},{value:'interaction',label:'页面互动'}]} />
            {section === 'identity' && <>
            <Section title="身份信息">
                <div className="grid gap-4 md:grid-cols-2">
                    <InputGroup label="角色名称" value={config.charName} onChange={(e) => handleChange('charName', e.target.value)} />
                    <InputGroup label="主人 QQ" hint={config.qqProvider === 'qqbot' ? '此项用于 OneBot；官方渠道请在连接页设置主人 OpenID。' : undefined} placeholder="用于识别主人身份" value={config.masterQQ} onChange={(e) => handleChange('masterQQ', e.target.value)} />
                </div>
            </Section>

            <Section title="核心人设" description="作为每次模型请求最前面的系统提示词。" action={(
                <div className="flex gap-2">
                    {previous && <Button size="sm" onClick={() => {
                        for (const [key, value] of Object.entries(previous)) handleChange(key, value);
                        setPrevious(null);
                    }}>撤销预设</Button>}
                    <Button size="sm" onClick={() => setPreview(value => !value)}>风堇预设</Button>
                </div>
            )}>
                {preview && (
                    <div className="mb-4 space-y-3 rounded-2xl border border-pink-100 bg-pink-50/50 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <span className="field-label">{preset.name}</span>
                            <Button size="sm" onClick={applyPreset}>使用预设</Button>
                        </div>
                        <p className="field-hint">替换名称、核心人设和群聊提示。保存配置后生效。</p>
                        <div className="whitespace-pre-wrap text-sm leading-7 text-gray-600">
                            {preset.systemPrompt}{'\n\n'}{preset.groupPrompt}
                        </div>
                    </div>
                )}
                <TextArea
                    label="System Prompt"
                    value={config.systemPrompt}
                    onChange={(e) => handleChange('systemPrompt', e.target.value)}
                    rows={5}
                    placeholder="描述角色的身份、语气、边界和行为方式..."
                />
            </Section>

            </>}
            {section === 'context' && <Section title="情境追加提示" description="系统会按照发送者身份和聊天场景自动组合。">
                <div className="grid gap-4 md:grid-cols-2">
                    <PromptBlock title="主人身份" value={config.masterPrompt} onChange={(value) => handleChange('masterPrompt', value)} />
                    <PromptBlock title="普通用户" value={config.strangerPrompt} onChange={(value) => handleChange('strangerPrompt', value)} />
                    <PromptBlock title="群聊环境" value={config.groupPrompt} onChange={(value) => handleChange('groupPrompt', value)} />
                </div>
            </Section>

            }
            {section === 'interaction' && <Section
                title="页面互动台词"
                description="点击看板娘时按列表顺序显示。"
                action={(
                    <Button size="sm" onClick={() => handleChange('interactions', [...interactions, ''])}>
                        添加台词
                    </Button>
                )}
            >
                <div className="space-y-2">
                    {interactions.length === 0 && <div className="empty-state">暂无互动台词</div>}
                    {interactions.map((text, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <input aria-label={`互动台词 ${index + 1}`} placeholder="输入台词" type="text" value={text} onChange={(e) => handleInteractionChange(index, e.target.value)} className="ui-input" />
                            <Button size="sm" variant="danger" onClick={() => handleChange('interactions', interactions.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>
                        </div>
                    ))}
                </div>
            </Section>}
        </TabContent>
    );
}
