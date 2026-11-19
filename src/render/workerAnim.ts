import { WORKER_ANIM as A } from '../core/config/worker';
import type { WorkerModel } from './workerModel';

export function animateWorker(vm: WorkerModel, state: string, dt: number, carry = 0): void {
  vm.animTime += dt;
  const t = vm.animTime;
  const run = state === 'walking' || state === 'walk' || state === 'walkToPost';
  const plant = state === 'planting' || state === 'plant';
  const waiting = state === 'waiting';
  const chopping = state === 'chopping';
  const picking = state === 'picking';
  const carrying = state === 'carrying' || state === 'delivering';

  // Reset every animated transform (cheap, deterministic).
  vm.root.position.set(0, 0, 0);
  vm.root.rotation.set(0, 0, 0);
  vm.root.scale.set(1, 1, 1);
  vm.legL.rotation.x = 0;
  vm.legR.rotation.x = 0;
  vm.armL.rotation.x = 0;
  vm.armR.rotation.x = 0;
  vm.shovel.rotation.x = 0;
  vm.bubble.visible = waiting && vm.role === 'planter';
  vm.carryLogs.visible = carrying && carry > 0;
  if (vm.carryLogs.visible) {
    for (let i = 0; i < vm.carryLogNodes.length; i++) vm.carryLogNodes[i].visible = i < carry;
  }

  if (run) {
    const phase = t * Math.PI * 2 * A.runCycleHz;
    const swing = Math.sin(phase);
    vm.legL.rotation.x = swing * A.runLegSwing;
    vm.legR.rotation.x = -swing * A.runLegSwing;
    vm.armL.rotation.x = -swing * A.runArmSwing;
    vm.armR.rotation.x = swing * A.runArmSwing;
    vm.root.position.y = Math.abs(swing) * A.runBob;
    vm.root.rotation.x = A.runLean + (carrying ? A.carryLean : 0);
  } else if (plant) {
    vm.root.position.y = -A.plantKneelDrop;
    vm.root.rotation.x = A.plantLean;
    vm.legL.rotation.x = -0.9;
    vm.legR.rotation.x = -0.9;
    const dig = Math.sin(t * Math.PI * 2 * A.plantDigHz);
    vm.armR.rotation.x = A.plantArmLift + dig * A.plantArmSwing;
    vm.armL.rotation.x = -0.6 + dig * 0.15;
    vm.shovel.rotation.x = dig * 0.35;
  } else if (chopping) {
    // Two-handed overhead axe swing.
    const swing = Math.sin(t * Math.PI * 2 * A.chopHz);
    vm.root.rotation.x = A.chopLean;
    vm.root.position.y = Math.abs(swing) * 0.006;
    vm.armR.rotation.x = A.chopArmStart + swing * A.chopArmSwing;
    vm.armL.rotation.x = A.chopArmStart * 0.8 + swing * A.chopArmSwing * 0.6;
    vm.legL.rotation.x = 0.18;
    vm.legR.rotation.x = -0.18;
  } else if (picking) {
    // Bend down and scoop a log off the pile.
    const bob = Math.sin(t * Math.PI * 2 * 1.2) * 0.5 + 0.5;
    vm.root.rotation.x = A.pickLean;
    vm.root.position.y = -A.pickDrop * bob;
    vm.armR.rotation.x = -0.9 - bob * 0.4;
    vm.armL.rotation.x = -0.7 - bob * 0.3;
    vm.legL.rotation.x = -0.35;
    vm.legR.rotation.x = -0.35;
  } else if (carrying) {
    vm.root.rotation.x = A.carryLean;
    vm.armL.rotation.x = -0.35;
    vm.armR.rotation.x = -0.35;
  } else if (!waiting) {
    // Idle breathing.
    vm.root.scale.y = 1 + Math.sin(t * Math.PI * 2 * A.idleBreathHz) * A.idleBreath;
  }

  // Dirt: planting always kicks dust, spawn puff briefly.
  if (vm.puffTimer > 0) vm.puffTimer = Math.max(0, vm.puffTimer - dt);
  const showDirt = plant || vm.puffTimer > 0;
  vm.dirt.visible = showDirt;
  if (showDirt) {
    const speed = plant ? 5 : 9;
    for (let i = 0; i < vm.dirtNodes.length; i++) {
      const p = vm.dirtNodes[i];
      const phase = Math.max(0, Math.sin(t * speed + i * 1.7));
      const angle = (i / vm.dirtNodes.length) * Math.PI * 2;
      p.visible = phase > 0.05;
      p.position.set(
        Math.cos(angle) * 0.03,
        0.006 + phase * (plant ? 0.045 : 0.07),
        0.03 + Math.sin(angle) * 0.02,
      );
      vm.dirtAlpha[i] = 0.75 * (1 - phase * 0.6);
    }
  }
}

/** Release the model's instance slots; nothing per-worker is held on the GPU. Safe to call twice. */
export function disposeWorkerModel(vm: WorkerModel): void {
  vm.renderer.remove(vm);
}
