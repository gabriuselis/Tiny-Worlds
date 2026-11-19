import type * as THREE from 'three';
import type { InstanceSlots } from './instanceSlots';

function copyAttributeItem(attr: THREE.BufferAttribute, from: number, to: number): void {
  const n = attr.itemSize;
  attr.array.copyWithin(to * n, from * n, from * n + n);
}

// Copies every per-instance attribute (matrix, and colour when present) between slots.
export function moveInstance(mesh: THREE.InstancedMesh, from: number, to: number): void {
  copyAttributeItem(mesh.instanceMatrix, from, to);
  if (mesh.instanceColor) copyAttributeItem(mesh.instanceColor, from, to);
}

/** Writes `key`'s matrix, allocating a slot if needed, and keeps `mesh.count` equal to the live count. */
export function showInstance(
  mesh: THREE.InstancedMesh,
  slots: InstanceSlots,
  key: number,
  matrix: THREE.Matrix4,
): number {
  const slot = slots.acquire(key);
  if (slot < 0) return -1;
  mesh.setMatrixAt(slot, matrix);
  mesh.count = slots.count;
  return slot;
}

/** Removes `key` from the draw, moving the last live instance into the gap. */
export function removeInstance(mesh: THREE.InstancedMesh, slots: InstanceSlots, key: number): void {
  const move = slots.release(key);
  if (move) moveInstance(mesh, move.from, move.to);
  mesh.count = slots.count;
}

export function clearInstances(mesh: THREE.InstancedMesh, slots: InstanceSlots): void {
  slots.clear();
  mesh.count = 0;
}
