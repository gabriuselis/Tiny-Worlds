import * as THREE from 'three';
import { WORKER_POOL } from '../core/config/worker';
import { SlotAllocator, grownCapacity } from './workerSlots';

export const HIDDEN_INSTANCE_MATRIX = new THREE.Matrix4().makeScale(
  WORKER_POOL.hiddenScale,
  WORKER_POOL.hiddenScale,
  WORKER_POOL.hiddenScale,
);

const ALPHA_ATTRIBUTE = 'instanceAlpha';

export interface InstancePoolOptions {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  parent: THREE.Object3D;
  /** Instances each owner occupies (e.g. 2 for a pair of legs). */
  perOwner: number;
  renderOrder: number;
  boundsRadius: number;
  /** Adds a per-instance float attribute `instanceAlpha` (the material must read it). */
  alpha?: boolean;
}

/**
 * One InstancedMesh shared by every owner (worker) of a part. Each owner holds a contiguous block of
 * `perOwner` instances; blocks stay dense so `mesh.count` always equals the live instance count.
 */
export class InstancePool {
  private mesh: THREE.InstancedMesh;
  private capacity: number = WORKER_POOL.initialCapacity;
  private readonly alloc = new SlotAllocator<object>();
  private dirty = false;

  constructor(private readonly opts: InstancePoolOptions) {
    this.mesh = this.createMesh(this.capacity);
  }

  get ownerCount(): number {
    return this.alloc.count;
  }

  slotOf(owner: object): number {
    return this.alloc.slotOf(owner) ?? -1;
  }

  acquire(owner: object): number {
    const slot = this.alloc.add(owner);
    if (slot >= this.capacity) this.grow(slot + 1);
    for (let k = 0; k < this.opts.perOwner; k++) this.setMatrix(slot, k, HIDDEN_INSTANCE_MATRIX);
    this.syncCount();
    return slot;
  }

  release(owner: object): void {
    const move = this.alloc.remove(owner);
    if (!move) return;
    if (move.from !== move.to) this.copyBlock(move.from, move.to);
    this.syncCount();
    this.dirty = true;
  }

  setMatrix(slot: number, index: number, matrix: THREE.Matrix4): void {
    this.mesh.setMatrixAt(slot * this.opts.perOwner + index, matrix);
    this.dirty = true;
  }

  setAlpha(slot: number, index: number, alpha: number): void {
    const attr = this.mesh.geometry.getAttribute(ALPHA_ATTRIBUTE) as THREE.InstancedBufferAttribute;
    attr.setX(slot * this.opts.perOwner + index, alpha);
  }

  /** Uploads the buffers once, and only if something was written since the last flush. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.opts.alpha) (this.mesh.geometry.getAttribute(ALPHA_ATTRIBUTE) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.destroyMesh(this.mesh);
  }

  private syncCount(): void {
    this.mesh.count = this.alloc.count * this.opts.perOwner;
    this.mesh.visible = this.mesh.count > 0;
  }

  private copyBlock(from: number, to: number): void {
    const n = this.opts.perOwner;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    m.copyWithin(to * n * 16, from * n * 16, (from + 1) * n * 16);
    if (this.opts.alpha) {
      const a = this.mesh.geometry.getAttribute(ALPHA_ATTRIBUTE).array as Float32Array;
      a.copyWithin(to * n, from * n, (from + 1) * n);
    }
  }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const { geometry, material, perOwner, alpha } = this.opts;
    const geo = alpha ? geometry.clone() : geometry;
    if (alpha) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * perOwner), 1);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(ALPHA_ATTRIBUTE, attr);
    }
    const mesh = new THREE.InstancedMesh(geo, material, capacity * perOwner);
    mesh.name = this.opts.name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = this.opts.renderOrder;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.opts.boundsRadius);
    mesh.count = 0;
    mesh.visible = false;
    this.opts.parent.add(mesh);
    return mesh;
  }

  private destroyMesh(mesh: THREE.InstancedMesh): void {
    mesh.parent?.remove(mesh);
    mesh.dispose();
    if (this.opts.alpha) mesh.geometry.dispose();
  }

  private grow(needed: number): void {
    const old = this.mesh;
    this.capacity = grownCapacity(this.capacity, needed, WORKER_POOL.growthFactor);
    const next = this.createMesh(this.capacity);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    if (this.opts.alpha) {
      const oldAlpha = old.geometry.getAttribute(ALPHA_ATTRIBUTE).array as Float32Array;
      (next.geometry.getAttribute(ALPHA_ATTRIBUTE).array as Float32Array).set(oldAlpha);
    }
    next.count = old.count;
    next.visible = old.visible;
    this.mesh = next;
    this.destroyMesh(old);
    this.dirty = true;
  }
}
