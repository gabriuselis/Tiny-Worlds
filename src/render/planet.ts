import * as THREE from 'three';
import {
  WORLD_CONFIG,
  TREE_TRUNK_HEIGHT,
  TREE_TRUNK_RADIUS_TOP,
  TREE_TRUNK_RADIUS_BOTTOM,
  TREE_TRUNK_COLOR,
  TREE_ROOT_FLARE_RADIUS,
  TREE_ROOT_FLARE_HEIGHT,
  TREE_ROOT_MOUND_RADIUS,
  TREE_ROOT_MOUND_COLOR,
  TREE_ROOT_MOUND_LIFT,
  TREE_CROWN_RADIUS,
  TREE_CROWN_CENTER_Y,
  TREE_CROWN_SQUASH_Y,
  TREE_SHADOW_RADIUS,
  TREE_SHADOW_LIFT,
  LOG_RADIUS,
  LOG_LENGTH,
  LOG_BODY_COLOR,
  LOG_END_COLOR,
} from '../core/config/world';
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

// Crown colors: bright leafy greens (4 variants, one per crown InstancedMesh)
export const CROWN_COLORS = [0x3fae49, 0x4cbf56, 0x36a042, 0x58c961];
export const CROWN_COLOR_COUNT = CROWN_COLORS.length;

const SHADOW_COLOR = 0x1b5e20;

// Tree geometry helpers
export function createTreeTrunkGeometry(): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(TREE_TRUNK_RADIUS_TOP, TREE_TRUNK_RADIUS_BOTTOM, TREE_TRUNK_HEIGHT, 8);
  // Base at y = 0, top at y = TREE_TRUNK_HEIGHT
  geo.translate(0, TREE_TRUNK_HEIGHT / 2, 0);
  return geo;
}

export function createRootFlareGeometry(): THREE.ConeGeometry {
  const geo = new THREE.ConeGeometry(TREE_ROOT_FLARE_RADIUS, TREE_ROOT_FLARE_HEIGHT, 8);
  geo.translate(0, TREE_ROOT_FLARE_HEIGHT / 2, 0);
  return geo;
}

export function createRootMoundGeometry(): THREE.CircleGeometry {
  const geo = new THREE.CircleGeometry(TREE_ROOT_MOUND_RADIUS, 16);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, TREE_ROOT_MOUND_LIFT, 0);
  return geo;
}

export function createTreeCrownGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(TREE_CROWN_RADIUS, 2);
  geo.scale(1, TREE_CROWN_SQUASH_Y, 1);
  geo.translate(0, TREE_CROWN_CENTER_Y, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Merge parts into ONE non-indexed geometry with per-vertex colors.
 * `toNonIndexed()` is essential: the trunk cylinder is indexed, and dropping
 * the index without expanding it was why the trunk rendered as garbage/invisible.
 */
function mergeColored(parts: { geo: THREE.BufferGeometry; color: number }[]): THREE.BufferGeometry {
  const expanded = parts.map((part) => {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    if (g !== part.geo) part.geo.dispose();
    return { g, color: new THREE.Color(part.color) };
  });
  let total = 0;
  for (const { g } of expanded) total += g.attributes.position.count;

  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  let offset = 0;
  for (const { g, color } of expanded) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    positions.set(pos.array as Float32Array, offset * 3);
    for (let i = 0; i < pos.count; i++) {
      colors[(offset + i) * 3] = color.r;
      colors[(offset + i) * 3 + 1] = color.g;
      colors[(offset + i) * 3 + 2] = color.b;
    }
    offset += pos.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// Merged trunk + root flare + root mound + crown geometry for one tree variant.
export function createTreeVariantGeometry(crownColor: number): THREE.BufferGeometry {
  return mergeColored([
    { geo: createTreeTrunkGeometry(), color: TREE_TRUNK_COLOR },
    { geo: createRootFlareGeometry(), color: TREE_TRUNK_COLOR },
    { geo: createRootMoundGeometry(), color: TREE_ROOT_MOUND_COLOR },
    { geo: createTreeCrownGeometry(), color: crownColor },
  ]);
}

export function createContactShadowGeometry(): THREE.CircleGeometry {
  const geo = new THREE.CircleGeometry(TREE_SHADOW_RADIUS, 16);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, TREE_SHADOW_LIFT, 0);
  return geo;
}

export function treeMaterials(): {
  trunk: THREE.MeshStandardMaterial;
  crown: THREE.MeshStandardMaterial[];
  shadow: THREE.MeshBasicMaterial;
} {
  return {
    trunk: new THREE.MeshStandardMaterial({ color: TREE_TRUNK_COLOR, roughness: 1, metalness: 0, emissive: 0x000000 }),
    crown: CROWN_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0, emissive: 0x000000 })),
    shadow: new THREE.MeshBasicMaterial({ color: SHADOW_COLOR, transparent: true, opacity: 0.25, depthWrite: false }),
  };
}

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

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `planet-${_pid}`;
  mesh.renderOrder = 0;
  return mesh;
}

export function setPlanetTheme(_mesh: THREE.Mesh, _pid: PlanetId): void {}

// One log lying along local X: brown cylinder body + lighter tan end caps.
// A single merged geometry is instanced 3x per plot for the pile pyramid.
export function createLogGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, 8);
  body.rotateZ(Math.PI / 2);

  const half = LOG_LENGTH / 2;
  const capA = new THREE.CircleGeometry(LOG_RADIUS, 12);
  capA.rotateY(Math.PI / 2);
  capA.translate(half, 0, 0);
  const capB = new THREE.CircleGeometry(LOG_RADIUS, 12);
  capB.rotateY(-Math.PI / 2);
  capB.translate(-half, 0, 0);

  return mergeColored([
    { geo: body, color: LOG_BODY_COLOR },
    { geo: capA, color: LOG_END_COLOR },
    { geo: capB, color: LOG_END_COLOR },
  ]);
}
