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
