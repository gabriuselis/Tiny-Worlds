import * as THREE from 'three';
import { WORLD_CONFIG } from '../core/config/world';
import type { PlanetId } from '../core/state';

const planetRadius = WORLD_CONFIG.planetRadius;

function sstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mixColor(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number): { r: number; g: number; b: number } {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export const CROWN_COLORS = [0x2e9a3c, 0x37a846, 0x278a36, 0x43b052];

const TRUNK_COLOR = 0x7a5230;
const SHADOW_COLOR = 0x1b3a1b;

export function createPlanetMesh(_pid: PlanetId, radius: number): THREE.Mesh {
  const r = radius === undefined ? planetRadius : radius;
  const geo = new THREE.IcosahedronGeometry(r, 64);
  geo.computeVertexNormals();

  const position = geo.attributes.position as THREE.BufferAttribute;
  const vertexCount = position.count;
  const colors = new Float32Array(vertexCount * 3);

  const base = new THREE.Color('#4caf50');
  const light = new THREE.Color('#5cbd5f');
  const deep = new THREE.Color('#43a047');

  for (let i = 0; i < vertexCount; i++) {
    const ny = position.getY(i) / r;

    // Smooth gradient from deeper green at the bottom to lighter at the top
    const t = (ny + 1) / 2;
    let col = { r: base.r, g: base.g, b: base.b };
    col = mixColor(col, { r: light.r, g: light.g, b: light.b }, t * 0.35);

    // Subtle deeper tone toward the lower hemisphere (soft, no hard edges)
    const tShadow = sstep(-0.35, 0.05, ny);
    col = mixColor(col, { r: deep.r, g: deep.g, b: deep.b }, tShadow * 0.4);

    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  // Diagnostic: print first 5 vertex colors
  console.log('Planet vertex colors (first 5):');
  for (let i = 0; i < Math.min(5, vertexCount); i++) {
    console.log(`  v${i}: rgb(${colors[i*3].toFixed(3)}, ${colors[i*3+1].toFixed(3)}, ${colors[i*3+2].toFixed(3)})`);
  }
  console.log('Planet base color:', base.getHexString(), 'light:', light.getHexString(), 'deep:', deep.getHexString());

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: false,
  });
  console.log('Planet material color:', mat.color.getHexString(), 'roughness:', mat.roughness, 'metalness:', mat.metalness);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `planet-${_pid}`;
  mesh.renderOrder = 0;
  return mesh;
}

// Tree trunk: tapered 6-sided cylinder (wider at base)
export function createTreeTrunkGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(WORLD_CONFIG.treeTrunkRadius, WORLD_CONFIG.treeTrunkRadius * 1.2, WORLD_CONFIG.treeHeight * 0.5, 6);
}

// Crown: two stacked low-poly cones, centered on local origin
export function createTreeCrownGeometry(): THREE.BufferGeometry {
  const crownRadius = WORLD_CONFIG.treeCrownRadius;
  const crownHeight = WORLD_CONFIG.treeHeight * 0.55;
  const half = crownHeight * 0.5;
  const midRadius = crownRadius * 0.5;

  const bottom = new THREE.CylinderGeometry(midRadius, crownRadius, half, 6);
  bottom.translate(0, -half / 2, 0);

  const top = new THREE.ConeGeometry(midRadius, half, 6);
  top.translate(0, half / 2, 0);

  const bottomPos = (bottom.attributes.position as THREE.BufferAttribute).array as Float32Array;
  const bottomNor = (bottom.attributes.normal as THREE.BufferAttribute).array as Float32Array;
  const topPos = (top.attributes.position as THREE.BufferAttribute).array as Float32Array;
  const topNor = (top.attributes.normal as THREE.BufferAttribute).array as Float32Array;

  const total = bottomPos.length / 3 + topPos.length / 3;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  positions.set(bottomPos, 0);
  normals.set(bottomNor, 0);
  positions.set(topPos, bottomPos.length / 3);
  normals.set(topNor, bottomNor.length / 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createLogPileGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(0.018, 0.018, 0.045, 6);
}

export function createContactShadowGeometry(): THREE.CircleGeometry {
  return new THREE.CircleGeometry(WORLD_CONFIG.treeCrownRadius * 1.15, 16);
}

export function treeMaterials(): {
  trunk: THREE.MeshStandardMaterial;
  crown: THREE.MeshStandardMaterial;
  log: THREE.MeshStandardMaterial;
  shadow: THREE.MeshStandardMaterial;
} {
  return {
    trunk: new THREE.MeshStandardMaterial({ color: TRUNK_COLOR, flatShading: false, roughness: 0.9, metalness: 0 }),
    crown: new THREE.MeshStandardMaterial({ color: CROWN_COLORS[0], flatShading: true, roughness: 0.9, metalness: 0 }),
    log: new THREE.MeshStandardMaterial({ color: 0x5d4037, flatShading: false, roughness: 0.9, metalness: 0 }),
    shadow: new THREE.MeshStandardMaterial({ color: SHADOW_COLOR, transparent: true, opacity: 0.25, depthWrite: false, flatShading: false }),
  };
}

export function setPlanetTheme(_mesh: THREE.Mesh, _pid: PlanetId): void {}

function fibonacciSphere(count: number): { x: number; y: number; z: number }[] {
  const dirs: { x: number; y: number; z: number }[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / count) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    dirs.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return dirs;
}

function angularDistDir(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

export function createGrassTufts(
  radius: number,
  slotDirs: { x: number; y: number; z: number }[],
  treeSlotIndices: Set<number>,
  maxCount?: number,
): THREE.InstancedMesh {
  const count = maxCount ?? WORLD_CONFIG.grassTuftCount;
  const bladeGeo = new THREE.ConeGeometry(0.004, 0.04, 6);
  bladeGeo.rotateX(Math.PI / 2);
  bladeGeo.translate(0, 0.015, 0);

  const inst = new THREE.InstancedMesh(bladeGeo, new THREE.MeshStandardMaterial({
    color: 0x3e9a45,
    roughness: 1,
    metalness: 0,
    flatShading: false,
  }), count * 3);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const candidates = fibonacciSphere(count * 3);
  const minAngDist = 0.05 / radius;

  let placed = 0;

  for (let ci = 0; ci < candidates.length && placed < count; ci++) {
    const dir = candidates[ci];

    if (Math.abs(dir.y) > 0.92) continue;

    let tooClose = false;
    for (const ti of treeSlotIndices) {
      if (angularDistDir(dir, slotDirs[ti]) < minAngDist) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const lean = 0.15 * (Math.random() - 0.5);
    const scale = 0.8 + Math.random() * 0.4;
    const jitter = 0.008 * (Math.random() - 0.5);
    const pos = {
      x: dir.x * (radius + 0.005 + jitter),
      y: dir.y * (radius + 0.005 + jitter),
      z: dir.z * (radius + 0.005 + jitter),
    };
    const yaw = Math.random() * Math.PI * 2;
    dummy.position.set(pos.x, pos.y, pos.z);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir.x, dir.y, dir.z));
    dummy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dir.x, dir.y, dir.z), yaw));
    dummy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean));
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    inst.setMatrixAt(placed * 3, dummy.matrix);

    for (let c = 1; c < 3; c++) {
      const idx = placed * 3 + c;
      dummy.position.set(pos.x, pos.y, pos.z);
      const yaw2 = yaw + (c * 2.094);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir.x, dir.y, dir.z));
      dummy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dir.x, dir.y, dir.z), yaw2));
      dummy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean * 0.7));
      dummy.scale.set(scale * (0.9 + c * 0.05), scale * (0.9 + c * 0.05), scale * (0.9 + c * 0.05));
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);
      if (c % 2 === 0) color.set(0x3e9a45);
      else color.set(0x66c46a);
      inst.setColorAt(idx, color);
    }

    color.set(0x3e9a45);
    inst.setColorAt(placed * 3, color);

    placed++;
  }

  inst.count = placed * 3;
  inst.instanceMatrix.needsUpdate = true;
  inst.instanceColor!.needsUpdate = true;
  inst.name = 'grass';
  inst.renderOrder = 2;
  return inst;
}

export function createFlowers(
  radius: number,
  slotDirs: { x: number; y: number; z: number }[],
  treeSlotIndices: Set<number>,
): THREE.InstancedMesh {
  const count = WORLD_CONFIG.flowerCount;
  const flowerGeo = new THREE.SphereGeometry(0.008, 6, 6);
  const inst = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    flatShading: false,
  }), count);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const candidates = fibonacciSphere(count * 4);
  const minAngDist = 0.05 / radius;

  let placed = 0;

  for (let ci = 0; ci < candidates.length && placed < count; ci++) {
    const dir = candidates[ci];

    if (Math.abs(dir.y) > 0.85) continue;

    let tooClose = false;
    for (const ti of treeSlotIndices) {
      if (angularDistDir(dir, slotDirs[ti]) < minAngDist) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const pos = {
      x: dir.x * (radius + 0.01),
      y: dir.y * (radius + 0.01),
      z: dir.z * (radius + 0.01),
    };
    const yaw = Math.random() * Math.PI * 2;
    dummy.position.set(pos.x, pos.y, pos.z);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir.x, dir.y, dir.z));
    dummy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(dir.x, dir.y, dir.z), yaw));
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    inst.setMatrixAt(placed, dummy.matrix);

    color.set(Math.random() > 0.5 ? 0xffffff : 0xffeb3b);
    inst.setColorAt(placed, color);

    placed++;
  }

  inst.count = placed;
  inst.instanceMatrix.needsUpdate = true;
  inst.instanceColor!.needsUpdate = true;
  inst.name = 'flowers';
  inst.renderOrder = 2;
  return inst;
}
