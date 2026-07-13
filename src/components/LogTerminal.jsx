import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Terminal, X } from 'lucide-react';

export default function LogTerminal({ logs, isLogOpen, setIsLogOpen, containerRef }) {
    const logsEndRef = useRef(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <motion.div drag dragConstraints={containerRef} dragMomentum={false} className="fixed bottom-5 right-5 z-50">
            <AnimatePresence>
                {isLogOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="absolute bottom-12 right-0 flex max-h-[520px] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#171b1e] shadow-2xl"
                    >
                        <div className="flex h-11 items-center justify-between border-b border-white/10 px-3.5">
                            <div className="flex items-center gap-2 text-xs font-medium text-gray-200">
                                <Terminal className="h-4 w-4 text-emerald-400" />实时日志
                                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400">{logs.length}</span>
                            </div>
                            <button type="button" onClick={() => setIsLogOpen(false)} className="flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-white/10 hover:text-white" aria-label="关闭日志">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto p-3 font-mono text-xs">
                            {logs.length === 0 && <div className="py-10 text-center text-gray-500">暂无日志</div>}
                            {logs.map((log, index) => {
                                const imageUrl = log.content.match(/https?:\/\/[^\s)\]"]+\.(?:png|jpg|jpeg|webp|gif)/i)?.[0];
                                const cqImage = log.content.match(/\[CQ:image,file=([^\]]+)\]/)?.[1];
                                const cqImageUrl = cqImage?.startsWith('http') ? cqImage : null;
                                const levelClass = log.level === 'in'
                                    ? 'text-sky-300'
                                    : log.level === 'out'
                                        ? 'text-emerald-300'
                                        : log.level === 'error'
                                            ? 'text-red-300'
                                            : 'text-gray-300';

                                return (
                                    <div key={`${log.time}-${index}`} className="border-b border-white/5 pb-2 last:border-0">
                                        <div className="mb-1 text-[10px] text-gray-600">{log.time}</div>
                                        <div className={`break-all leading-5 ${levelClass}`}>{log.content}</div>
                                        {imageUrl && <img src={imageUrl} alt="日志图片" className="mt-2 max-h-28 rounded border border-white/10" />}
                                        {cqImageUrl && <img src={cqImageUrl} alt="CQ 图片" className="mt-2 max-h-28 rounded border border-white/10" />}
                                        {cqImage && !cqImageUrl && <div className="mt-1 text-[10px] text-amber-300">图片数据：base64</div>}
                                    </div>
                                );
                            })}
                            <div ref={logsEndRef} />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            <button
                type="button"
                onClick={() => setIsLogOpen(!isLogOpen)}
                className={`flex h-10 w-10 items-center justify-center rounded-md border shadow-lg transition-colors ${isLogOpen ? 'border-gray-700 bg-[#171b1e] text-emerald-400' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                aria-label={isLogOpen ? '关闭日志' : '打开日志'}
                title={isLogOpen ? '关闭日志' : '打开日志'}
            >
                {isLogOpen ? <X className="h-4 w-4" /> : <Terminal className="h-4 w-4" />}
            </button>
        </motion.div>
    );
}
