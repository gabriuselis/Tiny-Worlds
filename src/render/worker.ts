import * as THREE from 'three';
import { WORKER_MODEL as M, WORKER_ANIM as A, WORKER_COLORS, shirtColorFor } from '../core/config/worker';

export interface WorkerModel {
  group: THREE.Group;
  root: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  shovel: THREE.Group;
  head: THREE.Group;
  bubble: THREE.Sprite;
  shadow: THREE.Mesh;
  dirt: THREE.Group;
  dirtParticles: THREE.Mesh[];
  animTime: number;
  puffTimer: number;
  forward: THREE.Vector3;
}

function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });
}

function capsule(radius: number, length: number): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(radius, Math.max(0.001, length), 4, 10);
}

function makeBubbleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#2b3a55';
  ctx.stroke();
  ctx.fillStyle = '#1d4ed8';
  ctx.font = 'bold 82px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build ONE upright worker model.
 * Local frame: +Y is up (feet at y = 0), +Z is forward (face / travel direction).
 * The caller positions it on the surface and orients it with placeWorkerModel().
 */
export function createWorkerModel(role: string): WorkerModel {
  const group = new THREE.Group();
  group.name = `worker-${role}`;

  const root = new THREE.Group();
  group.add(root);

  const shirt = std(shirtColorFor(role));
  const pants = std(WORKER_COLORS.pants);
  const boots = std(WORKER_COLORS.boots);
  const skin = std(WORKER_COLORS.skin);
  const capMat = std(WORKER_COLORS.cap);
  const brimMat = std(WORKER_COLORS.capBrim);

  // ----- Legs (pivot at the hip) -----
  const legGeo = new THREE.BoxGeometry(M.legWidth, M.legHeight, M.legWidth);
  const bootGeo = new THREE.BoxGeometry(M.legWidth * 1.1, 0.012, M.legWidth * 1.35);
  function makeLeg(sign: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(sign * M.legSpacing, M.hipY, 0);
    const leg = new THREE.Mesh(legGeo, pants);
    leg.position.y = -M.legHeight / 2;
    pivot.add(leg);
    const boot = new THREE.Mesh(bootGeo, boots);
    boot.position.set(0, -M.legHeight + 0.006, M.legWidth * 0.25);
    pivot.add(boot);
    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  root.add(legL, legR);

  // ----- Torso (rounded box / capsule) -----
  const torso = new THREE.Mesh(capsule(M.bodyWidth / 2, M.bodyHeight - M.bodyWidth), shirt);
  torso.position.y = M.bodyCenterY;
  root.add(torso);

  // ----- Arms (pivot at the shoulder) -----
  const armGeo = capsule(M.armWidth / 2, M.armLength - M.armWidth);
  const handGeo = new THREE.SphereGeometry(M.armWidth * 0.55, 8, 6);
  function makeArm(sign: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(sign * M.shoulderX, M.shoulderY, 0);
    const arm = new THREE.Mesh(armGeo, shirt);
    arm.position.y = -M.armLength / 2;
    pivot.add(arm);
    const hand = new THREE.Mesh(handGeo, skin);
    hand.position.y = -M.armLength;
    pivot.add(hand);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);
  root.add(armL, armR);

  // ----- Shovel held in the right hand -----
  const shovel = new THREE.Group();
  shovel.position.y = -M.armLength;
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(M.shovelStickWidth / 2, M.shovelStickWidth / 2, M.shovelStickLength, 6),
    std(WORKER_COLORS.shovelStick),
  );
  stick.position.y = -M.shovelStickLength * 0.35;
  shovel.add(stick);
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(M.shovelBladeWidth, M.shovelBladeHeight, M.shovelBladeDepth),
    std(WORKER_COLORS.shovelBlade),
  );
  blade.position.y = -M.shovelStickLength * 0.75;
  shovel.add(blade);
  armR.add(shovel);

  // ----- Head (sphere + eyes) -----
  const head = new THREE.Group();
  head.position.y = M.headY;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(M.headRadius, 12, 10), skin);
  head.add(skull);
  const eyeGeo = new THREE.SphereGeometry(M.eyeRadius, 6, 6);
  const eyeMat = std(WORKER_COLORS.eyes);
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sign * M.eyeOffsetX, M.eyeOffsetY, M.eyeOffsetZ);
    head.add(eye);
  }
  root.add(head);

  // ----- Cap (half sphere + brim in front) -----
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(M.capRadius, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    capMat,
  );
  cap.position.y = 0;
  head.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(M.brimWidth, M.brimHeight, M.brimDepth), brimMat);
  brim.position.set(0, M.headRadius - 0.004, M.brimZ);
  head.add(brim);

  // ----- Ground shadow (flat, soft) -----
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(M.shadowRadius, 20),
    new THREE.MeshBasicMaterial({
      color: WORKER_COLORS.shadow,
      transparent: true,
      opacity: M.shadowOpacity,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  shadow.renderOrder = 5;
  group.add(shadow);

  // ----- Dirt particles (shown while planting / on spawn puff) -----
  const dirt = new THREE.Group();
  const dirtParticles: THREE.Mesh[] = [];
  const dirtGeo = new THREE.SphereGeometry(A.dirtRadius, 6, 6);
  for (let i = 0; i < A.dirtCount; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: WORKER_COLORS.dirt,
      roughness: 0.9,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const p = new THREE.Mesh(dirtGeo, mat);
    p.visible = false;
    p.renderOrder = 5;
    dirt.add(p);
    dirtParticles.push(p);
  }
  dirt.visible = false;
  group.add(dirt);

  // ----- "?" bubble when there is nothing to plant -----
  const bubble = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: makeBubbleTexture(), transparent: true, depthTest: false }),
  );
  bubble.scale.set(0.09, 0.09, 1);
  bubble.position.y = M.totalHeight + 0.09;
  bubble.renderOrder = 6;
  bubble.visible = false;
  group.add(bubble);

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.renderOrder = 4;
  });
  shadow.renderOrder = 5;
  bubble.renderOrder = 6;

  return {
    group,
    root,
    legL,
    legR,
    armL,
    armR,
    shovel,
    head,
    bubble,
    shadow,
    dirt,
    dirtParticles,
    animTime: Math.random() * 10,
    puffTimer: 0,
    forward: new THREE.Vector3(0, 0, 1),
  };
}

/**
 * Orient the model: local +Y = surface normal, local +Z = forward (travel).
 * This is what keeps the person upright (the old code pointed +Y along the
 * travel tangent, which made the capsule lie flat on the ground like a stick).
 */
export function placeWorkerModel(
  vm: WorkerModel,
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

/** Tangent direction at `fromDir` pointing toward `toDir` along the sphere. */
export function tangentTowards(fromDir: THREE.Vector3, toDir: THREE.Vector3): THREE.Vector3 {
  const t = toDir.clone().sub(fromDir);
  t.addScaledVector(fromDir, -t.dot(fromDir));
  if (t.lengthSq() < 1e-8) return new THREE.Vector3(0, 0, 1);
  return t.normalize();
}

/**
 * Pose the model for a worker AI state. Pure animation from time, no skeleton.
 */
export function animateWorker(vm: WorkerModel, state: string, dt: number): void {
  vm.animTime += dt;
  const t = vm.animTime;
  const run = state === 'walking' || state === 'walk' || state === 'walkToPost';
  const plant = state === 'planting' || state === 'plant';
  const waiting = state === 'waiting';

  // Reset every animated transform (cheap, deterministic).
  vm.root.position.set(0, 0, 0);
  vm.root.rotation.set(0, 0, 0);
  vm.root.scale.set(1, 1, 1);
  vm.legL.rotation.x = 0;
  vm.legR.rotation.x = 0;
  vm.armL.rotation.x = 0;
  vm.armR.rotation.x = 0;
  vm.shovel.rotation.x = 0;
  vm.bubble.visible = waiting;

  if (run) {
    const phase = t * Math.PI * 2 * A.runCycleHz;
    const swing = Math.sin(phase);
    vm.legL.rotation.x = swing * A.runLegSwing;
    vm.legR.rotation.x = -swing * A.runLegSwing;
    vm.armL.rotation.x = -swing * A.runArmSwing;
    vm.armR.rotation.x = swing * A.runArmSwing;
    vm.root.position.y = Math.abs(swing) * A.runBob;
    vm.root.rotation.x = A.runLean;
  } else if (plant) {
    vm.root.position.y = -A.plantKneelDrop;
    vm.root.rotation.x = A.plantLean;
    vm.legL.rotation.x = -0.9;
    vm.legR.rotation.x = -0.9;
    const dig = Math.sin(t * Math.PI * 2 * A.plantDigHz);
    vm.armR.rotation.x = A.plantArmLift + dig * A.plantArmSwing;
    vm.armL.rotation.x = -0.6 + dig * 0.15;
    vm.shovel.rotation.x = dig * 0.35;
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
    for (let i = 0; i < vm.dirtParticles.length; i++) {
      const p = vm.dirtParticles[i];
      const phase = Math.max(0, Math.sin(t * speed + i * 1.7));
      const angle = (i / vm.dirtParticles.length) * Math.PI * 2;
      p.visible = phase > 0.05;
      p.position.set(
        Math.cos(angle) * 0.03,
        0.006 + phase * (plant ? 0.045 : 0.07),
        0.03 + Math.sin(angle) * 0.02,
      );
      const mat = p.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.75 * (1 - phase * 0.6);
    }
  }
}

/** Remove a model from its parent and free its GPU resources. */
export function disposeWorkerModel(vm: WorkerModel): void {
  vm.group.parent?.remove(vm.group);
  vm.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (o as THREE.Sprite).isSprite) {
      mesh.geometry?.dispose();
      const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(material) ? material : material ? [material] : [];
      for (const m of mats) {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map) map.dispose();
        m.dispose();
      }
    }
  });
}
