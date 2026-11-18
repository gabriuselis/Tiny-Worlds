import * as THREE from 'three';
import { PLANET_RADIUS } from '../core/config/world';

// One pooled, planet-local debris system. Everything lives in planetGroup space,
// so particles rotate with the planet instead of floating off into world space.
export type ParticleKind = 'chip' | 'bark' | 'leaf' | 'dust';

export const PARTICLE_CAPACITY = 400;

const KIND_COLORS: Record<ParticleKind, number> = {
  chip: 0xd9b37a,
  bark: 0x7a4e26,
  leaf: 0x3fae49,
  dust: 0x9aa892,
};

const KIND_SIZE: Record<ParticleKind, [number, number]> = {
  chip: [0.012, 0.024],
  bark: [0.012, 0.024],
  leaf: [0.02, 0.035],
  dust: [0.012, 0.022],
};

interface Particle {
  alive: boolean;
  kind: ParticleKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Quaternion;
  life: number;
  maxLife: number;
  size: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function finite(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export class ParticleSystem {
  readonly group = new THREE.Group();
  private meshes: Record<ParticleKind, THREE.InstancedMesh>;
  private kinds: ParticleKind[] = ['chip', 'bark', 'leaf', 'dust'];
  private pool: Particle[] = [];
  private next = 0;
  private alive = 0;
  private wasAlive = false;
  private tmpMatrix = new THREE.Matrix4();
  private tmpScale = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private gravityDir = new THREE.Vector3();

  constructor(parent: THREE.Object3D) {
    const chipGeo = new THREE.TetrahedronGeometry(1, 0);
    const dustGeo = new THREE.BoxGeometry(1, 1, 1);
    this.meshes = {} as Record<ParticleKind, THREE.InstancedMesh>;
    for (const kind of this.kinds) {
      const geo = kind === 'dust' ? dustGeo : chipGeo;
      const mat = new THREE.MeshStandardMaterial({
        color: KIND_COLORS[kind],
        roughness: 1,
        metalness: 0,
        flatShading: true,
        emissive: 0x000000,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, PARTICLE_CAPACITY);
      mesh.name = `particles-${kind}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.meshes[kind] = mesh;
      this.group.add(mesh);
      const hide = new THREE.Matrix4().compose(
        new THREE.Vector3(0, -999, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(0.0001, 0.0001, 0.0001),
      );
      for (let i = 0; i < PARTICLE_CAPACITY; i++) mesh.setMatrixAt(i, hide);
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < PARTICLE_CAPACITY; i++) {
      this.pool.push({
        alive: false,
        kind: 'chip',
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        spin: new THREE.Quaternion(),
        life: 0,
        maxLife: 1,
        size: 0.02,
      });
    }
    parent.add(this.group);
  }

  /**
   * Spawn particles at a plot, `height` above the surface.
   * `plotDir` is a planet-local unit direction (the plot's position on the sphere).
   */
  emit(kind: ParticleKind, plotDir: { x: number; y: number; z: number }, height: number, count: number): void {
    const dir = new THREE.Vector3(plotDir.x, plotDir.y, plotDir.z);
    if (dir.lengthSq() < 1e-10 || !finite(dir)) return;
    dir.normalize();

    // Stable tangent basis for jitter and sideways velocity.
    const up = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(up, dir);
    if (u.lengthSq() < 1e-6) u.crossVectors(new THREE.Vector3(1, 0, 0), dir);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(dir, u).normalize();

    const radial = PLANET_RADIUS + height;
    const [minSize, maxSize] = KIND_SIZE[kind];

    for (let i = 0; i < count; i++) {
      if (this.alive >= PARTICLE_CAPACITY) return;
      const p = this.pool[this.next];
      this.next = (this.next + 1) % PARTICLE_CAPACITY;
      if (p.alive) continue;

      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.03;
      const offsetU = Math.cos(a) * r;
      const offsetV = Math.sin(a) * r;
      p.pos.copy(dir).multiplyScalar(radial).addScaledVector(u, offsetU).addScaledVector(v, offsetV);

      const outward = rand(0.5, 1.1);
      const sideU = rand(-0.5, 0.5);
      const sideV = rand(-0.5, 0.5);
      p.vel.copy(dir).multiplyScalar(outward).addScaledVector(u, sideU).addScaledVector(v, sideV);

      p.kind = kind;
      p.maxLife = rand(0.5, 0.9);
      p.life = p.maxLife;
      p.size = rand(minSize, maxSize);
      p.spin.setFromEuler(new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)));
      if (!finite(p.pos) || !finite(p.vel)) {
        p.alive = false;
        continue;
      }
      p.alive = true;
      this.alive += 1;
    }
    this.wasAlive = this.wasAlive || this.alive > 0;
  }

  update(dt: number): void {
    if (this.alive === 0) {
      if (this.wasAlive) this.clearInstances();
      return;
    }

    const counts: Record<ParticleKind, number> = { chip: 0, bark: 0, leaf: 0, dust: 0 };
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.alive -= 1;
        continue;
      }

      // Gravity toward the planet centre.
      this.gravityDir.copy(p.pos).normalize().multiplyScalar(-2.8);
      p.vel.addScaledVector(this.gravityDir, dt);
      p.pos.addScaledVector(p.vel, dt);

      // Kill anything that went under the surface or became non-finite.
      if (!finite(p.pos) || !finite(p.vel) || p.pos.lengthSq() < PLANET_RADIUS * PLANET_RADIUS) {
        p.alive = false;
        this.alive -= 1;
        continue;
      }

      const fadeStart = p.maxLife * 0.3;
      const shrink = p.life < fadeStart ? Math.max(0, p.life / fadeStart) : 1;
      const s = Math.max(0.0001, p.size * shrink);
      this.tmpMatrix.compose(p.pos, p.spin, this.tmpScale.set(s, s, s));
      const idx = counts[p.kind]++;
      this.meshes[p.kind].setMatrixAt(idx, this.tmpMatrix);
    }

    for (const kind of this.kinds) {
      const mesh = this.meshes[kind];
      const hide = new THREE.Matrix4().compose(
        new THREE.Vector3(0, -999, 0),
        this.tmpQuat.identity(),
        this.tmpScale.set(0.0001, 0.0001, 0.0001),
      );
      for (let i = counts[kind]; i < Math.min(PARTICLE_CAPACITY, this.lastCount(kind)); i++) {
        mesh.setMatrixAt(i, hide);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.prevCounts[kind] = counts[kind];
    }
    this.wasAlive = this.alive > 0;
    if (this.alive === 0) this.clearInstances();
  }

  private prevCounts: Record<ParticleKind, number> = { chip: 0, bark: 0, leaf: 0, dust: 0 };

  private lastCount(kind: ParticleKind): number {
    return this.prevCounts[kind];
  }

  private clearInstances(): void {
    const hide = new THREE.Matrix4().compose(
      new THREE.Vector3(0, -999, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(0.0001, 0.0001, 0.0001),
    );
    for (const kind of this.kinds) {
      const mesh = this.meshes[kind];
      const n = Math.max(this.prevCounts[kind], 1);
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, hide);
      mesh.instanceMatrix.needsUpdate = true;
      this.prevCounts[kind] = 0;
    }
    this.wasAlive = false;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
    this.alive = 0;
    this.clearInstances();
  }

  get aliveCount(): number {
    return this.alive;
  }

  /** Test/debug helper: planet-local positions of every live particle. */
  debugPositions(): { x: number; y: number; z: number }[] {
    const out: { x: number; y: number; z: number }[] = [];
    for (const p of this.pool) {
      if (p.alive) out.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z });
    }
    return out;
  }
}
