import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InstanceSlots } from '../src/app/instanceSlots';
import { showInstance, removeInstance, clearInstances, moveInstance } from '../src/app/instanceOps';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertConsistent(slots: InstanceSlots, model: Set<number>): void {
  expect(slots.count).toBe(model.size);
  const seen = new Set<number>();
  for (let s = 0; s < slots.count; s++) {
    const key = slots.keyAt(s);
    expect(model.has(key)).toBe(true);
    expect(slots.slotOf(key)).toBe(s);
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
  for (const key of model) expect(slots.slotOf(key)).toBeGreaterThanOrEqual(0);
}

describe('InstanceSlots', () => {
  it('allocates packed slots and returns the same slot for a held key', () => {
    const s = new InstanceSlots(4);
    expect(s.acquire(10)).toBe(0);
    expect(s.acquire(20)).toBe(1);
    expect(s.acquire(10)).toBe(0);
    expect(s.count).toBe(2);
    expect(s.slotOf(99)).toBe(-1);
  });

  it('reports -1 when full and does not change state', () => {
    const s = new InstanceSlots(2);
    s.acquire(1);
    s.acquire(2);
    expect(s.acquire(3)).toBe(-1);
    expect(s.count).toBe(2);
    expect(s.slotOf(3)).toBe(-1);
  });

  it('swap-removes: the last instance fills the freed slot', () => {
    const s = new InstanceSlots(8);
    [5, 6, 7, 8].forEach((k) => s.acquire(k));
    expect(s.release(6)).toEqual({ key: 8, from: 3, to: 1 });
    expect(s.slotOf(8)).toBe(1);
    expect(s.slotOf(6)).toBe(-1);
    expect(s.count).toBe(3);
  });

  it('releasing the last slot or an unknown key moves nothing', () => {
    const s = new InstanceSlots(8);
    [5, 6].forEach((k) => s.acquire(k));
    expect(s.release(6)).toBeNull();
    expect(s.release(123)).toBeNull();
    expect(s.count).toBe(1);
    expect(s.release(5)).toBeNull();
    expect(s.count).toBe(0);
  });

  it('clear() frees everything and slots are reusable', () => {
    const s = new InstanceSlots(3);
    [1, 2, 3].forEach((k) => s.acquire(k));
    s.clear();
    expect(s.count).toBe(0);
    expect(s.slotOf(1)).toBe(-1);
    expect(s.acquire(9)).toBe(0);
  });

  it('matches a reference model over random acquire/release sequences', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rnd = mulberry32(seed);
      const capacity = 40;
      const s = new InstanceSlots(capacity);
      const model = new Set<number>();
      for (let step = 0; step < 3000; step++) {
        const key = Math.floor(rnd() * 60) - 5;
        if (rnd() < 0.5) {
          const slot = s.acquire(key);
          if (model.has(key)) expect(slot).toBe(s.slotOf(key));
          else if (model.size >= capacity) expect(slot).toBe(-1);
          else { expect(slot).toBe(model.size); model.add(key); }
        } else {
          const had = model.has(key);
          const lastSlot = s.count - 1;
          const slotBefore = s.slotOf(key);
          const move = s.release(key);
          model.delete(key);
          if (!had || slotBefore === lastSlot) expect(move).toBeNull();
          else {
            expect(move).not.toBeNull();
            expect(move!.from).toBe(lastSlot);
            expect(move!.to).toBe(slotBefore);
            expect(s.slotOf(move!.key)).toBe(slotBefore);
          }
        }
        if (step % 50 === 0) assertConsistent(s, model);
      }
      assertConsistent(s, model);
    }
  });
});

describe('instance ops on an InstancedMesh', () => {
  const m = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const col = new THREE.Color();

  function setup(capacity: number): { mesh: THREE.InstancedMesh; slots: InstanceSlots } {
    const mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), capacity);
    mesh.count = 0;
    mesh.setColorAt(0, col.set(0));
    return { mesh, slots: new InstanceSlots(capacity) };
  }

  function show(mesh: THREE.InstancedMesh, slots: InstanceSlots, key: number): void {
    const slot = showInstance(mesh, slots, key, m.makeTranslation(key, key * 2, key * 3));
    mesh.setColorAt(slot, col.setRGB(key / 100, 0.5, 0.25));
  }

  function expectInstance(mesh: THREE.InstancedMesh, slots: InstanceSlots, key: number): void {
    const slot = slots.slotOf(key);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(mesh.count);
    mesh.getMatrixAt(slot, tmp);
    expect(tmp.elements[12]).toBe(key);
    expect(tmp.elements[13]).toBe(key * 2);
    expect(tmp.elements[14]).toBe(key * 3);
    mesh.getColorAt(slot, col);
    expect(col.r).toBeCloseTo(key / 100, 5);
    expect(col.g).toBeCloseTo(0.5, 5);
  }

  it('keeps mesh.count equal to live instances and moves matrix and colour together', () => {
    const { mesh, slots } = setup(10);
    [1, 2, 3, 4, 5].forEach((k) => show(mesh, slots, k));
    expect(mesh.count).toBe(5);
    removeInstance(mesh, slots, 2);
    expect(mesh.count).toBe(4);
    removeInstance(mesh, slots, 99);
    expect(mesh.count).toBe(4);
    for (const k of [1, 3, 4, 5]) expectInstance(mesh, slots, k);
  });

  it('survives random show/remove sequences without corrupting survivors', () => {
    const rnd = mulberry32(42);
    const { mesh, slots } = setup(30);
    const live = new Set<number>();
    for (let step = 0; step < 2000; step++) {
      const key = Math.floor(rnd() * 30) + 1;
      if (rnd() < 0.55) { show(mesh, slots, key); live.add(key); }
      else { removeInstance(mesh, slots, key); live.delete(key); }
      expect(mesh.count).toBe(live.size);
    }
    for (const k of live) expectInstance(mesh, slots, k);
  });

  it('updating a held key keeps its slot and does not grow the count', () => {
    const { mesh, slots } = setup(5);
    show(mesh, slots, 7);
    const slot = slots.slotOf(7);
    show(mesh, slots, 7);
    expect(slots.slotOf(7)).toBe(slot);
    expect(mesh.count).toBe(1);
  });

  it('a full pool leaves the count unchanged', () => {
    const { mesh, slots } = setup(2);
    show(mesh, slots, 1);
    show(mesh, slots, 2);
    expect(showInstance(mesh, slots, 3, m.identity())).toBe(-1);
    expect(mesh.count).toBe(2);
  });

  it('clearInstances empties both the slots and the draw', () => {
    const { mesh, slots } = setup(5);
    show(mesh, slots, 1);
    show(mesh, slots, 2);
    clearInstances(mesh, slots);
    expect(mesh.count).toBe(0);
    expect(slots.count).toBe(0);
    show(mesh, slots, 3);
    expect(slots.slotOf(3)).toBe(0);
    expect(mesh.count).toBe(1);
  });

  it('moveInstance copies without touching neighbours', () => {
    const { mesh } = setup(3);
    for (let i = 0; i < 3; i++) {
      mesh.setMatrixAt(i, m.makeTranslation(i + 1, 0, 0));
      mesh.setColorAt(i, col.setRGB((i + 1) / 10, 0, 0));
    }
    moveInstance(mesh, 2, 0);
    mesh.getMatrixAt(0, tmp);
    expect(tmp.elements[12]).toBe(3);
    mesh.getMatrixAt(1, tmp);
    expect(tmp.elements[12]).toBe(2);
    mesh.getColorAt(0, col);
    expect(col.r).toBeCloseTo(0.3, 5);
  });
});
