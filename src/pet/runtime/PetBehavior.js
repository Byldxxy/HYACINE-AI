/** Semantic state owns intent; MotionController only blends animation clips. */
const TIMED = { attention: 1.3, greet: 3.5, tapHead: 2.2, tapBody: 1.8, error: 2.5, landing: 0.6 };
const BUSY_TIMEOUT = 120;

export class PetBehavior {
    constructor({ onChange = () => {}, now = () => performance.now() / 1000 } = {}) {
        this.onChange = onChange;
        this.now = now;
        this.jobs = new Map();
        this.reaction = null;
        this.speechUntil = 0;
        this.dragging = false;
        this.interacting = false;
        this.interactionSince = 0;
        this.locomotion = 'idle';
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
        this.locomotion = ['walking', 'climbing', 'mantling', 'falling', 'landing'].includes(state) ? state : 'idle';
        this.resolve();
    }

    setInteracting(active) {
        const next = Boolean(active);
        if (next === this.interacting) return;
        this.interacting = next;
        if (next) {
            this.interactionSince = this.now();
            // A cursor greeting replaces background greetings, but never discards a task or touch.
            if (['greet', 'attention'].includes(this.reaction?.state)) this.reaction = null;
        }
        this.resolve();
    }

    resolve() {
        const time = this.now();
        for (const [key, job] of this.jobs) if (job.until <= time) this.jobs.delete(key);
        if (this.reaction?.until <= time) this.reaction = null;
        const job = [...this.jobs.values()].find(item => item.state === 'working') || this.jobs.values().next().value;
        // Stop displacement in main, then blend into an animated interaction pose here.
        // On a wall retain a grip; falling keeps its physical pose until landing.
        const focus = this.now() - this.interactionSince < 0.65 ? 'pointerNotice' : 'pointerFocus';
        const next = this.dragging ? 'dragging'
            : this.locomotion === 'climbing' ? ((this.interacting || this.reaction || this.speechUntil > time || job) ? 'clinging' : 'climbing')
                : ['falling', 'mantling', 'landing'].includes(this.locomotion) ? this.locomotion
                    : this.reaction?.state || (this.speechUntil > time ? 'speaking' : job?.state)
                        || (this.interacting ? focus : this.locomotion);
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
