import * as THREE from 'three';
import { WORLD_CONFIG, TREE_TRUNK_HEIGHT, TREE_TRUNK_RADIUS_TOP, TREE_TRUNK_RADIUS_BOTTOM, TREE_TRUNK_COLOR, TREE_CROWN_RADIUS, TREE_CROWN_CENTER_Y, TREE_CROWN_SQUASH_Y, TREE_SHADOW_RADIUS, TREE_SHADOW_LIFT } from '../core/config/world';
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

export function createTreeCrownGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(TREE_CROWN_RADIUS, 2);
  geo.scale(1, TREE_CROWN_SQUASH_Y, 1);
  geo.translate(0, TREE_CROWN_CENTER_Y, 0);
  geo.computeVertexNormals();
  return geo;
}

export function createContactShadowGeometry(): THREE.CircleGeometry {
  const geo = new THREE.CircleGeometry(TREE_SHADOW_RADIUS, 16);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, TREE_SHADOW_LIFT, 0);
  return geo;
}

// Merged trunk + crown geometry for one tree variant. Trunk vertices are brown,
// crown vertices carry the variant color; one InstancedMesh per variant.
export function createTreeVariantGeometry(crownColor: number): THREE.BufferGeometry {
  const trunkGeo = createTreeTrunkGeometry();
  const crownGeo = createTreeCrownGeometry();
  const trunkPos = trunkGeo.attributes.position as THREE.BufferAttribute;
  const crownPos = crownGeo.attributes.position as THREE.BufferAttribute;
  const tc = trunkPos.count;
  const cc = crownPos.count;
  const positions = new Float32Array((tc + cc) * 3);
  const colors = new Float32Array((tc + cc) * 3);
  const trunkCol = new THREE.Color(TREE_TRUNK_COLOR);
  const crownCol = new THREE.Color(crownColor);
  for (let i = 0; i < tc; i++) {
    positions[i * 3] = trunkPos.getX(i);
    positions[i * 3 + 1] = trunkPos.getY(i);
    positions[i * 3 + 2] = trunkPos.getZ(i);
    colors[i * 3] = trunkCol.r;
    colors[i * 3 + 1] = trunkCol.g;
    colors[i * 3 + 2] = trunkCol.b;
  }
  const base = tc * 3;
  for (let i = 0; i < cc; i++) {
    positions[base + i * 3] = crownPos.getX(i);
    positions[base + i * 3 + 1] = crownPos.getY(i);
    positions[base + i * 3 + 2] = crownPos.getZ(i);
    colors[base + i * 3] = crownCol.r;
    colors[base + i * 3 + 1] = crownCol.g;
    colors[base + i * 3 + 2] = crownCol.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function treeMaterials(): {
  trunk: THREE.MeshStandardMaterial;
  crown: THREE.MeshStandardMaterial[];
  shadow: THREE.MeshBasicMaterial;
} {
  return {
    trunk: new THREE.MeshStandardMaterial({ color: TREE_TRUNK_COLOR, roughness: 0.95, metalness: 0 }),
    crown: CROWN_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0 })),
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

// Log pile: small cylinder (only for chopped-tree stumps)
export function createLogPileGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(0.018, 0.018, 0.045, 6);
}
