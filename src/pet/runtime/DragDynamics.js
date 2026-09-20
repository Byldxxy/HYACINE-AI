/** Damped pendulum in screen coordinates; independent of frame rate and pointer event frequency. */
export class DragDynamics {
    constructor() { this.reset(); }
    reset() { this.angle = 0; this.speed = 0; this.velocity = 0; this.last = null; }
    sample(x, time) {
        if (this.last) {
            const dt = (time - this.last.time) / 1000;
            if (dt > 0.004 && dt < 0.2) {
                const velocity = Math.max(-2400, Math.min(2400, (x - this.last.x) / dt));
                this.speed -= (velocity - this.velocity) * 0.0015;
                this.velocity = velocity;
            }
        }
        this.last = { x, time };
    }
    update(seconds) {
        let remaining = Math.min(0.05, Math.max(0, seconds));
        while (remaining > 0) {
            const dt = Math.min(remaining, 1 / 120); remaining -= dt;
            this.speed += (-19 * Math.sin(this.angle) - 3.8 * this.speed) * dt;
            this.angle += this.speed * dt;
            if (Math.abs(this.angle) > 1.05) { this.angle = Math.sign(this.angle) * 1.05; this.speed *= -0.15; }
        }
        return this.angle;
    }
}
