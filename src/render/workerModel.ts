import * as THREE from 'three';
import { WORKER_MODEL as M, WORKER_ANIM as A, WORKER_POOL } from '../core/config/worker';
import { WorkerRenderer, type PartBinding, type PoolKind, type WorkerRig } from './workerRenderer';

export interface WorkerModel extends WorkerRig {
  role: string;
  renderer: WorkerRenderer;
  root: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  shovel: THREE.Group;
  head: THREE.Group;
  bubble: THREE.Group;
  shadow: THREE.Group;
  dirt: THREE.Group;
  dirtNodes: THREE.Group[];
  dirtAlpha: Float32Array;
  carryLogs: THREE.Group;
  carryLogNodes: THREE.Group[];
  animTime: number;
  puffTimer: number;
  forward: THREE.Vector3;
}

/**
 * Build ONE upright worker rig and register it with `renderer`.
 * Local frame: +Y is up (feet at y = 0), +Z is forward (face / travel direction).
 * The rig is a detached hierarchy of Groups (no meshes, never added to the scene): `group`'s transform
 * is expressed in the renderer's parent space, and each frame the renderer copies every part's
 * world matrix into the shared InstancedMesh pools. The caller positions it with placeWorkerModel().
 */
export function createWorkerModel(role: string, renderer: WorkerRenderer): WorkerModel {
  const bindings: PartBinding[] = [];
  const bind = (
    kind: PoolKind,
    node: THREE.Object3D,
    index = 0,
    gate: THREE.Object3D | null = null,
    alpha: Float32Array | null = null,
  ): void => {
    bindings.push({ pool: renderer.pool(kind, role), node, gate, index, alpha });
  };

  const group = new THREE.Group();
  group.name = `worker-${role}`;

  const root = new THREE.Group();
  group.add(root);
  bind('body', root);

  function makeLimb(x: number, y: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    return pivot;
  }
  const legL = makeLimb(-M.legSpacing, M.hipY);
  const legR = makeLimb(M.legSpacing, M.hipY);
  root.add(legL, legR);
  bind('leg', legL, 0);
  bind('leg', legR, 1);

  const armL = makeLimb(-M.shoulderX, M.shoulderY);
  const armR = makeLimb(M.shoulderX, M.shoulderY);
  root.add(armL, armR);
  bind('arm', armL, 0);
  bind('arm', armR, 1);

  const shovel = new THREE.Group();
  shovel.position.y = -M.armLength;
  armR.add(shovel);
  if (role !== 'carrier') bind('tool', shovel);

  const carryLogs = new THREE.Group();
  carryLogs.position.y = M.carryLogY;
  carryLogs.visible = false;
  const carryLogNodes: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Group();
    log.position.set(0, i * M.carryLogRadius * 1.4, (i - 1) * M.carryLogSpacingZ * 0.6);
    log.visible = false;
    carryLogs.add(log);
    carryLogNodes.push(log);
    if (role === 'carrier') bind(i % 2 === 0 ? 'logA' : 'logB', log, i === 2 ? 1 : 0, carryLogs);
  }
  root.add(carryLogs);

  const head = new THREE.Group();
  head.position.y = M.headY;
  root.add(head);
  bind('head', head);

  const shadow = new THREE.Group();
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  group.add(shadow);
  bind('shadow', shadow);

  const dirt = new THREE.Group();
  dirt.visible = false;
  const dirtNodes: THREE.Group[] = [];
  const dirtAlpha = new Float32Array(A.dirtCount);
  for (let i = 0; i < A.dirtCount; i++) {
    const p = new THREE.Group();
    p.visible = false;
    dirt.add(p);
    dirtNodes.push(p);
    bind('dirt', p, i, dirt, dirtAlpha);
  }
  group.add(dirt);

  const bubble = new THREE.Group();
  bubble.scale.set(WORKER_POOL.bubbleSize, WORKER_POOL.bubbleSize, 1);
  bubble.position.y = M.totalHeight + WORKER_POOL.bubbleSize;
  bubble.visible = false;
  group.add(bubble);
  if (role === 'planter') bind('bubble', bubble);

  const model: WorkerModel = {
    group,
    bindings,
    role,
    renderer,
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
    dirtNodes,
    dirtAlpha,
    carryLogs,
    carryLogNodes,
    animTime: Math.random() * 10,
    puffTimer: 0,
    forward: new THREE.Vector3(0, 0, 1),
  };
  renderer.add(model);
  return model;
}
