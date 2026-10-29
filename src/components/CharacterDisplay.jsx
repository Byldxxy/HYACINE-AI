import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { assetUrl } from '../lib/api';
import poses from '../assets/atelier/hyacine-poses.png';

// The generated sheet has unequal silhouette widths. Clip each source region,
// then center it on the same 700 × 887 stage so adjacent poses never leak through.
const POSES = [
    { left: '0%', clipPath: 'inset(0 60.54% 0 0)', label: '招手' },
    { left: '-87.14%', clipPath: 'inset(0 31.23% 0 39.46%)', label: '思考' },
    { left: '-163.21%', clipPath: 'inset(0 0 0 68.43%)', label: '微笑' },
];
const PAGE_POSE = { overview: 0, test: 0, memory: 1, persona: 2, ai: 1, connect: 0 };

export default function CharacterDisplay({ hidden, scale = 1, characterMessage, config, setCharacterMessage, imageSrc = '', onChat, page = 'overview', thinking = false, animated = true }) {
    const reduceMotion = useReducedMotion();
    const moving = animated && !reduceMotion;
    const [idleStep, setIdleStep] = useState(0), [reaction, setReaction] = useState(null), [failed, setFailed] = useState('');
    const reactionTimer = useRef(null), gesture = useRef(0);
    const x = useMotionValue(0), y = useMotionValue(0);
    const driftX = useSpring(x, { stiffness: 45, damping: 20 });
    const driftY = useSpring(y, { stiffness: 45, damping: 20 });
    useEffect(() => {
        if (!moving || hidden) return;
        const timer = setInterval(() => { if (!document.hidden) setIdleStep(v => v + 1); }, 16000);
        return () => clearInterval(timer);
    }, [moving, hidden]);
    useEffect(() => {
        if (!moving || hidden) return;
        const follow = e => {
            if (e.pointerType === 'touch') return;
            x.set((e.clientX / window.innerWidth - .5) * 12);
            y.set((e.clientY / window.innerHeight - .5) * 7);
        };
        window.addEventListener('pointermove', follow, { passive: true });
        return () => { window.removeEventListener('pointermove', follow); x.set(0); y.set(0); };
    }, [moving, hidden, x, y]);
    useEffect(() => () => clearTimeout(reactionTimer.current), []);
    useEffect(() => {
        if (!characterMessage) return;
        const timer = setTimeout(() => setCharacterMessage(''), 6500);
        return () => clearTimeout(timer);
    }, [characterMessage, setCharacterMessage]);
    if (hidden) return null;
    const pose = thinking ? 1 : reaction ?? (page === 'overview' && moving ? idleStep % 3 : PAGE_POSE[page] ?? 0);
    const custom = Boolean(imageSrc) && failed !== imageSrc;
    const interact = () => {
        setReaction([2, 0, 1][gesture.current++ % 3]);
        clearTimeout(reactionTimer.current);
        reactionTimer.current = setTimeout(() => setReaction(null), 3500);
        const lines = config.interactions || [];
        if (lines.length) setCharacterMessage(lines[(gesture.current - 1) % lines.length]);
    };
    return <aside className="character-room character-scene" aria-label="风堇看板娘">
        <div className="character-halo" aria-hidden="true" />
        <div className="character-signature" aria-hidden="true">Hyacine<span>风 堇</span></div>
        <motion.div className="character-drift" style={{ x: moving ? driftX : 0, y: moving ? driftY : 0 }}>
            <div className="character-breath" style={{ '--character-scale': scale }}>
                <button type="button" className="character-portrait" aria-label={`与风堇互动，当前${custom ? '自定义立绘' : POSES[pose].label}姿势`} onClick={interact}>
                    {custom ? <img className="character-custom" src={assetUrl(imageSrc)} alt={config.charName || '风堇'} draggable={false} onError={() => setFailed(imageSrc)} /> : <AnimatePresence mode="wait" initial={false}>
                        <motion.span key={pose} className="character-pose" initial={{ opacity: moving ? 0 : 1, x: moving ? 5 : 0 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: moving ? 0 : 1, x: moving ? -5 : 0 }} transition={{ duration: moving ? .2 : 0 }}>
                            <img src={poses} alt="" draggable={false} style={{ left: POSES[pose].left, clipPath: POSES[pose].clipPath }} />
                        </motion.span>
                    </AnimatePresence>}
                </button>
            </div>
        </motion.div>
        <div className="character-room-footer">
            <AnimatePresence>{characterMessage && <motion.div key={characterMessage} className="character-caption" role="status" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{characterMessage}</motion.div>}</AnimatePresence>
            <button type="button" className="character-chat-link" onClick={onChat}>打开对话<ArrowUpRight size={15} /></button>
        </div>
    </aside>;
}
