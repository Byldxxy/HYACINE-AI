function resolveMorphIndex(mesh, candidates = []) {
    const dictionary = mesh.morphTargetDictionary || {};
    const name = candidates.find(candidate => dictionary[candidate] !== undefined);
    return name ? dictionary[name] : null;
}

export class ExpressionController {
    constructor(mesh, expressionMap = {}) {
        this.mesh = mesh;
        this.indices = Object.fromEntries(
            Object.entries(expressionMap).map(([semantic, candidates]) => [
                semantic,
                resolveMorphIndex(mesh, candidates),
            ])
        );
        this.targets = new Map();
        this.timers = new Map();
        this.blinkTimer = 0;
        this.blinkState = 0;
        this.nextBlink = 3 + Math.random() * 4;
        this.speakingUntil = 0;
        this.speechTime = 0;
    }

    speak(duration = 1.5) {
        if (this.indices.mouthOpen === null || this.indices.mouthOpen === undefined) return false;
        this.speakingUntil = performance.now() + Math.max(0.4, duration) * 1000;
        return true;
    }

    play(name, { weight = 1, duration = 1.2 } = {}) {
        const index = this.indices[name];
        if (index === null || index === undefined) return false;
        this.targets.set(index, weight);
        clearTimeout(this.timers.get(index));
        this.timers.set(index, setTimeout(() => this.targets.set(index, 0), duration * 1000));
        return true;
    }

    updateBlink(delta) {
        const index = this.indices.blink;
        if (index === null || index === undefined) return;
        this.blinkTimer += delta;
        if (this.blinkState === 0 && this.blinkTimer >= this.nextBlink) {
            this.blinkState = 1;
            this.blinkTimer = 0;
        }
        let value = 0;
        if (this.blinkState === 1) {
            value = Math.min(this.blinkTimer / 0.05, 1);
            if (value >= 1) { this.blinkState = 2; this.blinkTimer = 0; }
        } else if (this.blinkState === 2) {
            value = 1;
            if (this.blinkTimer >= 0.05) { this.blinkState = 3; this.blinkTimer = 0; }
        } else if (this.blinkState === 3) {
            value = 1 - Math.min(this.blinkTimer / 0.08, 1);
            if (value <= 0) {
                this.blinkState = 0;
                this.blinkTimer = 0;
                this.nextBlink = 2 + Math.random() * 5;
            }
        }
        this.mesh.morphTargetInfluences[index] = value;
    }

    update(delta) {
        const influences = this.mesh.morphTargetInfluences;
        if (!influences) return;
        this.targets.forEach((target, index) => {
            influences[index] += (target - influences[index]) * Math.min(1, delta * 10);
        });
        this.updateBlink(delta);
        const mouthIndex = this.indices.mouthOpen;
        if (mouthIndex !== null && mouthIndex !== undefined) {
            this.speechTime += delta;
            const target = performance.now() < this.speakingUntil
                ? 0.15 + Math.abs(Math.sin(this.speechTime * 11)) * 0.55
                : 0;
            influences[mouthIndex] += (target - influences[mouthIndex]) * Math.min(1, delta * 16);
        }
    }

    snapshot() {
        const influences = this.mesh.morphTargetInfluences || [];
        return Object.fromEntries(
            Object.entries(this.indices).map(([name, index]) => [
                name,
                index === null || index === undefined ? null : influences[index],
            ])
        );
    }

    dispose() {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
    }
}
