/**
 * 人设与关系提示词配置页。
 *
 * systemPrompt 会进入聊天、主动发言和桌面感知请求；master/stranger/groupPrompt 只由
 * QQ/测试消息流程追加。interactions 是 Web 看板娘点击台词，不是桌宠 manifest 动作。
 */
import React from 'react';
import { Heart, Plus, Trash2 } from 'lucide-react';
import {
    Button,
    IconButton,
    InputGroup,
    PageHeader,
    PromptBlock,
    Section,
    TabContent,
    TextArea,
} from '../UIComponents';

export default function PersonaTab({ config, handleChange, handleInteractionChange }) {
    const interactions = config.interactions || [];

    return (
        <TabContent>
            <PageHeader
                icon={Heart}
                title="人格与认知"
                description="定义角色身份、关系语境和互动表达。"
            />

            <Section title="身份信息">
                <div className="grid gap-4 md:grid-cols-2">
                    <InputGroup label="角色名称" value={config.charName} onChange={(e) => handleChange('charName', e.target.value)} />
                    <InputGroup label="主人 QQ" placeholder="用于识别主人身份" value={config.masterQQ} onChange={(e) => handleChange('masterQQ', e.target.value)} />
                </div>
            </Section>

            <Section title="核心人设" description="作为每次模型请求最前面的系统提示词。">
                <TextArea
                    label="System Prompt"
                    value={config.systemPrompt}
                    onChange={(e) => handleChange('systemPrompt', e.target.value)}
                    rows={14}
                    placeholder="描述角色的身份、语气、边界和行为方式..."
                />
            </Section>

            <Section title="情境追加提示" description="系统会按照发送者身份和聊天场景自动组合。">
                <div className="grid gap-4 md:grid-cols-2">
                    <PromptBlock title="主人身份" value={config.masterPrompt} onChange={(value) => handleChange('masterPrompt', value)} />
                    <PromptBlock title="普通用户" value={config.strangerPrompt} onChange={(value) => handleChange('strangerPrompt', value)} />
                    <PromptBlock title="群聊环境" value={config.groupPrompt} onChange={(value) => handleChange('groupPrompt', value)} />
                </div>
            </Section>

            <Section
                title="页面互动台词"
                description="点击侧边栏角色图时随机显示。"
                action={(
                    <Button icon={Plus} size="sm" onClick={() => handleChange('interactions', [...interactions, '新台词...'])}>
                        添加台词
                    </Button>
                )}
            >
                <div className="space-y-2">
                    {interactions.length === 0 && <div className="empty-state">暂无互动台词</div>}
                    {interactions.map((text, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <input type="text" value={text} onChange={(e) => handleInteractionChange(index, e.target.value)} className="ui-input" />
                            <IconButton
                                icon={Trash2}
                                label="删除台词"
                                variant="danger"
                                onClick={() => handleChange('interactions', interactions.filter((_, itemIndex) => itemIndex !== index))}
                            />
                        </div>
                    ))}
                </div>
            </Section>
        </TabContent>
    );
}
