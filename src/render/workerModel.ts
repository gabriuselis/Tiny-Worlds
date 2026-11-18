import * as THREE from 'three';
import { WORKER_MODEL as M, WORKER_ANIM as A, WORKER_COLORS, shirtColorFor } from '../core/config/worker';

export interface WorkerModel {
  group: THREE.Group;
  role: string;
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
  carryLogs: THREE.Group;
  carryLogMeshes: THREE.Mesh[];
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
  const isLumberjack = role === 'lumberjack';
  const isCarrier = role === 'carrier';
  const capMat = std(isLumberjack ? WORKER_COLORS.lumberjackHat : isCarrier ? WORKER_COLORS.carrierHat : WORKER_COLORS.cap);
  const brimMat = std(
    isLumberjack ? WORKER_COLORS.lumberjackHatBrim : isCarrier ? WORKER_COLORS.carrierHatBrim : WORKER_COLORS.capBrim,
  );

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

  // ----- Tool held in the right hand (shovel for planters, axe for lumberjacks) -----
  const shovel = new THREE.Group();
  shovel.position.y = -M.armLength;
  if (isLumberjack) {
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(M.axeHandleWidth / 2, M.axeHandleWidth / 2, M.axeHandleLength, 6),
      std(WORKER_COLORS.shovelStick),
    );
    handle.position.y = -M.axeHandleLength * 0.35;
    shovel.add(handle);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(M.axeHeadWidth, M.axeHeadHeight, M.axeHeadDepth),
      std(WORKER_COLORS.axeHead),
    );
    head.position.set(0, -M.axeHandleLength * 0.78, 0.004);
    shovel.add(head);
  } else if (!isCarrier) {
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
  }
  armR.add(shovel);

  // ----- Backpack + shoulder logs (carrier) -----
  if (isCarrier) {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(M.backpackWidth, M.backpackHeight, M.backpackDepth),
      std(WORKER_COLORS.backpack),
    );
    pack.position.set(0, M.bodyCenterY - 0.006, M.backpackZ);
    root.add(pack);
    const strapGeo = new THREE.BoxGeometry(0.008, M.bodyHeight * 0.9, 0.008);
    for (const sign of [-1, 1]) {
      const strap = new THREE.Mesh(strapGeo, std(WORKER_COLORS.backpackStrap));
      strap.position.set(sign * 0.018, M.bodyCenterY, M.backpackZ + M.backpackDepth * 0.5);
      strap.rotation.x = -0.15;
      root.add(strap);
    }
  }

  const carryLogs = new THREE.Group();
  carryLogs.position.y = M.carryLogY;
  carryLogs.visible = false;
  const carryLogMeshes: THREE.Mesh[] = [];
  const carryGeo = new THREE.CylinderGeometry(M.carryLogRadius, M.carryLogRadius, M.carryLogLength, 6);
  carryGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(carryGeo, std(i % 2 === 0 ? WORKER_COLORS.carryLog : WORKER_COLORS.carryLogEnd));
    log.position.set(0, i * M.carryLogRadius * 1.4, (i - 1) * M.carryLogSpacingZ * 0.6);
    log.visible = false;
    carryLogs.add(log);
    carryLogMeshes.push(log);
  }
  root.add(carryLogs);

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
  if (isLumberjack) brim.scale.set(1.45, 1, 1.15); // wide cowboy brim
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
    role,
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
    carryLogs,
    carryLogMeshes,
    animTime: Math.random() * 10,
    puffTimer: 0,
    forward: new THREE.Vector3(0, 0, 1),
  };
}
