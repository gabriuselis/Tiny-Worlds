import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem, PARTICLE_CAPACITY, tangentBasis } from '../src/render/particles';
import { PLANET_RADIUS } from '../src/core/config/world';

describe('pooled particles', () => {
  it('caps alive particles at the pool capacity', () => {
    const ps = new ParticleSystem(new THREE.Group());
    ps.emit('chip', { x: 0, y: 0, z: 1 }, 0.2, PARTICLE_CAPACITY + 50);
    expect(ps.aliveCount).toBe(PARTICLE_CAPACITY);
  });

  it('spawns every particle within 0.1 of the emitting plot', () => {
    const ps = new ParticleSystem(new THREE.Group());
    const dir = { x: 0, y: 1, z: 0 };
    const height = 0.25;
    const center = new THREE.Vector3(dir.x, dir.y, dir.z).multiplyScalar(PLANET_RADIUS + height);
    ps.emit('leaf', dir, height, 200);
    for (const p of ps.debugPositions()) {
      const d = new THREE.Vector3(p.x, p.y, p.z).distanceTo(center);
      expect(d).toBeLessThanOrEqual(0.1);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    }
  });

  it('updates without NaN, never reports below-surface particles, and drains to 0', () => {
    const ps = new ParticleSystem(new THREE.Group());
    ps.emit('chip', { x: 1, y: 0, z: 0 }, 0.18, 120);
    ps.emit('dust', { x: 0, y: 0, z: 1 }, 0.02, 40);
    for (let i = 0; i < 14; i++) {
      ps.update(0.1);
      for (const p of ps.debugPositions()) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
        expect(Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z)).toBeGreaterThanOrEqual(PLANET_RADIUS);
      }
      expect(ps.aliveCount).toBeLessThanOrEqual(PARTICLE_CAPACITY);
    }
    expect(ps.aliveCount).toBe(0);
  });

  it('draws exactly the live particles and nothing once drained', () => {
    const ps = new ParticleSystem(new THREE.Group());
    const meshes = ps.group.children as THREE.InstancedMesh[];
    const drawn = () => meshes.reduce((n, m) => n + m.count, 0);
    expect(drawn()).toBe(0);
    ps.emit('leaf', { x: 0, y: 0, z: 1 }, 0.1, 30);
    ps.emit('chip', { x: 0, y: 0, z: 1 }, 0.1, 10);
    ps.update(0.05);
    expect(drawn()).toBe(ps.aliveCount);
    expect(drawn()).toBe(40);
    const leaf = meshes.find((c) => c.name === 'particles-leaf')!;
    expect(leaf.count).toBe(30);
    for (let i = 0; i < 12; i++) ps.update(0.1);
    expect(ps.aliveCount).toBe(0);
    expect(drawn()).toBe(0);
  });

  it('clear() empties the draw immediately', () => {
    const ps = new ParticleSystem(new THREE.Group());
    ps.emit('dust', { x: 1, y: 0, z: 0 }, 0.1, 20);
    ps.update(0.05);
    ps.clear();
    for (const m of ps.group.children as THREE.InstancedMesh[]) expect(m.count).toBe(0);
  });

  it('keeps a manual bounding sphere so culling never depends on hidden instances', () => {
    const ps = new ParticleSystem(new THREE.Group());
    for (const child of ps.group.children) {
      const sphere = (child as THREE.InstancedMesh).boundingSphere;
      expect(sphere).not.toBeNull();
      expect(sphere!.radius).toBeGreaterThan(PLANET_RADIUS);
      expect((child as THREE.InstancedMesh).frustumCulled).toBe(true);
    }
  });

  it('keeps the manual sphere while the live count changes', () => {
    const ps = new ParticleSystem(new THREE.Group());
    ps.emit('leaf', { x: 0, y: 0, z: 1 }, 0.1, 10);
    ps.update(0.05);
    const leaf = ps.group.children.find((c) => c.name === 'particles-leaf') as THREE.InstancedMesh;
    const before = leaf.boundingSphere!.radius;
    for (let i = 0; i < 12; i++) ps.update(0.1);
    expect(leaf.boundingSphere!.radius).toBe(before);
    expect(leaf.boundingSphere!.center.lengthSq()).toBe(0);
  });
});

describe('tangentBasis', () => {
  it.each([
    [0, 0, 1],
    [0, 1, 0],
    [0, -1, 0],
    [1, 1, 1],
  ])('returns an orthonormal basis for (%d, %d, %d)', (x, y, z) => {
    const dir = new THREE.Vector3(x, y, z).normalize();
    const u = new THREE.Vector3();
    const v = new THREE.Vector3();
    tangentBasis(dir, u, v);
    expect(u.length()).toBeCloseTo(1, 6);
    expect(v.length()).toBeCloseTo(1, 6);
    expect(u.dot(dir)).toBeCloseTo(0, 6);
    expect(v.dot(dir)).toBeCloseTo(0, 6);
    expect(u.dot(v)).toBeCloseTo(0, 6);
  });
});
