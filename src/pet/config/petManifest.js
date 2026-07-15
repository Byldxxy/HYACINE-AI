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
    if (!MANIFEST_PATH) return { manifest: DEFAULT_PET_MANIFEST, source: 'default' };

    const response = await fetch(MANIFEST_PATH, { cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || contentType.includes('text/html')) {
        throw new Error(`未找到桌宠配置文件: ${MANIFEST_PATH}`);
    }
    const manifest = normalizeManifest(await response.json());
    return { manifest, source: MANIFEST_PATH };
}

export { normalizeManifest };
