import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem, PARTICLE_CAPACITY } from '../src/render/particles';
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
});
