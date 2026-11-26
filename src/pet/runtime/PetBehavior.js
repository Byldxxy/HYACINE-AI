import { IDLE_GESTURES } from './idleGestures.js';

/** Semantic state owns intent; MotionController only blends animation clips. */
const TIMED = { attention: 1.3, greet: 3.5, tapHead: 2.2, tapBody: 1.8, error: 2.5, landing: 0.6 };
const BUSY_TIMEOUT = 120;
const SHORT_IDLE_GESTURES = ['idleShift', 'idleGlance'];

export class PetBehavior {
    constructor({ onChange = () => {}, now = () => performance.now() / 1000, random = Math.random } = {}) {
        this.onChange = onChange;
        this.now = now;
        this.random = random;
        this.jobs = new Map();
        this.reaction = null;
        this.speechUntil = 0;
        this.dragging = false;
        this.interacting = false;
        this.interactionSince = 0;
        this.locomotion = 'idle';
        this.idleSince = null;
        this.idleGesture = null;
        this.lastIdleGesture = null;
        this.idleDue = 0;
        this.cooldowns = new Map();
        this.current = '';
        this.resolve();
    }

    event(event, detail = {}) {
        const time = this.now();
        const source = detail.source || (String(detail.activity || '').startsWith('desktop') ? 'desktop' : 'chat');
        const key = detail.requestId || source;
        if (event === 'thinking' || event === 'imageGenerating') {
            this.jobs.set(key, { state: event === 'thinking' ? 'thinking' : 'working', until: time + BUSY_TIMEOUT });
        } else if (event === 'desktopAnalysisFinished' || event === 'taskFinished') {
            this.jobs.delete(detail.requestId || (event === 'desktopAnalysisFinished' ? 'desktop' : source));
        } else if (event === 'speaking' || event === 'desktopComment') {
            this.jobs.delete(detail.requestId || (event === 'desktopComment' ? 'desktop' : source));
            this.speechUntil = time + Math.max(1, Math.min(30, Number(detail.duration) || 4));
        } else if (event === 'dragStart') {
            this.dragging = true;
            this.reaction = null;
        } else if (event === 'dragEnd') {
            this.dragging = false;
        } else if (event === 'error') {
            this.jobs.delete(key);
            this.react('error');
        } else if (event === 'proactive') {
            this.react('greet');
        } else if (event in TIMED) {
            this.react(event);
        }
        this.resolve();
    }

    react(state) {
        const time = this.now();
        if (time < (this.cooldowns.get(state) || 0)) return false;
        // Background attention cannot replace a user's touch reaction.
        if (state === 'attention' && this.reaction?.until > time) return false;
        this.reaction = { state, until: time + TIMED[state] };
        this.cooldowns.set(state, time + (state.startsWith('tap') ? 2 : 0.5));
        return true;
    }

    setLocomotion(state) {
        this.setWindowState(state, this.interacting);
    }

    setInteracting(active) {
        this.setWindowState(this.locomotion, active);
    }

    setWindowState(state, interacting) {
        const locomotion = ['walking', 'climbing', 'mantling', 'falling', 'landing'].includes(state) ? state : 'idle';
        const next = Boolean(interacting);
        if (next === this.interacting && locomotion === this.locomotion) return;
        this.locomotion = locomotion;
        if (next && !this.interacting) {
            this.interactionSince = this.now();
            // A cursor greeting replaces background greetings, but never discards a task or touch.
            if (['greet', 'attention'].includes(this.reaction?.state)) this.reaction = null;
        }
        this.interacting = next;
        this.resolve();
    }

    resolveIdle(time) {
        if (this.idleSince === null) {
            this.idleSince = time;
            // A brief walking pause can pass without starting a gesture.
            this.idleDue = time + 2 + this.random() * 4;
        }
        if (time < this.idleDue) return this.idleGesture || 'idle';
        if (this.idleGesture) {
            this.idleGesture = null;
            this.idleDue = time + 8 + this.random() * 10;
            return 'idle';
        }
        let next;
        if (time - this.idleSince >= 25 && this.lastIdleGesture !== 'idleStretch' && this.random() < 0.3) {
            next = 'idleStretch';
        } else {
            const choices = SHORT_IDLE_GESTURES.filter(name => name !== this.lastIdleGesture);
            next = choices[Math.floor(this.random() * choices.length)];
        }
        this.idleGesture = next;
        this.lastIdleGesture = next;
        this.idleDue = time + IDLE_GESTURES[next];
        return next;
    }

    resolve() {
        const time = this.now();
        let job;
        for (const [key, pending] of this.jobs) {
            if (pending.until <= time) this.jobs.delete(key);
            else if (!job || pending.state === 'working') job = pending;
        }
        if (this.reaction?.until <= time) this.reaction = null;
        // Stop displacement in main, then blend into an animated interaction pose here.
        // On a wall retain a grip; falling keeps its physical pose until landing.
        const focus = time - this.interactionSince < 0.65 ? 'pointerNotice' : 'pointerFocus';
        let next = this.dragging ? 'dragging'
            : this.locomotion === 'climbing' ? ((this.interacting || this.reaction || this.speechUntil > time || job) ? 'clinging' : 'climbing')
                : ['falling', 'mantling', 'landing'].includes(this.locomotion) ? this.locomotion
                    : this.reaction?.state || (this.speechUntil > time ? 'speaking' : job?.state)
                        || (this.interacting ? focus : this.locomotion);
        if (next === 'idle') {
            next = this.resolveIdle(time);
        } else {
            this.idleSince = null;
            this.idleGesture = null;
        }
        // Pointer interaction has its own pause owner in main; do not report it as chat busy.
        const busy = Boolean(this.dragging || this.reaction || this.speechUntil > time || job);
        if (next !== this.current || busy !== this.busy) {
            this.current = next;
            this.busy = busy;
            this.onChange(next, { busy });
        }
        return next;
    }

    update() { this.resolve(); }
}
