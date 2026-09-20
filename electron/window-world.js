/** Geometry and pet locomotion in Electron DIP coordinates. No OS or renderer dependencies. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteRect = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0;

function visibleWindows(items, excludedPid, convertRect = r => r) {
    return items.filter(item => item.pid !== excludedPid && item.visible !== false && !item.minimized && !item.cloaked && (item.layer ?? 0) === 0)
        .map(item => ({ id: String(item.id), bounds: convertRect(item.bounds) }))
        .filter(item => item.id !== 'undefined' && finiteRect(item.bounds) && item.bounds.width >= 160 && item.bounds.height >= 100);
}

function isOccluded(point, windows, targetIndex) {
    return windows.slice(0, targetIndex).some(({ bounds: b }) =>
        point.x > b.x + 2 && point.x < b.x + b.width - 2 && point.y > b.y + 2 && point.y < b.y + b.height - 2);
}

class WindowWorld {
    constructor({ random = Math.random } = {}) {
        this.random = random;
        this.enabled = false;
        this.paused = false;
        this.dragging = false;
        this.windows = [];
        this.area = { x: 0, y: 0, width: 1280, height: 800 };
        this.actor = { x: 900, y: 800, radius: 35, height: 300 };
        this.attachment = null;
        this.state = 'idle';
        this.direction = -1;
        this.rest = 3;
        this.vy = 0;
        this.vx = 0;
        this.mantle = null;
        this.climbPhase = 0;
        this.skipLandingId = null;
        this.climbDirection = -1;
    }
    setArea(area) { if (finiteRect(area)) this.area = area; }
    setActor(actor) { Object.assign(this.actor, actor); }
    setWindows(windows) {
        this.windows = windows;
        if (!this.attachment) return;
        const index = windows.findIndex(w => w.id === this.attachment.id);
        if (index < 0) { this.release(); return; }
        const w = windows[index].bounds;
        const a = this.attachment;
        // Stored local coordinates follow moving/resized windows without accumulating drift.
        if (this.mantle) {
            const t = this.mantle.progress, ease = t * t * (3 - 2 * t);
            const inward = Math.max(0, (t - 0.35) / 0.65);
            this.actor.x = (a.edge === 'left' ? w.x - this.actor.radius : w.x + w.width + this.actor.radius) + (a.edge === 'left' ? 1 : -1) * 2 * this.actor.radius * inward * inward * (3 - 2 * inward);
            this.actor.y = w.y + this.mantle.reach * (1 - ease);
        } else if (a.edge === 'top') {
            this.actor.x = w.x + clamp(a.offset, this.actor.radius, Math.max(this.actor.radius, w.width - this.actor.radius));
            this.actor.y = w.y;
        } else {
            this.actor.x = a.edge === 'left' ? w.x - this.actor.radius : w.x + w.width + this.actor.radius;
            this.actor.y = w.y + clamp(a.offset, 0, w.height);
        }
        const contact = { x: a.edge === 'left' ? w.x + 3 : a.edge === 'right' ? w.x + w.width - 3 : this.actor.x, y: this.actor.y + 3 };
        if (isOccluded(contact, windows, index) || this.actor.y < this.area.y + 45 || this.actor.x < this.area.x || this.actor.x > this.area.x + this.area.width) this.release();
    }
    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (this.enabled) this.snap();
        else { this.attachment = null; this.mantle = null; this.state = 'idle'; this.vy = 0; this.vx = 0; }
    }
    release() { this.attachment = null; this.mantle = null; this.state = 'falling'; this.vy = 0; this.vx = 0; }
    beginDrag() { this.mantle = null; this.vx = 0; this.dragging = true; this.attachment = null; this.state = 'dragging'; this.vy = 0; }
    endDrag(velocity = {}) {
        this.dragging = false;
        if (this.enabled) {
            const vx = clamp(Number(velocity.x) || 0, -1200, 1200), vy = clamp(Number(velocity.y) || 0, -900, 900);
            if (Math.hypot(vx, vy) > 180) { this.release(); this.vx = vx; this.vy = vy; } else this.snap();
        } else this.state = 'idle';
    }
    snap() {
        this.mantle = null; this.vx = 0;
        const p = this.actor;
        const candidates = [];
        this.windows.forEach(({ id, bounds: w }, index) => {
            if (w.y >= this.area.y + p.height && p.x >= w.x && p.x <= w.x + w.width && Math.abs(p.y - w.y) <= 65 && !isOccluded({ x: p.x, y: w.y + 3 }, this.windows, index))
                candidates.push({ id, edge: 'top', offset: p.x - w.x, distance: Math.abs(p.y - w.y) });
            if (p.y >= w.y + 35 && p.y <= w.y + w.height + 40) for (const edge of ['left', 'right']) {
                const x = edge === 'left' ? w.x - p.radius : w.x + w.width + p.radius;
                if (Math.abs(p.x - x) <= 75 && x > this.area.x + p.radius && x < this.area.x + this.area.width - p.radius && !isOccluded({ x: edge === 'left' ? w.x + 3 : w.x + w.width - 3, y: p.y - 5 }, this.windows, index))
                    candidates.push({ id, edge, offset: Math.min(w.height, p.y - w.y), distance: Math.abs(p.x - x) + 10 });
            }
        });
        this.attachment = candidates.sort((a, b) => a.distance - b.distance)[0] || null;
        if (this.attachment) {
            this.setWindows(this.windows);
            this.state = this.attachment?.edge === 'top' ? 'idle' : this.attachment ? 'climbing' : 'falling';
            this.rest = 1.5; this.climbDirection = -1;
        } else this.release();
    }
    returnToFloor() {
        this.skipLandingId = this.attachment?.id || null;
        this.attachment = null;
        this.actor.x = clamp(this.actor.x, this.area.x + this.actor.radius, this.area.x + this.area.width - this.actor.radius);
        this.release();
    }
    tick(seconds) {
        const dt = clamp(seconds, 0, 0.05);
        if (!this.enabled || this.dragging) return this.snapshot();
        const p = this.actor, area = this.area;
        const floor = area.y + area.height;
        if (this.state === 'falling') {
            const previousY = p.y;
            this.vy = Math.min(850, this.vy + 1300 * dt);
            p.y += this.vy * dt;
            p.x += this.vx * dt; this.vx *= Math.exp(-0.8 * dt);
            if (p.x < area.x + p.radius || p.x > area.x + area.width - p.radius) this.vx *= -0.3;
            const landing = this.windows.find(({ id, bounds: w }, i) => id !== this.skipLandingId && w.y >= area.y + p.height && previousY <= w.y && p.y >= w.y && p.x > w.x + p.radius && p.x < w.x + w.width - p.radius && !isOccluded({ x: p.x, y: w.y + 3 }, this.windows, i));
            if (landing) {
                p.y = landing.bounds.y;
                this.attachment = { id: landing.id, edge: 'top', offset: p.x - landing.bounds.x };
            }
            if (landing || p.y >= floor) {
                if (!landing) p.y = floor;
                this.state = 'landing'; this.rest = 0.7; this.vy = 0; this.vx = 0; this.skipLandingId = null;
            }
        } else if (this.mantle) {
            if (!this.paused) {
                this.mantle.progress = Math.min(1, this.mantle.progress + dt / 1.6);
                this.setWindows(this.windows);
                if (this.mantle?.progress >= 1 && this.attachment) {
                    const w = this.windows.find(w => w.id === this.attachment.id).bounds;
                    this.attachment = { id: this.attachment.id, edge: 'top', offset: this.actor.x - w.x };
                    this.mantle = null; this.state = 'landing'; this.rest = 0.7;
                }
            }
        } else if (this.attachment && this.attachment.edge !== 'top') {
            this.state = 'climbing';
            // Freeze the ascent during conversation/touch, retaining the gripping pose.
            if (!this.paused) {
                const w = this.windows.find(w => w.id === this.attachment.id)?.bounds;
                if (!w) this.release();
                else {
                    const safeTop = area.y + p.height;
                    if (w.y < safeTop && p.y <= safeTop + 5) this.climbDirection = 1;
                    this.climbPhase = (this.climbPhase - this.climbDirection * dt / 1.8 + 1) % 1;
                    this.attachment.offset += this.climbDirection * 55 * dt;
                    if (this.climbDirection > 0 && this.attachment.offset >= w.height) {
                        this.skipLandingId = this.attachment.id;
                        this.direction *= -1;
                        this.release();
                        return this.snapshot();
                    }
                    const reach = p.height * 0.72;
                    if (this.climbDirection < 0 && w.y >= safeTop && this.attachment.offset <= reach) {
                        this.mantle = { progress: 0, reach: Math.max(0, this.attachment.offset) };
                        this.direction = this.attachment.edge === 'left' ? 1 : -1;
                        this.state = 'mantling';
                    }
                    this.setWindows(this.windows);
                }
            }
        } else if (this.paused) this.state = 'idle';
        else if (this.rest > 0) {
            this.rest -= dt;
            if (this.state !== 'landing') this.state = 'idle';
        } else {
            this.state = 'walking';
            const w = this.windows.find(w => w.id === this.attachment?.id)?.bounds;
            const min = Math.max(area.x + p.radius, (w?.x ?? area.x) + p.radius);
            const max = Math.min(area.x + area.width - p.radius, w ? w.x + w.width - p.radius : area.x + area.width - p.radius);
            p.x += this.direction * 42 * dt;
            if (p.x <= min || p.x >= max) {
                p.x = clamp(p.x, min, max); this.direction *= -1; this.rest = 2 + this.random() * 4;
            } else if (this.random() < dt / 14) this.rest = 3 + this.random() * 5;
            if (this.attachment && w) this.attachment.offset = p.x - w.x;
            // On the desktop floor, catch a reachable side of a window and climb it.
            if (!w) {
                const target = this.windows.find(({ bounds: b }, i) => b.y > area.y + 65 && b.y + b.height >= floor - 45 && b.y < floor - 80 && Math.abs(p.x - (this.direction > 0 ? b.x - p.radius : b.x + b.width + p.radius)) < 8 && !isOccluded({ x: this.direction > 0 ? b.x + 3 : b.x + b.width - 3, y: Math.min(floor - 5, b.y + b.height - 5) }, this.windows, i));
                if (target) {
                    this.attachment = { id: target.id, edge: this.direction > 0 ? 'left' : 'right', offset: target.bounds.height };
                    this.setWindows(this.windows); this.state = 'climbing'; this.climbDirection = -1;
                }
            }
        }
        p.x = clamp(p.x, area.x + p.radius, area.x + area.width - p.radius);
        p.y = Math.min(p.y, floor);
        return this.snapshot();
    }
    snapshot() { return { enabled: this.enabled, state: this.state, x: this.actor.x, y: this.actor.y, direction: this.attachment?.edge === 'left' ? 1 : this.attachment?.edge === 'right' ? -1 : this.direction, edge: this.attachment?.edge || null, attached: Boolean(this.attachment), climbDirection: this.climbDirection, progress: this.mantle?.progress ?? null, cycle: this.state === 'climbing' ? this.climbPhase : null }; }
}
module.exports = { WindowWorld, visibleWindows, isOccluded };
