/**
 * VMD 动作调度器。
 *
 * 所有动作共享同一个 AnimationMixer。本类处理语义优先级、单动作冷却、淡入淡出、
 * 循环方式和非循环动作结束后回 idle。低优先级事件不能打断高优先级系统/点击动作，
 * force 仅用于初始化和可靠回待机。
 */
import * as THREE from 'three';

const DEFAULT_PRIORITY = {
    idle: 0,
    event: 10,
    reaction: 20,
    system: 30,
};

export class MotionController {
    constructor({ helper, mesh, motions, onStateChange }) {
        this.helper = helper;
        this.mesh = mesh;
        this.motions = motions;
        this.onStateChange = onStateChange;
        this.current = null;
        this.lastPlayedAt = new Map();
        this.returnTimer = null;
        this.mixer = helper.objects.get(mesh)?.mixer || null;

        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer.addEventListener('finished', this.handleFinished);
        }
    }

    handleFinished = (event) => {
        // Mixer 可能同时发出旧 action 的 finished，只响应当前动作，避免错误切回 idle。
        if (!this.current || event.action !== this.current.action) return;
        const shouldReturnToIdle = this.current.name !== 'idle';
        this.current = null;
        if (shouldReturnToIdle) this.play('idle', { force: true });
    };

    has(name) {
        return Boolean(this.mixer && this.motions[name]);
    }

    get state() {
        return this.current?.name || (this.has('idle') ? 'idle' : 'fallback');
    }

    play(name, options = {}) {
        if (!this.has(name)) return false;
        const motion = this.motions[name];
        const definition = motion.definition || {};
        const priority = options.priority ?? definition.priority ?? DEFAULT_PRIORITY[options.kind || 'event'];
        const currentPriority = this.current?.priority ?? -Infinity;
        if (!options.force && priority < currentPriority) return false;

        const cooldown = Number(options.cooldown ?? definition.cooldown ?? 0);
        const lastPlayed = this.lastPlayedAt.get(name) || 0;
        if (!options.force && cooldown > 0 && performance.now() - lastPlayed < cooldown * 1000) return false;

        clearTimeout(this.returnTimer);
        const fadeOut = Number(this.current?.definition?.fadeOut ?? 0.25);
        if (this.current?.action) this.current.action.fadeOut(fadeOut);

        // 先淡出旧动作再启用新 action，让 Three.js mixer 在过渡期自动混合骨骼权重。
        const action = this.mixer.clipAction(motion.clip);
        const loop = options.loop ?? definition.loop ?? name === 'idle';
        action.reset();
        action.enabled = true;
        action.clampWhenFinished = !loop;
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        action.setEffectiveWeight(1);
        action.setEffectiveTimeScale(Number(definition.timeScale) || 1);
        action.fadeIn(Number(definition.fadeIn) || 0.25).play();

        this.current = { name, action, priority, definition };
        this.lastPlayedAt.set(name, performance.now());
        this.onStateChange?.(name);

        const duration = Number(options.duration || 0);
        if (duration > 0 && !loop) {
            this.returnTimer = setTimeout(() => this.play('idle', { force: true }), duration * 1000);
        }
        return true;
    }

    dispose() {
        clearTimeout(this.returnTimer);
        if (this.mixer) {
            this.mixer.removeEventListener('finished', this.handleFinished);
            this.mixer.stopAllAction();
        }
    }
}
