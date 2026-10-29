/** Local conversation workspace; requests use the saved backend configuration. */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Check, Copy, Flower2, MessageCircle } from 'lucide-react';
import { Button, IconButton } from '../UIComponents';
import PinkSelect from '../PinkSelect';
import '../../styles/conversation.css';

const IDENTITIES = [{ value: 'master', label: '主人' }, { value: 'stranger', label: '普通用户' }];
const EXAMPLES = ['你最近有什么喜欢的东西？', '以后叫我小白就好', '我们换个轻松的话题吧'];

export default function TestTab({
    testMessages = [], testInput = '', testIsMaster, testLoading,
    setTestInput, setTestIsMaster, sendTestMessage, clearTestChat,
    charName = '风堇', configDirty = false, onSaveConfig, clearing = false, error,
}) {
    const transcriptRef = useRef(null), inputRef = useRef(null), followRef = useRef(true), composingRef = useRef(false);
    const copyTimer = useRef(null);
    const [following, setFollowing] = useState(true);
    const [copyState, setCopyState] = useState(null);
    const name = charName?.trim() || '风堇';
    const busy = Boolean(testLoading || clearing);

    useEffect(() => () => clearTimeout(copyTimer.current), []);
    useEffect(() => {
        const panel = transcriptRef.current;
        if (panel && followRef.current) panel.scrollTop = panel.scrollHeight;
    }, [testMessages, testLoading]);
    useLayoutEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 136)}px`;
    }, [testInput]);

    const scrollToLatest = () => {
        followRef.current = true;
        setFollowing(true);
        const panel = transcriptRef.current;
        if (panel) panel.scrollTop = panel.scrollHeight;
    };
    const send = () => {
        if (busy || !testInput.trim()) return;
        scrollToLatest();
        sendTestMessage();
    };
    const copyReply = async (text, index) => {
        clearTimeout(copyTimer.current);
        try {
            await navigator.clipboard.writeText(String(text || ''));
            setCopyState({ index, success: true });
        } catch {
            setCopyState({ index, success: false });
        }
        copyTimer.current = setTimeout(() => setCopyState(null), 2200);
    };

    return (
        <section className="conversation-workspace" aria-label="对话测试">
            <header className="conversation-heading">
                <div className="conversation-title"><MessageCircle aria-hidden="true" /><h1>对话测试</h1></div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={clearTestChat}>
                    {clearing ? '清空中' : '清空'}
                </Button>
            </header>
            {configDirty && (
                <div className="conversation-config-note" role="status">
                    <span>配置有未保存的修改</span>
                    {onSaveConfig && <button type="button" onClick={onSaveConfig}>保存配置</button>}
                </div>
            )}
            <div className="conversation-card">
                <div className="conversation-toolbar">
                    <div className="conversation-identity"><span className="conversation-presence" /><strong>{name}</strong><span className="conversation-saved-label">已保存配置</span></div>
                    <fieldset className="conversation-identity-select" disabled={busy}>
                        <legend className="sr-only">测试身份</legend>
                        <PinkSelect label="测试身份" value={testIsMaster ? 'master' : 'stranger'} options={IDENTITIES} onChange={value => setTestIsMaster(value === 'master')} />
                    </fieldset>
                </div>
                <div className="conversation-history-wrap">
                    <div ref={transcriptRef} className="conversation-history custom-scrollbar" aria-label="聊天记录" role="log" aria-live="polite" aria-relevant="additions" aria-busy={Boolean(testLoading)} onScroll={event => {
                        const panel = event.currentTarget;
                        const next = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 56;
                        followRef.current = next;
                        setFollowing(next);
                    }}>
                        {testMessages.length === 0 && !testLoading && <div className="conversation-empty">
                            <div className="conversation-empty-mark"><Flower2 aria-hidden="true" /></div>
                            <h2>和{name}聊聊</h2>
                            <p>从一句话开始</p>
                            <div className="conversation-examples">{EXAMPLES.map(example => <button type="button" key={example} disabled={clearing} onClick={() => { setTestInput(example); inputRef.current?.focus(); }}>{example}</button>)}</div>
                        </div>}
                        {testMessages.map((message, index) => {
                            const isUser = message.role === 'user', isSystem = message.role === 'system';
                            const copied = copyState?.index === index;
                            return <article key={message.id || index} className={`conversation-message ${isUser ? 'is-user' : isSystem ? 'is-system' : 'is-assistant'}`}>
                                {!isSystem && <span className="conversation-message-author">{isUser ? '你' : name}</span>}
                                <div className="conversation-message-bubble">
                                    <p>{String(message.content || '')}</p>
                                    {message.isImage && message.imagePrompt && <p className="conversation-image-prompt">{message.imagePrompt}</p>}
                                </div>
                                {!isUser && !isSystem && <div className="conversation-message-actions">
                                    <IconButton icon={copied && copyState.success ? Check : Copy} label={copied ? (copyState.success ? '已复制' : '复制失败') : '复制回复'} onClick={() => copyReply(message.content, index)} />
                                    {copied && <span role="status">{copyState.success ? '已复制' : '复制失败'}</span>}
                                </div>}
                            </article>;
                        })}
                        {testLoading && <div className="conversation-thinking" role="status" aria-label={`${name}正在思考`}><span /><span /><span /></div>}
                    </div>
                    {!following && testMessages.length > 0 && <button type="button" className="conversation-latest" onClick={scrollToLatest}><ArrowDown size={13} />回到最新</button>}
                </div>
                {error && <div className="conversation-error" role="alert">{String(error)}</div>}
                <form className="conversation-composer" onSubmit={event => { event.preventDefault(); send(); }}>
                    <textarea ref={inputRef} rows={2} value={testInput} disabled={clearing} aria-label="测试消息" placeholder="想说些什么…" className="conversation-input custom-scrollbar"
                        onChange={event => setTestInput(event.target.value)}
                        onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}
                        onKeyDown={event => {
                            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
                            event.preventDefault(); send();
                        }} />
                    <div className="conversation-composer-footer"><span>Enter 发送 · Shift + Enter 换行</span><Button type="submit" variant="primary" size="sm" disabled={busy || !testInput.trim()}>发送</Button></div>
                </form>
            </div>
        </section>
    );
}
