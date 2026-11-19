import { describe, it, expect } from 'vitest';
import { SlotAllocator, grownCapacity } from '../src/render/workerSlots';

describe('SlotAllocator', () => {
  it('assigns dense slots and is idempotent per key', () => {
    const a = new SlotAllocator<string>();
    expect(a.add('a')).toBe(0);
    expect(a.add('b')).toBe(1);
    expect(a.add('a')).toBe(0);
    expect(a.count).toBe(2);
  });

  it('swaps the last slot into the freed slot on removal', () => {
    const a = new SlotAllocator<string>();
    a.add('a');
    a.add('b');
    a.add('c');
    expect(a.remove('a')).toEqual({ from: 2, to: 0 });
    expect(a.slotOf('c')).toBe(0);
    expect(a.slotOf('b')).toBe(1);
    expect(a.slotOf('a')).toBeUndefined();
    expect(a.count).toBe(2);
  });

  it('removing the last slot moves nothing', () => {
    const a = new SlotAllocator<string>();
    a.add('a');
    a.add('b');
    expect(a.remove('b')).toEqual({ from: 1, to: 1 });
    expect(a.slotOf('a')).toBe(0);
    expect(a.count).toBe(1);
  });

  it('returns null for unknown keys and reuses slots after removal', () => {
    const a = new SlotAllocator<number>();
    expect(a.remove(5)).toBeNull();
    a.add(1);
    a.add(2);
    a.remove(1);
    expect(a.add(3)).toBe(1);
    expect(a.slotOf(2)).toBe(0);
  });

  it('keeps slots a permutation of 0..count-1 under random churn', () => {
    const a = new SlotAllocator<number>();
    const live = new Set<number>();
    let next = 0;
    for (let i = 0; i < 500; i++) {
      if (live.size === 0 || Math.random() < 0.55) {
        a.add(next);
        live.add(next++);
      } else {
        const key = [...live][Math.floor(Math.random() * live.size)];
        a.remove(key);
        live.delete(key);
      }
      const slots = [...live].map((k) => a.slotOf(k)!).sort((x, y) => x - y);
      expect(slots).toEqual(Array.from({ length: live.size }, (_, n) => n));
    }
  });
});

describe('grownCapacity', () => {
  it('multiplies until the need fits', () => {
    expect(grownCapacity(32, 33, 2)).toBe(64);
    expect(grownCapacity(32, 200, 2)).toBe(256);
    expect(grownCapacity(32, 10, 2)).toBe(32);
  });
});
