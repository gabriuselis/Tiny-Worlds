import * as THREE from 'three';

export interface Effect {
  update(dt: number): boolean;
}

export class EffectManager {
  private particles: THREE.Points | null = null;
  private positions: Float32Array | null = null;
  private velocities: { x: number; y: number; z: number }[] = [];
  private life: number[] = [];

  constructor(private scene: THREE.Scene) {}

  spawn(pos: { x: number; y: number; z: number }, count = 8, color = 0xffff00): void {
    if (!this.particles) {
      const geo = new THREE.BufferGeometry();
      this.positions = new Float32Array(1000 * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
      const mat = new THREE.PointsMaterial({ size: 0.1, color, vertexColors: false });
      this.particles = new THREE.Points(geo, mat);
      this.scene.add(this.particles);
    }
    for (let i = 0; i < count; i++) {
      const idx = this.velocities.length;
      this.velocities.push({
        x: (Math.random() - 0.5) * 0.4,
        y: Math.random() * 0.4 + 0.1,
        z: (Math.random() - 0.5) * 0.4,
      });
      this.life.push(1);
      if (this.positions) {
        this.positions[idx * 3] = pos.x;
        this.positions[idx * 3 + 1] = pos.y;
        this.positions[idx * 3 + 2] = pos.z;
      }
    }
    if (this.positions && this.particles) {
      this.particles.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    }
  }

  update(dt: number): void {
    if (!this.particles || !this.positions) return;
    let alive = 0;
    for (let i = 0; i < this.velocities.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 1.5;
      this.positions[i * 3] += this.velocities[i].x * dt;
      this.positions[i * 3 + 1] += this.velocities[i].y * dt;
      this.positions[i * 3 + 2] += this.velocities[i].z * dt;
      this.velocities[i].y -= 0.5 * dt;
      if (this.life[i] > 0) alive++;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.visible = alive > 0;
  }
}
