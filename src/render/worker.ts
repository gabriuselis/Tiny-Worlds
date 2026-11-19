import * as THREE from 'three';
import { disposeAllWorkerRenderers } from './workerRenderer';
import { disposeSharedWorkerResources as disposeResources } from './workerResources';

export { createWorkerModel } from './workerModel';
export type { WorkerModel } from './workerModel';
export { animateWorker, disposeWorkerModel } from './workerAnim';
export { getWorkerRenderer, disposeWorkerRenderer } from './workerRenderer';
export type { WorkerRenderer } from './workerRenderer';

/** Frees every instanced pool, then the cached geometries, materials and textures. */
export function disposeSharedWorkerResources(): void {
  disposeAllWorkerRenderers();
  disposeResources();
}

const scratchUp = new THREE.Vector3();
const scratchX = new THREE.Vector3();
const scratchZ = new THREE.Vector3();
const scratchBasis = new THREE.Matrix4();

export function placeWorkerModel(
  vm: import('./workerModel').WorkerModel,
  dir: THREE.Vector3,
  forward: THREE.Vector3 | null,
  radius: number,
): void {
  const up = scratchUp.copy(dir).normalize();
  vm.group.position.copy(up).multiplyScalar(radius);

  const z = scratchZ;
  if (forward) z.copy(forward);
  else z.set(0, 0, 0);
  z.addScaledVector(up, -z.dot(up));
  if (z.lengthSq() < 1e-8) {
    z.set(0, 0, 1).addScaledVector(up, -up.z);
  }
  if (z.lengthSq() < 1e-8) z.set(1, 0, 0);
  z.normalize();

  const x = scratchX.crossVectors(up, z).normalize();
  z.crossVectors(x, up).normalize();
  vm.group.quaternion.setFromRotationMatrix(scratchBasis.makeBasis(x, up, z));
}

/**
 * Tangent direction at `fromDir` pointing toward `toDir` along the sphere.
 * Writes into `out` when given (it must not be the same object as `fromDir`).
 */
export function tangentTowards(
  fromDir: THREE.Vector3,
  toDir: THREE.Vector3,
  out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const t = out.copy(toDir).sub(fromDir);
  t.addScaledVector(fromDir, -t.dot(fromDir));
  if (t.lengthSq() < 1e-8) return t.set(0, 0, 1);
  return t.normalize();
}
