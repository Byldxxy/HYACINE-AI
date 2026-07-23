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
const MIN_TRANSITION_SECONDS = 1 / 60;

function asNonNegativeSeconds(value, fallback) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
}

export class MotionController {
    constructor({ helper, mesh, motions, onStateChange }) {
        this.helper = helper;
        this.mesh = mesh;
        this.motions = motions;
        this.onStateChange = onStateChange;
        this.current = null;
        this.lastPlayedAt = new Map();
        this.transitions = [];
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
            ...this.transitions.map(item => item.action),
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

    queueTransition(action, duration) {
        if (!action) return;
        // AnimationAction 的淡入淡出也以 mixer.time 为时钟；使用同一时间轴才能保证
        // action 只在 Three.js 完成权重插值后停止，不受渲染帧累计误差影响。
        const endTime = this.mixer.time + Math.max(MIN_TRANSITION_SECONDS, duration);
        const existing = this.transitions.find(item => item.action === action);
        if (existing) {
            existing.endTime = Math.max(existing.endTime, endTime);
            return;
        }
        this.transitions.push({ action, endTime });
    }

    cancelQueuedTransition(action) {
        // AnimationMixer 会为同一 clip 复用 AnimationAction。旧动作尚在淡出时再次播放，
        // 需要取消其待停止任务，否则新一轮动作会在过渡结束时被误停。
        this.transitions = this.transitions.filter(item => item.action !== action);
    }

    returnToIdle() {
        if (!this.has('idle')) return false;
        return this.play('idle', { force: true, loop: true });
    }

    beforeAnimationUpdate() {
        // 必须在 MMDAnimationHelper 更新之前停止旧 action。这样本帧会先恢复舞蹈独占
        // 骨骼，再由 idle、IK、Grant 和物理完整求解，不会把舞蹈末帧重新写回缓存。
        const stoppedActions = [];
        const completed = this.transitions.filter(item => item.endTime <= this.mixer.time);
        this.transitions = this.transitions.filter(item => item.endTime > this.mixer.time);
        completed.forEach(item => {
            if (item.action !== this.current?.action) {
                item.action.stop();
                stoppedActions.push(item.action);
            }
        });
        if (stoppedActions.length === 0) return;

        // 最后一项旧动作退出时，明确结束当前 action 的淡入并锁定完整权重。本帧随后
        // 执行 mixer.update，确保腿部和 IK 目标严格来自 idle，而不是残余混合结果。
        if (this.transitions.length === 0 && this.current?.action) {
            this.current.action.setEffectiveWeight(1);
        }
        this.syncStoppedBoneBindings(stoppedActions);
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
        const lastPlayed = this.lastPlayedAt.get(name) || 0;
        if (!options.force && cooldown > 0 && performance.now() - lastPlayed < cooldown * 1000) return false;

        // 循环思考、待机等事件可能重复到达。保持当前 action 可避免同一 clip 从首帧硬跳。
        if (this.current?.name === name) {
            this.current.priority = priority;
            return true;
        }

        const outgoing = this.current;
        const fadeOut = asNonNegativeSeconds(outgoing?.definition?.fadeOut, DEFAULT_FADE_SECONDS);
        const fadeIn = asNonNegativeSeconds(definition.fadeIn, DEFAULT_FADE_SECONDS);
        if (outgoing?.action) {
            if (fadeOut > 0) outgoing.action.fadeOut(fadeOut);
            else outgoing.action.setEffectiveWeight(0);
            this.queueTransition(outgoing.action, Math.max(fadeOut, fadeIn));
        }

        // Three.js 为同一 clip 缓存 action；先取消旧的停止任务，再从首帧淡入。
        const action = this.mixer.clipAction(motion.clip);
        this.cancelQueuedTransition(action);
        const loop = options.loop ?? definition.loop ?? name === 'idle';
        action.reset();
        action.enabled = true;
        action.clampWhenFinished = !loop;
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        action.setEffectiveWeight(1);
        action.setEffectiveTimeScale(Number(definition.timeScale) || 1);
        if (fadeIn > 0) action.fadeIn(fadeIn);
        action.play();

        const duration = asNonNegativeSeconds(options.duration, 0);
        this.current = {
            name,
            action,
            priority,
            definition,
            durationRemaining: duration > 0 && !loop ? duration : null,
        };
        this.lastPlayedAt.set(name, performance.now());
        this.onStateChange?.(name);
        return true;
    }

    dispose() {
        this.transitions = [];
        if (this.mixer) {
            this.mixer.removeEventListener('finished', this.handleFinished);
            this.mixer.stopAllAction();
        }
    }
}
