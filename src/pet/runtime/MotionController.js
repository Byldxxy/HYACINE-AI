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

const DEFAULT_FADE_SECONDS = 0.4;

function asNonNegativeSeconds(value, fallback) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
}

export class MotionController {
    constructor({ helper, mesh, motions, onStateChange, onFinished }) {
        this.helper = helper;
        this.mesh = mesh;
        this.motions = motions;
        this.onStateChange = onStateChange;
        this.onFinished = onFinished;
        this.current = null;
        this.lastPlayedAt = new Map();
        this.blend = null;
        const helperObjects = helper.objects.get(mesh);
        this.mixer = helperObjects?.mixer || null;

        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer.addEventListener('finished', this.handleFinished);
        }
    }

    handleFinished = (event) => {
        // Mixer 可能同时发出旧 action 的 finished，只响应当前动作，避免错误切回 idle。
        if (!this.current || event.action !== this.current.action) return;
        if (this.onFinished?.(this.current.name) === true) return;
        if (this.current.name !== 'idle') this.returnToIdle();
    };

    syncStoppedBoneBindings(stoppedActions) {
        // MMDAnimationHelper 的 backupBones 是下一帧执行 IK、Grant、物理前的基准姿势。
        // 整份删除会让求解结果被再次叠加，造成头发和衣物持续抽动；但完全不更新又会
        // 把舞蹈独占的腿部轨道恢复成末帧。因此这里只同步已经没有 action 驱动的轨道。
        const helperObjects = this.helper.objects.get(this.mesh);
        const backupBones = helperObjects?.backupBones;
        const bones = this.mesh.skeleton?.bones;
        if (!backupBones || !bones) return;

        const activeActions = new Set([
            this.current?.action,
            ...(this.blend?.sources || []).map(item => item.action),
        ].filter(Boolean));
        const activeTrackNames = new Set();
        activeActions.forEach(action => {
            action.getClip().tracks.forEach(track => activeTrackNames.add(track.name));
        });

        const boneIndices = new Map(bones.map((bone, index) => [bone.name, index]));
        stoppedActions.forEach(action => {
            action.getClip().tracks.forEach(track => {
                if (activeTrackNames.has(track.name)) return;
                const binding = THREE.PropertyBinding.parseTrackName(track.name);
                if (binding.objectName !== 'bones') return;
                const boneIndex = boneIndices.get(binding.objectIndex);
                if (boneIndex === undefined) return;
                const bone = bones[boneIndex];
                if (binding.propertyName === 'position') {
                    bone.position.toArray(backupBones, boneIndex * 7);
                } else if (binding.propertyName === 'quaternion') {
                    bone.quaternion.toArray(backupBones, boneIndex * 7 + 3);
                }
            });
        });
        helperObjects.looped = false;
    }

    returnToIdle() {
        if (!this.has('idle')) return false;
        return this.play('idle', { force: true, loop: true });
    }

    beforeAnimationUpdate(delta = 0) {
        const blend = this.blend;
        if (!blend) return;

        // Sample the same instant that the upcoming mixer.update(delta) will use.
        const nextTime = this.mixer.time + delta * (this.mixer.timeScale ?? 1);
        const t = blend.duration > 0 ? THREE.MathUtils.clamp((nextTime - blend.startTime) / blend.duration, 0, 1) : 1;
        if (t < 1) {
            const eased = t * t * (3 - 2 * t);
            for (const { action, weight } of blend.sources) {
                action.setEffectiveWeight(weight * (1 - eased));
            }
            this.current.action.setEffectiveWeight(blend.targetWeight + (1 - blend.targetWeight) * eased);
            return;
        }

        // Stop before the helper restores its IK/physics baseline for this frame.
        this.blend = null;
        this.current.action.setEffectiveWeight(1);
        for (const { action } of blend.sources) action.stop();
        this.syncStoppedBoneBindings(blend.sources.map(source => source.action));
    }

    afterAnimationUpdate(delta = 0) {
        const elapsed = Math.max(0, Number(delta) || 0);

        // duration 使用渲染帧时间而非 setTimeout；窗口隐藏、渲染暂停时动作状态也会暂停，
        // 不会在后台跳过过渡并在恢复显示时突然复位。
        const active = this.current;
        if (active?.durationRemaining !== null && active?.durationRemaining !== undefined) {
            active.durationRemaining -= elapsed;
            if (active.durationRemaining <= 0 && this.current === active && active.name !== 'idle') {
                this.returnToIdle();
            }
        }
    }

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
        const lastPlayed = this.lastPlayedAt.get(name) ?? -Infinity;
        if (!options.force && cooldown > 0 && performance.now() - lastPlayed < cooldown * 1000) return false;

        // 循环思考、待机等事件可能重复到达。保持当前 action 可避免同一 clip 从首帧硬跳。
        if (this.current?.name === name) {
            this.current.priority = priority;
            return true;
        }

        const outgoing = this.current;
        const fadeOut = asNonNegativeSeconds(outgoing?.definition?.fadeOut, DEFAULT_FADE_SECONDS);
        const fadeIn = asNonNegativeSeconds(definition.fadeIn, DEFAULT_FADE_SECONDS);
        const action = this.mixer.clipAction(motion.clip);
        const loop = options.loop ?? definition.loop ?? name === 'idle';

        // Re-target the whole visible mixture, including clips still fading out.
        // Restarting a built-in Three.js fade would bring its source back to full weight.
        const visible = (this.blend?.sources || []).map(source => source.action);
        if (outgoing) visible.push(outgoing.action);
        const returning = visible.includes(action);
        const sources = visible.filter(source => source !== action)
            .map(source => ({ action: source, weight: source.getEffectiveWeight() }));
        const targetWeight = sources.length === 0 ? 1 : returning ? action.getEffectiveWeight() : 0;
        this.blend = sources.length ? {
            startTime: this.mixer.time,
            duration: Math.max(fadeIn, fadeOut),
            sources,
            targetWeight,
        } : null;

        // A loop reselected while its previous pose is visible keeps its gait or breath phase.
        if (!returning || (!loop && action.paused)) action.reset();
        action.enabled = true;
        action.clampWhenFinished = !loop;
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        action.setEffectiveWeight(targetWeight);
        action.setEffectiveTimeScale(Number(definition.timeScale) || 1);
        action.play();

        const duration = asNonNegativeSeconds(options.duration, 0);
        this.current = {
            name,
            action,
            priority,
            definition,
            durationRemaining: duration > 0 ? duration : null,
        };
        this.lastPlayedAt.set(name, performance.now());
        this.onStateChange?.(name);
        return true;
    }

    dispose() {
        this.blend = null;
        if (this.mixer) {
            this.mixer.removeEventListener('finished', this.handleFinished);
            this.mixer.stopAllAction();
        }
    }
}
