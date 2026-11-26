/** Interpolate between native window positions without predicting past a ledge or a pause. */
export class WindowMotionPhase {
    receive(snapshot, now) {
        const { state, paused } = snapshot;
        const phase = state === 'climbing' ? snapshot.cycle : state === 'mantling' ? snapshot.progress : null;
        if (!Number.isFinite(phase)) {
            this.state = null;
            return;
        }
        if (this.state === state && this.end === phase && this.paused === paused) return;

        const interval = now - this.receivedAt;
        const continuous = this.state === state && !paused && !this.paused && interval > 0 && interval < 0.12;
        let from = continuous ? this.at(now) : phase;
        // A climb cycle can cross 0 forwards or backwards. Take the short arc.
        if (state === 'climbing') from += Math.round(phase - from);
        this.from = from;
        this.end = phase;
        this.interval = continuous ? interval : 0;
        this.receivedAt = now;
        this.state = state;
        this.paused = paused;
    }

    at(now) {
        if (!this.state) return null;
        const t = this.interval ? Math.min(1, Math.max(0, (now - this.receivedAt) / this.interval)) : 1;
        const phase = this.from + (this.end - this.from) * t;
        return this.state === 'climbing' ? phase - Math.floor(phase) : phase;
    }
}
