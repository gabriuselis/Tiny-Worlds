import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORKER_MODEL as M, WORKER_ANIM as A, WORKER_COLORS, shirtColorFor } from '../core/config/worker';
import { makeBubbleMaterial, makeBubbleTexture, makeDirtMaterial } from './workerMaterials';

export interface RoleGeometries {
  body: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  tool: THREE.BufferGeometry | null;
  head: THREE.BufferGeometry;
}

export interface SharedResources {
  material: THREE.MeshStandardMaterial;
  leg: THREE.BufferGeometry;
  shadowGeometry: THREE.CircleGeometry;
  shadowMaterial: THREE.MeshBasicMaterial;
  dirtGeometry: THREE.SphereGeometry;
  dirtMaterial: THREE.MeshStandardMaterial;
  carryLogGeometries: [THREE.BufferGeometry, THREE.BufferGeometry];
  bubbleGeometry: THREE.PlaneGeometry;
  bubbleMaterial: THREE.MeshBasicMaterial;
  roles: Map<string, RoleGeometries>;
}

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchScale = new THREE.Vector3();
const scratchColor = new THREE.Color();

interface PartPlacement {
  x?: number;
  y?: number;
  z?: number;
  rotX?: number;
  scale?: [number, number, number];
}

// Bakes a placement and a flat colour into the geometry so rigid parts can be merged into one draw call.
function part(
  geo: THREE.BufferGeometry,
  hex: number,
  { x = 0, y = 0, z = 0, rotX = 0, scale = [1, 1, 1] }: PartPlacement = {},
): THREE.BufferGeometry {
  scratchPos.set(x, y, z);
  scratchQuat.setFromEuler(scratchEuler.set(rotX, 0, 0));
  scratchScale.set(scale[0], scale[1], scale[2]);
  geo.applyMatrix4(scratchMatrix.compose(scratchPos, scratchQuat, scratchScale));

  scratchColor.set(hex);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = scratchColor.r;
    colors[i * 3 + 1] = scratchColor.g;
    colors[i * 3 + 2] = scratchColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function capsule(radius: number, length: number): THREE.CapsuleGeometry {
  return new THREE.CapsuleGeometry(radius, Math.max(0.001, length), 4, 10);
}

function buildLegGeometry(): THREE.BufferGeometry {
  return merge([
    part(new THREE.BoxGeometry(M.legWidth, M.legHeight, M.legWidth), WORKER_COLORS.pants, { y: -M.legHeight / 2 }),
    part(new THREE.BoxGeometry(M.legWidth * 1.1, 0.012, M.legWidth * 1.35), WORKER_COLORS.boots, {
      y: -M.legHeight + 0.006,
      z: M.legWidth * 0.25,
    }),
  ]);
}

function buildArmGeometry(shirt: number): THREE.BufferGeometry {
  return merge([
    part(capsule(M.armWidth / 2, M.armLength - M.armWidth), shirt, { y: -M.armLength / 2 }),
    part(new THREE.SphereGeometry(M.armWidth * 0.55, 8, 6), WORKER_COLORS.skin, { y: -M.armLength }),
  ]);
}

function buildBodyGeometry(role: string): THREE.BufferGeometry {
  const parts = [part(capsule(M.bodyWidth / 2, M.bodyHeight - M.bodyWidth), shirtColorFor(role), { y: M.bodyCenterY })];
  if (role === 'carrier') {
    parts.push(
      part(new THREE.BoxGeometry(M.backpackWidth, M.backpackHeight, M.backpackDepth), WORKER_COLORS.backpack, {
        y: M.bodyCenterY - 0.006,
        z: M.backpackZ,
      }),
    );
    for (const sign of [-1, 1]) {
      parts.push(
        part(new THREE.BoxGeometry(0.008, M.bodyHeight * 0.9, 0.008), WORKER_COLORS.backpackStrap, {
          x: sign * 0.018,
          y: M.bodyCenterY,
          z: M.backpackZ + M.backpackDepth * 0.5,
          rotX: -0.15,
        }),
      );
    }
  }
  return merge(parts);
}

// Expressed in the `shovel` group's frame (origin at the right hand).
function buildToolGeometry(role: string): THREE.BufferGeometry | null {
  if (role === 'carrier') return null;
  if (role === 'lumberjack') {
    return merge([
      part(
        new THREE.CylinderGeometry(M.axeHandleWidth / 2, M.axeHandleWidth / 2, M.axeHandleLength, 6),
        WORKER_COLORS.shovelStick,
        { y: -M.axeHandleLength * 0.35 },
      ),
      part(new THREE.BoxGeometry(M.axeHeadWidth, M.axeHeadHeight, M.axeHeadDepth), WORKER_COLORS.axeHead, {
        y: -M.axeHandleLength * 0.78,
        z: 0.004,
      }),
    ]);
  }
  return merge([
    part(
      new THREE.CylinderGeometry(M.shovelStickWidth / 2, M.shovelStickWidth / 2, M.shovelStickLength, 6),
      WORKER_COLORS.shovelStick,
      { y: -M.shovelStickLength * 0.35 },
    ),
    part(new THREE.BoxGeometry(M.shovelBladeWidth, M.shovelBladeHeight, M.shovelBladeDepth), WORKER_COLORS.shovelBlade, {
      y: -M.shovelStickLength * 0.75,
    }),
  ]);
}

function buildHeadGeometry(role: string): THREE.BufferGeometry {
  const lumberjack = role === 'lumberjack';
  const carrier = role === 'carrier';
  const cap = lumberjack ? WORKER_COLORS.lumberjackHat : carrier ? WORKER_COLORS.carrierHat : WORKER_COLORS.cap;
  const brim = lumberjack
    ? WORKER_COLORS.lumberjackHatBrim
    : carrier
      ? WORKER_COLORS.carrierHatBrim
      : WORKER_COLORS.capBrim;
  const parts = [
    part(new THREE.SphereGeometry(M.headRadius, 12, 10), WORKER_COLORS.skin),
    part(new THREE.SphereGeometry(M.capRadius, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap),
    part(new THREE.BoxGeometry(M.brimWidth, M.brimHeight, M.brimDepth), brim, {
      y: M.headRadius - 0.004,
      z: M.brimZ,
      scale: lumberjack ? [1.45, 1, 1.15] : [1, 1, 1],
    }),
  ];
  for (const sign of [-1, 1]) {
    parts.push(
      part(new THREE.SphereGeometry(M.eyeRadius, 6, 6), WORKER_COLORS.eyes, {
        x: sign * M.eyeOffsetX,
        y: M.eyeOffsetY,
        z: M.eyeOffsetZ,
      }),
    );
  }
  return merge(parts);
}

function buildCarryLogGeometry(hex: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(M.carryLogRadius, M.carryLogRadius, M.carryLogLength, 6);
  geo.rotateZ(Math.PI / 2);
  return part(geo, hex);
}

let shared: SharedResources | null = null;

export function getSharedResources(): SharedResources {
  if (shared) return shared;
  shared = {
    material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
    leg: buildLegGeometry(),
    shadowGeometry: new THREE.CircleGeometry(M.shadowRadius, 20),
    shadowMaterial: new THREE.MeshBasicMaterial({
      color: WORKER_COLORS.shadow,
      transparent: true,
      opacity: M.shadowOpacity,
      depthWrite: false,
    }),
    dirtGeometry: new THREE.SphereGeometry(A.dirtRadius, 6, 6),
    dirtMaterial: makeDirtMaterial(),
    carryLogGeometries: [buildCarryLogGeometry(WORKER_COLORS.carryLog), buildCarryLogGeometry(WORKER_COLORS.carryLogEnd)],
    bubbleGeometry: new THREE.PlaneGeometry(1, 1),
    bubbleMaterial: makeBubbleMaterial(makeBubbleTexture()),
    roles: new Map(),
  };
  return shared;
}

export function getRoleGeometries(role: string): RoleGeometries {
  const res = getSharedResources();
  let geos = res.roles.get(role);
  if (!geos) {
    geos = {
      body: buildBodyGeometry(role),
      arm: buildArmGeometry(shirtColorFor(role)),
      tool: buildToolGeometry(role),
      head: buildHeadGeometry(role),
    };
    res.roles.set(role, geos);
  }
  return geos;
}

/** Frees every cached worker geometry, material and texture. Only call when no worker model is alive. */
export function disposeSharedWorkerResources(): void {
  if (!shared) return;
  const res = shared;
  shared = null;
  res.material.dispose();
  res.leg.dispose();
  res.shadowGeometry.dispose();
  res.shadowMaterial.dispose();
  res.dirtGeometry.dispose();
  res.dirtMaterial.dispose();
  res.bubbleGeometry.dispose();
  for (const g of res.carryLogGeometries) g.dispose();
  res.bubbleMaterial.map?.dispose();
  res.bubbleMaterial.dispose();
  for (const geos of res.roles.values()) {
    geos.body.dispose();
    geos.arm.dispose();
    geos.tool?.dispose();
    geos.head.dispose();
  }
}
