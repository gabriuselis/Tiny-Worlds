import * as THREE from 'three';
import {
  createWorkerModel,
  animateWorker,
  disposeWorkerModel,
  getWorkerRenderer,
  disposeWorkerRenderer,
  WorkerModel,
} from '../render/worker';
import { WORKER_POOL } from '../core/config/worker';
import { logEvent, showToast } from '../ui/ui';
import { ctx } from '../app/context';
import { showError } from '../app/errors';

let testWorkerModel: WorkerModel | null = null;
let testWorkerParent: THREE.Object3D | null = null;
let testWorkerTimer: number | null = null;

export function animateTestWorker(dt: number): void {
  if (!testWorkerModel) return;
  animateWorker(testWorkerModel, 'idle', dt);
  testWorkerModel.renderer.flush();
}

function releaseTestWorker(): void {
  if (testWorkerModel) {
    try { disposeWorkerModel(testWorkerModel); } catch { /* ignore */ }
    testWorkerModel = null;
  }
  if (testWorkerParent) {
    try { disposeWorkerRenderer(testWorkerParent); } catch { /* ignore */ }
    testWorkerParent = null;
  }
}

export function resetTestWorker(): void {
  releaseTestWorker();
  if (testWorkerTimer) { clearTimeout(testWorkerTimer); testWorkerTimer = null; }
}

// Test worker: one model at 3x scale in front of the camera for 8 seconds, standing still.
export function installTestWorkerHook(): void {
  (window as any).__testWorker = () => {
    try {
      const sceneAPI = ctx.sceneAPI;
      if (!sceneAPI) return;
      resetTestWorker();

      // Pools live in the scene root, so the model's transform below is plain world space.
      testWorkerParent = sceneAPI.scene;
      const vm = createWorkerModel('planter', getWorkerRenderer(sceneAPI.scene, WORKER_POOL.worldBoundsRadius));
      const cam = sceneAPI.camera;
      const camPos = cam.position.clone();
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
      const pos = camPos.clone().addScaledVector(camDir, 1.5);

      const up = new THREE.Vector3(0, 1, 0);
      const toCam = camPos.clone().sub(pos).normalize();
      const x = new THREE.Vector3().crossVectors(up, toCam).normalize();
      const z = new THREE.Vector3().crossVectors(x, up).normalize();
      vm.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
      vm.group.position.copy(pos);
      vm.group.scale.setScalar(3);
      animateWorker(vm, 'idle', 0);
      vm.renderer.flush();
      testWorkerModel = vm;

      testWorkerTimer = window.setTimeout(() => {
        releaseTestWorker();
        testWorkerTimer = null;
      }, 8000);
      logEvent('Test worker: model at 3x in front of camera for 8s');
      showToast('Test worker: 8 s');
    } catch (err) {
      showError('Test worker failed', err);
    }
  };
}
