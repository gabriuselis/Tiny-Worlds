import * as THREE from 'three';
import { WORKER_ANIM as A } from '../core/config/worker';
import { HIDDEN_INSTANCE_MATRIX, InstancePool } from './workerPool';
import { getRoleGeometries, getSharedResources } from './workerResources';

export type PoolKind = 'leg' | 'shadow' | 'dirt' | 'bubble' | 'logA' | 'logB' | 'body' | 'arm' | 'tool' | 'head';

const OPAQUE_ORDER = 4;
const SHADOW_ORDER = 5;
const BUBBLE_ORDER = 6;

export interface PartBinding {
  pool: InstancePool;
  node: THREE.Object3D;
  /** Parent group whose `visible` flag also hides this part. */
  gate: THREE.Object3D | null;
  index: number;
  alpha: Float32Array | null;
}

/** A detached transform hierarchy (never added to the scene) plus the instanced parts it drives. */
export interface WorkerRig {
  group: THREE.Group;
  bindings: PartBinding[];
}

/**
 * Owns the instanced pools for every worker rig that lives in one parent space (the planet group).
 * Draw calls depend only on the number of distinct parts, never on the number of workers.
 */
export class WorkerRenderer {
  private readonly pools = new Map<string, InstancePool>();
  private readonly rigs = new Set<WorkerRig>();

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly boundsRadius: number,
  ) {}

  get rigCount(): number {
    return this.rigs.size;
  }

  pool(kind: PoolKind, role: string): InstancePool {
    const key = kind === 'body' || kind === 'arm' || kind === 'tool' || kind === 'head' ? `${kind}:${role}` : kind;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = this.createPool(key, kind, role);
      this.pools.set(key, pool);
    }
    return pool;
  }

  add(rig: WorkerRig): void {
    if (this.rigs.has(rig)) return;
    this.rigs.add(rig);
    const seen = new Set<InstancePool>();
    for (const b of rig.bindings) {
      if (seen.has(b.pool)) continue;
      seen.add(b.pool);
      b.pool.acquire(rig);
    }
  }

  remove(rig: WorkerRig): void {
    if (!this.rigs.delete(rig)) return;
    const seen = new Set<InstancePool>();
    for (const b of rig.bindings) {
      if (seen.has(b.pool)) continue;
      seen.add(b.pool);
      b.pool.release(rig);
    }
  }

  /** Writes every rig part's matrix (already in parent space) into its pool, then uploads each dirty pool once. */
  flush(): void {
    for (const rig of this.rigs) {
      rig.group.updateMatrixWorld(true);
      for (const b of rig.bindings) {
        const slot = b.pool.slotOf(rig);
        if (slot < 0) continue;
        const shown = b.node.visible && (b.gate === null || b.gate.visible);
        b.pool.setMatrix(slot, b.index, shown ? b.node.matrixWorld : HIDDEN_INSTANCE_MATRIX);
        if (b.alpha && shown) b.pool.setAlpha(slot, b.index, b.alpha[b.index]);
      }
    }
    for (const pool of this.pools.values()) pool.flush();
  }

  dispose(): void {
    this.rigs.clear();
    for (const pool of this.pools.values()) pool.dispose();
    this.pools.clear();
  }

  private createPool(key: string, kind: PoolKind, role: string): InstancePool {
    const res = getSharedResources();
    const base = { name: `workers-${key}`, parent: this.parent, boundsRadius: this.boundsRadius };
    const solid = { ...base, material: res.material, renderOrder: OPAQUE_ORDER };
    switch (kind) {
      case 'leg':
        return new InstancePool({ ...solid, geometry: res.leg, perOwner: 2 });
      case 'body':
        return new InstancePool({ ...solid, geometry: getRoleGeometries(role).body, perOwner: 1 });
      case 'arm':
        return new InstancePool({ ...solid, geometry: getRoleGeometries(role).arm, perOwner: 2 });
      case 'tool':
        return new InstancePool({ ...solid, geometry: getRoleGeometries(role).tool!, perOwner: 1 });
      case 'head':
        return new InstancePool({ ...solid, geometry: getRoleGeometries(role).head, perOwner: 1 });
      case 'logA':
        return new InstancePool({ ...solid, geometry: res.carryLogGeometries[0], perOwner: 2 });
      case 'logB':
        return new InstancePool({ ...solid, geometry: res.carryLogGeometries[1], perOwner: 1 });
      case 'shadow':
        return new InstancePool({
          ...base,
          geometry: res.shadowGeometry,
          material: res.shadowMaterial,
          perOwner: 1,
          renderOrder: SHADOW_ORDER,
        });
      case 'dirt':
        return new InstancePool({
          ...base,
          geometry: res.dirtGeometry,
          material: res.dirtMaterial,
          perOwner: A.dirtCount,
          renderOrder: OPAQUE_ORDER,
          alpha: true,
        });
      case 'bubble':
        return new InstancePool({
          ...base,
          geometry: res.bubbleGeometry,
          material: res.bubbleMaterial,
          perOwner: 1,
          renderOrder: BUBBLE_ORDER,
        });
    }
  }
}

const renderers = new Map<THREE.Object3D, WorkerRenderer>();

/** One renderer per parent space; `boundsRadius` is only used when the renderer is first created. */
export function getWorkerRenderer(parent: THREE.Object3D, boundsRadius: number): WorkerRenderer {
  let r = renderers.get(parent);
  if (!r) {
    r = new WorkerRenderer(parent, boundsRadius);
    renderers.set(parent, r);
  }
  return r;
}

export function disposeWorkerRenderer(parent: THREE.Object3D): void {
  renderers.get(parent)?.dispose();
  renderers.delete(parent);
}

export function disposeAllWorkerRenderers(): void {
  for (const r of renderers.values()) r.dispose();
  renderers.clear();
}
