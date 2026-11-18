import * as THREE from 'three';

export { createWorkerModel } from './workerModel';
export type { WorkerModel } from './workerModel';
export { animateWorker, disposeWorkerModel } from './workerAnim';

export function placeWorkerModel(
  vm: import('./workerModel').WorkerModel,
  dir: THREE.Vector3,
  forward: THREE.Vector3 | null,
  radius: number,
): void {
  const up = dir.clone().normalize();
  vm.group.position.copy(up).multiplyScalar(radius);

  const z = new THREE.Vector3();
  if (forward) z.copy(forward);
  z.addScaledVector(up, -z.dot(up));
  if (z.lengthSq() < 1e-8) {
    z.set(0, 0, 1).addScaledVector(up, -up.z);
  }
  if (z.lengthSq() < 1e-8) z.set(1, 0, 0);
  z.normalize();

  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const zz = new THREE.Vector3().crossVectors(x, up).normalize();
  vm.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, zz));
}

/** Tangent direction at romDir pointing toward 	oDir along the sphere. */
export function tangentTowards(fromDir: THREE.Vector3, toDir: THREE.Vector3): THREE.Vector3 {
  const t = toDir.clone().sub(fromDir);
  t.addScaledVector(fromDir, -t.dot(fromDir));
  if (t.lengthSq() < 1e-8) return new THREE.Vector3(0, 0, 1);
  return t.normalize();
}

