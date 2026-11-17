import * as THREE from 'three';
import type { Vec3 } from '../core/state';

interface Pool {
  mesh: THREE.InstancedMesh;
  dummy: THREE.Object3D;
  count: number;
  max: number;
}

export class InstancePool {
  private pools = new Map<string, Pool>();

  constructor(private parent: THREE.Object3D) {}

  create(type: string, geometry: THREE.BufferGeometry, material: THREE.Material, max: number): void {
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.parent.add(mesh);
    this.pools.set(type, { mesh, dummy: new THREE.Object3D(), count: 0, max });
  }

  get(type: string): Pool | undefined {
    return this.pools.get(type);
  }

  setInstance(type: string, index: number, pos: Vec3, up: Vec3, roll = 0): void {
    const pool = this.pools.get(type);
    if (!pool || index >= pool.max) return;
    const { dummy } = pool;
    const w = up;
    dummy.position.set(pos.x * 1, pos.y * 1, pos.z * 1);
    dummy.lookAt(new THREE.Vector3(pos.x + w.x, pos.y + w.y, pos.z + w.z));
    dummy.rotation.z = roll;
    dummy.updateMatrix();
    pool.mesh.setMatrixAt(index, dummy.matrix);
  }

  setCount(type: string, count: number): void {
    const pool = this.pools.get(type);
    if (!pool) return;
    pool.count = Math.min(count, pool.max);
    pool.mesh.count = pool.count;
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const pool of this.pools.values()) {
      this.parent.remove(pool.mesh);
      pool.mesh.geometry.dispose();
      (pool.mesh.material as THREE.Material).dispose();
    }
    this.pools.clear();
  }
}
