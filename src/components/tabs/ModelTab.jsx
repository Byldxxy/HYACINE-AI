import React from 'react';
import { Image as ImageIcon, MessageSquare, RefreshCw } from 'lucide-react';
import {
    Button,
    InputGroup,
    PageHeader,
    RangeField,
    Section,
    TabContent,
    Toggle,
} from '../UIComponents';
import { assetUrl } from '../../lib/api';

export default function ModelTab({ config, handleChange, avatarList, fetchAvatars, setCharacterMessage }) {
    return (
        <TabContent>
            <PageHeader
                icon={MessageSquare}
                title="模型与回复"
                description="配置文本、生图模型以及机器人输出行为。"
            />

            <Section title="API 与模型" description="支持 OpenAI Chat Completions 兼容接口；识图需要文本模型支持视觉输入。">
                <div className="grid gap-4 md:grid-cols-2">
                    <InputGroup label="文本 API Endpoint" value={config.apiEndpoint} onChange={(e) => handleChange('apiEndpoint', e.target.value)} />
                    <InputGroup label="文本模型" value={config.modelName} onChange={(e) => handleChange('modelName', e.target.value)} />
                    <InputGroup
                        label="API Key"
                        type="password"
                        value={config.apiKey}
                        onChange={(e) => handleChange('apiKey', e.target.value)}
                        onFocus={() => setCharacterMessage('API Key 已在界面中隐藏显示。')}
                    />
                    <div />
                    <InputGroup
                        label="生图 API Endpoint"
                        hint="留空时复用文本 API Endpoint"
                        placeholder="可选"
                        value={config.imageEndpoint || ''}
                        onChange={(e) => handleChange('imageEndpoint', e.target.value)}
                    />
                    <InputGroup label="生图模型" placeholder="例如 gemini-2.5-flash-image" value={config.imageModel} onChange={(e) => handleChange('imageModel', e.target.value)} />
                </div>
            </Section>

            <Section title="回复行为">
                <div className="grid gap-4 md:grid-cols-2">
                    <RangeField
                        label="创造力（温度）"
                        value={config.temperature}
                        min="0"
                        max="2"
                        step="0.1"
                        onChange={(e) => handleChange('temperature', Number(e.target.value))}
                    />
                    <RangeField
                        label="单次回复字数限制"
                        value={config.maxReplyLength}
                        suffix=" 字"
                        min="20"
                        max="500"
                        step="10"
                        onChange={(e) => handleChange('maxReplyLength', Number(e.target.value))}
                    />
                    <Toggle
                        checked={Boolean(config.optimizeImgPrompt)}
                        onChange={(value) => handleChange('optimizeImgPrompt', value)}
                        label="智能优化生图提示词"
                        description="调用文本模型优化或翻译用户提示词。"
                    />
                    <Toggle
                        checked={Boolean(config.enableSplit)}
                        onChange={(value) => handleChange('enableSplit', value)}
                        label="拟人化分段发送"
                        description="将长回复拆成多条消息并模拟输入节奏。"
                    />
                </div>
            </Section>

            <Section
                title="角色参考图"
                description="参考图存放于 data/avatars，用于支持图生图的模型。"
                action={<Button icon={RefreshCw} onClick={fetchAvatars}>刷新</Button>}
            >
                {avatarList.length === 0 ? (
                    <div className="empty-state">
                        <ImageIcon className="mb-2 h-6 w-6 text-gray-400" />
                        data/avatars 中暂无图片
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        {avatarList.map((avatar) => {
                            const selected = config.currentPersonaId === avatar.id;
                            return (
                                <button
                                    type="button"
                                    key={avatar.id}
                                    onClick={() => {
                                        handleChange('currentPersonaId', avatar.id);
                                        handleChange('currentPersonaFileName', avatar.fileName);
                                    }}
                                    className={`overflow-hidden rounded-2xl border bg-white/80 text-left shadow-sm transition-all ${selected ? 'border-pink-400 ring-4 ring-pink-100' : 'border-pink-100 hover:-translate-y-0.5 hover:border-pink-300 hover:shadow-md'}`}
                                >
                                    <div className="aspect-[4/3] overflow-hidden bg-gray-100">
                                        <img src={assetUrl(avatar.preview)} alt={avatar.name} className="h-full w-full object-cover" />
                                    </div>
                                    <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                                        <span className="truncate text-xs font-medium text-gray-700">{avatar.name}</span>
                                        {selected && <span className="text-[10px] font-semibold text-pink-600">当前</span>}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </Section>
        </TabContent>
    );
}
