export interface SlotMove {
  from: number;
  to: number;
}

/** Dense slot bookkeeping: slots are always 0..count-1, removal swaps the last slot into the hole. */
export class SlotAllocator<K> {
  private readonly slots = new Map<K, number>();
  private readonly keys: K[] = [];

  get count(): number {
    return this.keys.length;
  }

  slotOf(key: K): number | undefined {
    return this.slots.get(key);
  }

  add(key: K): number {
    const existing = this.slots.get(key);
    if (existing !== undefined) return existing;
    const slot = this.keys.length;
    this.keys.push(key);
    this.slots.set(key, slot);
    return slot;
  }

  /** Returns the slot that was relocated (from the last slot into the freed one), or null if `key` is unknown. */
  remove(key: K): SlotMove | null {
    const slot = this.slots.get(key);
    if (slot === undefined) return null;
    const last = this.keys.length - 1;
    if (slot !== last) {
      const moved = this.keys[last];
      this.keys[slot] = moved;
      this.slots.set(moved, slot);
    }
    this.keys.pop();
    this.slots.delete(key);
    return { from: last, to: slot };
  }
}

export function grownCapacity(capacity: number, needed: number, factor: number): number {
  let next = Math.max(1, capacity);
  while (next < needed) next = Math.ceil(next * factor);
  return next;
}
