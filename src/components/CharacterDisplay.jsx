/**
 * Web 管理面板左侧看板娘。
 *
 * 它只加载 public/character.png，并从 config.interactions 随机显示点击台词；与 PMX 桌宠、
 * VMD 动作和桌面感知无关。资源缺失时 onError 会隐藏图片，让公开仓库无素材也能使用。
 */
import React, { useState } from 'react';
import { motion } from 'framer-motion';

const CHARACTER_IMG = '/character.png';

export default function CharacterDisplay({ hidden, scale, characterMessage, config, setCharacterMessage, transition }) {
    const interactions = config.interactions || [];
    const [hasCharacterImage, setHasCharacterImage] = useState(true);

    return (
        <motion.aside
            layout
            transition={transition}
            className={`character-stage ${hidden ? 'character-stage-hidden' : ''}`}
        >
            <motion.div
                key={characterMessage}
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="speech-bubble"
            >
                <div className="text-xs font-bold text-pink-600">{config.charName || '角色'}</div>
                <div className="mt-1 text-sm leading-6 text-gray-600">{characterMessage}</div>
            </motion.div>
            {hasCharacterImage && (
                <motion.img
                    src={CHARACTER_IMG}
                    alt={config.charName || '角色'}
                    className="character-image"
                    style={{
                        height: `${98 * scale}%`,
                        maxHeight: `${1040 * scale}px`,
                    }}
                    animate={{ y: [0, -9, 0] }}
                    transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
                    onError={() => setHasCharacterImage(false)}
                    onClick={() => {
                        if (interactions.length === 0) return;
                        setCharacterMessage(interactions[Math.floor(Math.random() * interactions.length)]);
                    }}
                />
            )}
        </motion.aside>
    );
}
