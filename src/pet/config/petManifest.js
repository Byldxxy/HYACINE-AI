/**
 * 桌宠 manifest 的默认值、校验与加载。
 *
 * manifest 只描述“资源和语义事件如何映射”，不保存角色台词或 API 配置。用户文件通过
 * VITE_PET_MANIFEST_PATH 指定；缺少字段时与默认值深度合并，使只有模型、没有动作的
 * A-pose 资源也能降级显示。骨骼/Morph 使用候选名称数组以兼容不同 MMD 作者的命名。
 */
const DEFAULT_MODEL_PATH = import.meta.env.VITE_PET_MODEL_PATH || '/models/desktop-pet.pmx';
const MANIFEST_PATH = import.meta.env.VITE_PET_MANIFEST_PATH || '';

export const DEFAULT_PET_MANIFEST = {
    version: 1,
    model: DEFAULT_MODEL_PATH,
    motions: {},
    bones: {
        head: ['頭', 'Head', 'head'],
        eyes: ['両目', 'Eyes', 'eyes'],
    },
    expressions: {
        blink: ['まばたき', 'blink'],
        smile: ['笑い', 'smile'],
        angry: ['怒り', 'angry'],
        surprised: ['びっくり', 'surprised'],
        sad: ['悲しい', 'sad'],
        mouthOpen: ['あ', '口開け', 'mouthOpen', 'A'],
    },
    interactions: {
        head: { motion: 'tapHead', expression: 'smile', cooldown: 2 },
        body: { motion: 'tapBody', expression: 'surprised', cooldown: 2 },
    },
    events: {
        attention: { motion: 'attention', expression: 'surprised' },
        thinking: { motion: 'thinking' },
        speaking: { motion: 'speaking', expression: 'smile' },
        desktopComment: { motion: 'speaking', expression: 'smile' },
        imageGenerating: { motion: 'magic', expression: 'smile' },
        proactive: { motion: 'greet', expression: 'smile' },
        error: { motion: 'confused', expression: 'sad' },
    },
};

function asStringArray(value, fallback) {
    if (!Array.isArray(value)) return fallback;
    const values = value.filter(item => typeof item === 'string' && item.trim());
    return values.length > 0 ? values : fallback;
}

function normalizeManifest(input = {}) {
    // 顶层展开不足以保护 bones/expressions 等嵌套结构，因此这些字段单独规范化合并。
    const bones = input.bones || {};
    const expressions = input.expressions || {};
    return {
        ...DEFAULT_PET_MANIFEST,
        ...input,
        version: Number(input.version) || 1,
        model: typeof input.model === 'string' && input.model.trim()
            ? input.model
            : DEFAULT_MODEL_PATH,
        motions: input.motions && typeof input.motions === 'object' ? input.motions : {},
        bones: {
            head: asStringArray(bones.head, DEFAULT_PET_MANIFEST.bones.head),
            eyes: asStringArray(bones.eyes, DEFAULT_PET_MANIFEST.bones.eyes),
        },
        expressions: Object.fromEntries(
            Object.entries(DEFAULT_PET_MANIFEST.expressions).map(([key, fallback]) => [
                key,
                asStringArray(expressions[key], fallback),
            ])
        ),
        interactions: {
            ...DEFAULT_PET_MANIFEST.interactions,
            ...(input.interactions || {}),
        },
        events: {
            ...DEFAULT_PET_MANIFEST.events,
            ...(input.events || {}),
        },
    };
}

export async function loadPetManifest() {
    // 未配置 manifest 是正常场景，直接使用默认模型路径和无动作降级运行时。
    if (!MANIFEST_PATH) return { manifest: DEFAULT_PET_MANIFEST, source: 'default' };

    const response = await fetch(MANIFEST_PATH, { cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    // Vite 对不存在的路径可能返回 index.html 和 200，必须额外检查 Content-Type。
    if (!response.ok || contentType.includes('text/html')) {
        throw new Error(`未找到桌宠配置文件: ${MANIFEST_PATH}`);
    }
    const manifest = normalizeManifest(await response.json());
    return { manifest, source: MANIFEST_PATH };
}

export { normalizeManifest };
