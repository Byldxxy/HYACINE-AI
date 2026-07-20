/**
 * 不经过 NapCat 的模型测试页。
 *
 * 请求仍使用当前已保存的后端配置，并写入独立 test_default 会话。切换主人/普通用户
 * 用于验证关系提示词，不会伪造真实 QQ 连接或向群聊发送消息。
 */
import React from 'react';
import { FlaskConical, Send, Trash2 } from 'lucide-react';
import { Button, PageHeader, Section, SelectField, TabContent } from '../UIComponents';

export default function TestTab({
    testMessages, testInput, testIsMaster, testLoading,
    setTestInput, setTestIsMaster, sendTestMessage, clearTestChat
}) {
    return (
        <TabContent>
            <PageHeader
                icon={FlaskConical}
                title="对话测试"
                description="不经过 QQ，直接验证当前人设、记忆和模型配置。"
                actions={<Button icon={Trash2} variant="danger" onClick={clearTestChat}>清空会话</Button>}
            />

            <Section>
                <div className="flex min-h-[600px] flex-col">
                    <div className="flex items-end justify-between gap-4 border-b border-pink-100 bg-white/30 p-4">
                        <div className="w-full max-w-[220px]">
                            <SelectField
                                label="测试身份"
                                value={testIsMaster ? 'master' : 'stranger'}
                                onChange={(e) => setTestIsMaster(e.target.value === 'master')}
                            >
                                <option value="master">主人</option>
                                <option value="stranger">普通用户</option>
                            </SelectField>
                        </div>
                        <span className="hidden text-xs text-gray-400 sm:block">测试消息会写入 test_default 会话</span>
                    </div>

                    <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto bg-gradient-to-br from-pink-50/50 via-white/30 to-sky-50/50 p-5">
                        {testMessages.length === 0 && (
                            <div className="flex h-full min-h-[380px] flex-col items-center justify-center text-gray-400">
                                <FlaskConical className="mb-3 h-8 w-8" />
                                <div className="text-sm">发送一条消息开始测试</div>
                            </div>
                        )}
                        {testMessages.map((message, index) => (
                            <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] rounded-2xl border px-3.5 py-2.5 text-sm leading-6 ${
                                    message.role === 'user'
                                        ? 'rounded-tr-md border-pink-400 bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md shadow-pink-100'
                                        : message.role === 'system'
                                            ? 'border-red-200 bg-red-50 text-red-700'
                                            : 'rounded-tl-md border-sky-100 bg-white/90 text-gray-700 shadow-sm'
                                }`}>
                                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                                    {message.isImage && <p className="mt-2 border-t border-current/20 pt-2 text-xs">生图指令：{message.imagePrompt}</p>}
                                </div>
                            </div>
                        ))}
                        {testLoading && (
                            <div className="flex justify-start">
                                <div className="rounded-2xl rounded-tl-md border border-pink-100 bg-white/90 px-3.5 py-2.5 text-sm text-pink-400 shadow-sm">
                                    <span className="animate-pulse">模型正在思考...</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2 border-t border-pink-100 bg-white/45 p-4">
                        <input
                            type="text"
                            value={testInput}
                            onChange={(e) => setTestInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendTestMessage()}
                            placeholder="输入测试消息，按 Enter 发送"
                            className="ui-input"
                            disabled={testLoading}
                        />
                        <Button
                            icon={Send}
                            variant="primary"
                            onClick={sendTestMessage}
                            disabled={testLoading || !testInput.trim()}
                        >
                            发送
                        </Button>
                    </div>
                </div>
            </Section>
        </TabContent>
    );
}
