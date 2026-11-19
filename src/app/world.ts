import * as THREE from 'three';
import { PLOT_COUNT } from '../core/config/world';
import { buildGrid } from '../core/grid';
import { createScene } from '../render/scene';
import { createPlanetMesh } from '../render/planet';
import { ParticleSystem } from '../render/particles';
import { FloatingTextPool } from '../render/floaters';
import { logEvent } from '../ui/ui';
import { ctx } from './context';
import { planetRadius } from './constants';
import { showError } from './errors';

// ===== 3D scene and render loop (start before UI) =====
export function initScene(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) throw new Error('canvas #game-canvas not found');
  ctx.canvas = canvas;
  try {
    ctx.sceneAPI = createScene(canvas);
  } catch (err) { showError('createScene failed', err); }
}

// ===== Plot grid (pure core data) =====
export function initGrid(): void {
  try {
    ctx.grid = buildGrid();
    console.log(`Plot grid: ${ctx.grid.plots.length} plots (target ${PLOT_COUNT}), unlocked=${ctx.grid.unlockedOrder.length}`);
  } catch (err) { showError('buildGrid failed', err); }
}

// ===== Planet group, planet mesh, outline =====
export function initPlanet(): void {
  const sceneAPI = ctx.sceneAPI;
  const planetGroup = new THREE.Group();
  ctx.planetGroup = planetGroup;
  try {
    sceneAPI?.scene.add(planetGroup);
  } catch (err) { showError('planet group scene add failed', err); }

  // Planet-local pooled debris + floating "+1" labels.
  try {
    if (sceneAPI) {
      ctx.particles = new ParticleSystem(planetGroup);
      ctx.floaters = new FloatingTextPool(sceneAPI.camera, planetGroup);
    }
  } catch (err) { showError('particle system init failed', err); }

  let planetMesh: THREE.Mesh;
  try {
    planetMesh = createPlanetMesh('verdant', planetRadius);
  } catch (err) {
    showError(`planet build failed: ${err instanceof Error ? err.message : err}`);
    planetMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(planetRadius, 64),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#4caf50'), roughness: 0.9, metalness: 0, flatShading: false }),
    );
  }
  ctx.planetMesh = planetMesh;
  if (planetGroup) planetGroup.add(planetMesh);
  if (sceneAPI?.scene) sceneAPI.scene.add(planetGroup);

  // Measure the real surface radius from the planet mesh vertices so tree bases sit in the ground.
  try {
    const pos = (planetMesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
    let min = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const d = Math.sqrt(x * x + y * y + z * z);
      if (d < min) min = d;
    }
    if (isFinite(min) && min > 0) ctx.surfaceRadius = min;
    logEvent(`Planet surface radius measured: ${ctx.surfaceRadius.toFixed(4)} (config ${planetRadius})`);
  } catch (err) { showError('surface radius measure failed', err); }

  // ===== Back-face outline sphere (never draws over front face) =====
  try {
    const outlineSphereGeo = new THREE.SphereGeometry(planetRadius * 1.02, 64, 32);
    const outlineSphereMat = new THREE.MeshBasicMaterial({ color: 0x1f3a8a, side: THREE.BackSide, depthWrite: false });
    const outlineSphere = new THREE.Mesh(outlineSphereGeo, outlineSphereMat);
    outlineSphere.name = 'outline-sphere';
    outlineSphere.renderOrder = -1;
    planetGroup?.add(outlineSphere);
  } catch (err) { showError('outline sphere failed', err); }
}

// ===== Trade post + UFO =====
let ufo: THREE.Group | null = null;
let ufoTime = 0;

export function initTradePost(): void {
  const planetGroup = ctx.planetGroup;
  try {
    const tradePost = new THREE.Group();
    tradePost.name = 'trade-post';
    const postGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9, metalness: 0 });
    const postBody = new THREE.Mesh(postGeo, postMat);
    postBody.position.y = 0.07;
    tradePost.add(postBody);
    const roofGeo = new THREE.ConeGeometry(0.11, 0.09, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9, metalness: 0 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 0.14 + 0.045;
    roof.rotation.y = Math.PI / 4;
    tradePost.add(roof);
    const tradePostDir: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };
    tradePost.position.set(tradePostDir.x * (planetRadius + 0.02), tradePostDir.y * (planetRadius + 0.02), tradePostDir.z * (planetRadius + 0.02));
    tradePost.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(tradePostDir.x, tradePostDir.y, tradePostDir.z));
    tradePost.renderOrder = 3;
    planetGroup?.add(tradePost);

    ufo = new THREE.Group();
    ufo.name = 'ufo';
    const ufoDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.015, 16),
      new THREE.MeshStandardMaterial({ color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.8 })
    );
    ufoDisc.rotation.x = Math.PI / 2;
    ufo.add(ufoDisc);
    const ufoCabin = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeeeeee, emissiveIntensity: 0.3, roughness: 0.1, metalness: 0 })
    );
    ufoCabin.position.y = 0.012;
    ufo.add(ufoCabin);
    ufo.position.set(tradePostDir.x * (planetRadius + 0.18), tradePostDir.y * (planetRadius + 0.18), tradePostDir.z * (planetRadius + 0.18));
    ufo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(tradePostDir.x, tradePostDir.y, tradePostDir.z));
    ufo.renderOrder = 3;
    planetGroup?.add(ufo);
  } catch (err) { showError('trade post/UFO failed', err); }
}

export function updateUfo(dt: number): void {
  ufoTime += dt;
  if (ufo) ufo.position.y += Math.sin(ufoTime * 3) * 0.002;
}
