import * as THREE from 'three';
import { DragDynamics } from './DragDynamics';

/** Add a model-space hand constraint after MMD solves animation and physics. */
export class HandDragController {
    constructor(mesh) {
        this.mesh = mesh;
        this.hand = mesh.skeleton.bones.find(b => b.name === '右手首');
        this.basePosition = mesh.position.clone();
        this.dynamics = new DragDynamics();
        this.target = null;
    }
    start(anchor) { this.target = anchor; this.dynamics.reset(); }
    restore() { this.mesh.position.copy(this.basePosition); this.mesh.rotation.z = 0; }
    stop() { this.target = null; this.restore(); }
    update(delta, camera, width, height) {
        if (!this.target || !this.hand) return;
        const angle = this.dynamics.update(delta);
        this.mesh.rotation.z = angle;
        this.mesh.updateMatrixWorld(true);
        const hand = this.hand.getWorldPosition(new THREE.Vector3());
        const projected = hand.clone().project(camera);
        const target = new THREE.Vector3(this.target.x / width * 2 - 1, 1 - this.target.y / height * 2, projected.z).unproject(camera);
        this.mesh.position.add(target.sub(hand));
        this.mesh.updateMatrixWorld(true);
    }
    snapshot(camera, width, height) {
        if (!this.target || !this.hand) return null;
        const p = this.hand.getWorldPosition(new THREE.Vector3()).project(camera);
        return { angle: this.dynamics.angle, hand: { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 }, anchor: this.target };
    }
}
