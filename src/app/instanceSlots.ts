export interface SlotMove {
  key: number;
  from: number;
  to: number;
}

// Keeps live instances packed in slots [0, count) so an InstancedMesh can draw
// exactly `count` instances. Releasing a key moves the last live instance into
// the freed slot; the caller must copy that instance's data from `from` to `to`.
export class InstanceSlots {
  private readonly slotByKey = new Map<number, number>();
  private readonly keyBySlot: number[] = [];

  constructor(readonly capacity: number) {}

  get count(): number {
    return this.keyBySlot.length;
  }

  slotOf(key: number): number {
    return this.slotByKey.get(key) ?? -1;
  }

  keyAt(slot: number): number {
    return this.keyBySlot[slot];
  }

  /** Slot for `key`, allocating one at the end if needed. Returns -1 when full. */
  acquire(key: number): number {
    const existing = this.slotByKey.get(key);
    if (existing !== undefined) return existing;
    if (this.keyBySlot.length >= this.capacity) return -1;
    const slot = this.keyBySlot.length;
    this.keyBySlot.push(key);
    this.slotByKey.set(key, slot);
    return slot;
  }

  /** Frees `key`. Returns the relocation to apply, or null when no other instance moved. */
  release(key: number): SlotMove | null {
    const slot = this.slotByKey.get(key);
    if (slot === undefined) return null;
    this.slotByKey.delete(key);
    const last = this.keyBySlot.length - 1;
    const lastKey = this.keyBySlot.pop() as number;
    if (slot === last) return null;
    this.keyBySlot[slot] = lastKey;
    this.slotByKey.set(lastKey, slot);
    return { key: lastKey, from: last, to: slot };
  }

  clear(): void {
    this.slotByKey.clear();
    this.keyBySlot.length = 0;
  }
}
