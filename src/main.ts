import * as THREE from 'three';
import Decimal from 'break_infinity.js';
import { initialState } from './core/state';
import { tick } from './core/sim';
import { load, save, clearSave } from './core/save';
import { costOf } from './core/config/workers';
import { upgradeCost } from './core/config/upgrades';
import { WORLD_CONFIG } from './core/config/world';
import { buildGrid, plotWorldPos } from './core/grid';
import type { GameState, Role, UpgradeId, Worker } from './core/state';

import { createScene, SceneAPI } from './render/scene';
import { createPlanetMesh, createTreeTrunkGeometry, createTreeCrownGeometry, createLogPileGeometry, createContactShadowGeometry, createGrassTufts, createFlowers, treeMaterials, CROWN_COLORS } from './render/planet';
import { EffectManager } from './render/effects';
import { setupGestures } from './render/gestures';
import { getPlanetArea } from './render/viewport';
import { UI, applyUrlParams, openDevDialog as openDevMenu, updateDevStats, logEvent, startMutationObserver, startDiagnosticEvents, uiFrozen, showToast } from './ui/ui';
import './ui/style.css';

const TICK_RATE = 10;
const DT = 1 / TICK_RATE;
const planetRadius = WORLD_CONFIG.planetRadius;

// ===== On-screen error box =====
const errorBox = document.createElement('div');
errorBox.id = 'error-box';
errorBox.style.cssText = `position:fixed;top:8px;left:8px;right:8px;z-index:99999;pointer-events:none;font-family:monospace;font-size:11px;color:#ff4d4d;background:rgba(0,0,0,0.85);padding:8px 10px;border-radius:6px;border:2px solid #ff4d4d;line-height:1.4;max-width:96vw;white-space:pre-wrap;word-break:break-all;display:none;`;
document.body.appendChild(errorBox);

function showError(msg: string, err?: unknown): void {
  let stack = '';
  if (err instanceof Error) {
    stack = err.stack ? err.stack.split('\n').slice(0, 3).join('\n') : '';
  }
  errorBox.textContent = `ERROR: ${msg}${stack ? '\n' + stack : ''}`;
  errorBox.style.borderColor = '#ff0000';
  errorBox.style.color = '#ff0000';
  errorBox.style.display = 'block';
  console.error('ERROR', msg, err);
}

window.addEventListener('error', (e) => {
  showError(`window.error: ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  showError(`unhandledrejection: ${String(e.reason)}`, e.reason);
});

// Signal to the inline boot script that main.ts has started
(window as any).__mainStarted?.();

// ===== 3D scene and render loop (start before UI) =====
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) throw new Error('canvas #game-canvas not found');
let sceneAPI: SceneAPI | undefined = undefined;
try {
  sceneAPI = createScene(canvas);
} catch (err) { showError('createScene failed', err); }
const effectMgr = sceneAPI ? new EffectManager(sceneAPI.scene) : null;

// ===== Default camera distance (try/catch: broken config must not stop the planet) =====
let defaultDist = 10;
let minDist = 2;
let maxDist = 18;
try {
  const fov = 45 * (Math.PI / 180);
  const screenPadding = 0.85;
  defaultDist = (planetRadius * 2) / (2 * Math.tan(fov / 2) * screenPadding);
  minDist = planetRadius + WORLD_CONFIG.zoomMinAboveSurface;
  maxDist = defaultDist * WORLD_CONFIG.zoomMaxMultiplier;
} catch (err) { showError('camera distance config failed', err); }

// ===== Diagnostic initialization =====
try {
  startMutationObserver();
  startDiagnosticEvents();
  logEvent('main.ts initialized');
  logEvent(`Default camera distance: ${defaultDist.toFixed(2)}, minDist: ${minDist.toFixed(2)}, maxDist: ${maxDist.toFixed(2)}`);
} catch (err) { showError('diagnostic init failed', err); }

// ===== Viewport / camera state =====
let planetArea: { cx: number; cy: number; size: number } | null = null;

function updateViewport(): void {
  const area = getPlanetArea();
  if (!area) return;
  planetArea = { cx: area.cx, cy: area.cy, size: area.size };
  applyCamera();
}

function applyCamera(): void {
  if (!sceneAPI) return;
  const camera = sceneAPI.camera as THREE.PerspectiveCamera;
  const fullWidth = canvas.clientWidth;
  const fullHeight = canvas.clientHeight;
  camera.aspect = fullWidth / fullHeight;
  if (planetArea) {
    const offsetX = fullWidth / 2 - planetArea.cx;
    const offsetY = fullHeight / 2 - planetArea.cy;
    camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, fullWidth, fullHeight);
  }
  camera.updateProjectionMatrix();
}

// ===== Plot grid (pure core data) =====
let grid: any;
try {
  grid = buildGrid();
  console.log(`Plot grid: ${grid.rows} rows, ${grid.plots.length} plots, ${grid.unlockedOrder.length} usable`);
} catch (err) { showError('buildGrid failed', err); }

// ===== Planet group =====
const planetGroup = new THREE.Group();
try {
  sceneAPI?.scene.add(planetGroup);
} catch (err) { showError('planet group scene add failed', err); }

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
if (planetGroup) planetGroup.add(planetMesh);
if (sceneAPI?.scene) sceneAPI.scene.add(planetGroup);

// ===== Back-face outline sphere (never draws over front face) =====
try {
  const outlineSphereGeo = new THREE.SphereGeometry(planetRadius * 1.02, 64, 32);
  const outlineSphereMat = new THREE.MeshBasicMaterial({ color: 0x1f3a8a, side: THREE.BackSide, depthWrite: false });
  const outlineSphere = new THREE.Mesh(outlineSphereGeo, outlineSphereMat);
  outlineSphere.name = 'outline-sphere';
  outlineSphere.renderOrder = -1;
  planetGroup?.add(outlineSphere);
} catch (err) { showError('outline sphere failed', err); }

// ===== Grid overlay debug (LineSegments, opacity 0.15, depthWrite false) =====
let gridOverlay: THREE.LineSegments | null = null;
let gridOverlayVisible = false;

function buildGridOverlay(): THREE.LineSegments {
  const lines: number[] = [];
  const R = planetRadius;
  const cell = 0.015; // small offset above surface
  for (const p of grid.plots) {
    const { dir } = p;
    const x = dir.x * R, y = dir.y * R, z = dir.z * R;
    // draw 4 edges per cell: N, S, E, W (avoid dupes by only drawing +col and +row)
    const [rStart, rEnd] = grid.rowIdRange[p.row];
    const nCols = rEnd - rStart;
    const rightCol = (p.col + 1) % nCols;
    const rightId = rStart + rightCol;
    if (rightId < grid.plots.length && grid.plots[rightId].row === p.row) {
      const q = grid.plots[rightId];
      lines.push(x, y + cell, z, q.dir.x * R, q.dir.y * R + cell, q.dir.z * R);
    }
    if (p.row < grid.rows - 1) {
      const [bStart, bEnd] = grid.rowIdRange[p.row + 1];
      const bCols = bEnd - bStart;
      const bCol = Math.floor((p.col / nCols) * bCols);
      const belowId = bStart + bCol;
      const q = grid.plots[belowId];
      lines.push(x, y + cell, z, q.dir.x * R, q.dir.y * R + cell, q.dir.z * R);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, depthWrite: false });
  return new THREE.LineSegments(geo, mat);
}

function toggleGridOverlay(): void {
  gridOverlayVisible = !gridOverlayVisible;
  if (gridOverlayVisible) {
    if (!gridOverlay) {
      gridOverlay = buildGridOverlay();
      gridOverlay.name = 'grid-overlay';
      gridOverlay.renderOrder = 5;
      planetGroup.add(gridOverlay);
    }
    gridOverlay.visible = true;
  } else if (gridOverlay) {
    gridOverlay.visible = false;
  }
}

// ===== Trade post + UFO =====
let tradePost: THREE.Group | null = null;
let ufo: THREE.Group | null = null;
let ufoTime = 0;
try {
  tradePost = new THREE.Group();
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

// ===== Tree InstancedMeshes: trunks, crowns, log piles, shadows =====
let trunkPool: THREE.InstancedMesh;
let crownPool: THREE.InstancedMesh;
let logPool: THREE.InstancedMesh;
let shadowPool: THREE.InstancedMesh;
let treeDummy: THREE.Object3D;
let dirtyTreeSet: Set<number>;
let swayFrame = 0;
let crownColorPerPlot: Uint8Array;
let trunkColorPerPlot: Uint8Array;
const TRUNK_VARIANTS = [0x7a5230, 0x8d5a33, 0x6b4524, 0x84502c];
let plotLean: Float32Array;
let plotYaw: Float32Array;

function setupTreePools(): void {
  const { trunk, crown, log, shadow } = treeMaterials();
  const trunkGeo = createTreeTrunkGeometry();
  const crownGeo = createTreeCrownGeometry();
  const logGeo = createLogPileGeometry();
  const shadowGeo = createContactShadowGeometry();

  const maxPlots = grid.plots.length;
  trunkPool = new THREE.InstancedMesh(trunkGeo, trunk, maxPlots);
  crownPool = new THREE.InstancedMesh(crownGeo, crown, maxPlots);
  logPool = new THREE.InstancedMesh(logGeo, log, maxPlots * 3);
  shadowPool = new THREE.InstancedMesh(shadowGeo, shadow, maxPlots);
  trunkPool.name = 'tree-trunk-pool';
  crownPool.name = 'tree-crown-pool';
  logPool.name = 'tree-log-pool';
  shadowPool.name = 'tree-shadow-pool';
  trunkPool.renderOrder = 3;
  crownPool.renderOrder = 3;
  logPool.renderOrder = 3;
  shadowPool.renderOrder = 2;
  planetGroup.add(trunkPool);
  planetGroup.add(crownPool);
  planetGroup.add(logPool);
  planetGroup.add(shadowPool);

  treeDummy = new THREE.Object3D();
  dirtyTreeSet = new Set<number>();
  swayFrame = 0;

  crownColorPerPlot = new Uint8Array(maxPlots);
  for (let i = 0; i < maxPlots; i++) {
    crownColorPerPlot[i] = Math.floor(Math.random() * CROWN_COLORS.length);
  }

  trunkColorPerPlot = new Uint8Array(maxPlots);
  for (let i = 0; i < maxPlots; i++) {
    trunkColorPerPlot[i] = Math.floor(Math.random() * TRUNK_VARIANTS.length);
  }

  plotLean = new Float32Array(maxPlots);
  plotYaw = new Float32Array(maxPlots);
  for (let i = 0; i < maxPlots; i++) {
    plotLean[i] = (Math.random() - 0.5) * 0.07;
    plotYaw[i] = Math.random() * Math.PI * 2;
  }
}

try {
  setupTreePools();
} catch (err) { showError('setupTreePools failed', err); }

// ===== Quality settings =====
type Quality = 'low' | 'medium' | 'high';
const GRASS_CAPS: Record<Quality, number> = { low: 1500, medium: 3000, high: 4500 };
let quality: Quality = 'medium';
let lowFpsFrames = 0;
const LOW_FPS_THRESHOLD = 40;
const LOW_FPS_DURATION_FRAMES = 180;

function setQuality(q: Quality): void {
  quality = q;
  const cap = GRASS_CAPS[q];
  const oldGrass = planetGroup.getObjectByName('grass');
  if (oldGrass) planetGroup.remove(oldGrass);
  const treePlotSet = new Set<number>();
  for (const p of verdant.plots) {
    if (p.state !== 'empty') treePlotSet.add(p.id);
  }
  const newGrass = createGrassTufts(planetRadius, grid.plots.map((p: any) => p.dir), treePlotSet, cap);
  newGrass.name = 'grass';
  planetGroup.add(newGrass);
  grassMesh = newGrass;
}

function checkQualityFps(fps: number): void {
  if (fps < LOW_FPS_THRESHOLD) {
    lowFpsFrames++;
    if (lowFpsFrames >= LOW_FPS_DURATION_FRAMES) {
      if (quality === 'high') { setQuality('medium'); lowFpsFrames = 0; }
      else if (quality === 'medium') { setQuality('low'); lowFpsFrames = 0; }
    }
  } else {
    lowFpsFrames = 0;
  }
}

// ===== State =====
// Handle ?reset=1 to clear old saves (for testing save compatibility)
let state: GameState;
let verdant: any;
try {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('reset') === '1') {
    clearSave();
    urlParams.delete('reset');
    window.history.replaceState({}, '', window.location.pathname);
  }
  state = load() ?? initialState();
  state.lastSaved = Date.now();
  verdant = state.planets.verdant;

  // Initialize plots (unlocked order, nearest to post first)
  const usableStart = Math.min(WORLD_CONFIG.usableStart, grid?.unlockedOrder.length ?? 0);
  for (let i = 0; i < usableStart; i++) {
    const pid = grid?.unlockedOrder[i];
    if (!pid) continue;
    const plot = grid?.plotById.get(pid);
    if (!plot) continue;
    const isHalfGrown = i < WORLD_CONFIG.startHalfGrownSaplings;
    verdant.plots.push({
      id: pid,
      row: plot.row,
      col: plot.col,
      dir: { ...plot.dir },
      state: isHalfGrown ? 'medium' : 'empty',
      timer: isHalfGrown ? WORLD_CONFIG.growTimeSmall : 0,
      reservedBy: undefined,
      woodLeft: 0,
    });
    verdant.usablePlotCount = i + 1;
  }
} catch (err) { showError('state init failed', err); }

// ===== Grass + flowers (skip plots that have trees) =====
let grassMesh: THREE.InstancedMesh | null = null;
let flowersMesh: THREE.InstancedMesh | null = null;

function rebuildGroundCover(): void {
  if (!verdant || !grid || !planetGroup) return;
  if (grassMesh) planetGroup.remove(grassMesh);
  if (flowersMesh) planetGroup.remove(flowersMesh);

  const treePlotSet = new Set<number>();
  for (const p of verdant.plots) {
    if (p.state !== 'empty') treePlotSet.add(p.id);
  }

  grassMesh = createGrassTufts(planetRadius, grid.plots.map((p: any) => p.dir), treePlotSet, WORLD_CONFIG.grassTuftCount);
  flowersMesh = createFlowers(planetRadius, grid.plots.map((p: any) => p.dir), treePlotSet);
  grassMesh.name = 'grass';
  flowersMesh.name = 'flowers';
  planetGroup.add(grassMesh);
  planetGroup.add(flowersMesh);
}

try {
  rebuildGroundCover();
} catch (err) { showError('rebuildGroundCover failed', err); }

// Initialize starting workers with sky-drop
try {
  if (verdant?.workers.length === 0) {
    verdant.workers.push({
      id: 1, role: 'planter',
      pos: { x: 0, y: planetRadius + 1, z: 0 },
      state: 'dropping', level: 0, target: undefined, carrying: undefined,
      cosmetic: { hat: 'cap', color: '#3388ff' },
      name: 'Planter 1', stuckTimer: 0, dropProgress: 0,
    });
    verdant.workers.push({
      id: 2, role: 'lumberjack',
      pos: { x: 0, y: planetRadius + 1, z: 0 },
      state: 'dropping', level: 0, target: undefined, carrying: undefined,
      cosmetic: { hat: 'cowboy', color: '#e53935' },
      name: 'Lumberjack 1', stuckTimer: 0, dropProgress: 0,
    });
  }
} catch (err) { showError('starting workers failed', err); }

let lastTime = performance.now();
let accumulator = 0;

// ===== Worker visual groups =====
interface WorkerVisual {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  hat: THREE.Mesh;
  tool: THREE.Mesh;
  bobOffset: number;
  dropStartTime: number;
}

const workerVisuals = new Map<number, WorkerVisual>();

function createWorkerVisual(w: Worker): WorkerVisual {
  const group = new THREE.Group();

  const bodyGeo = new THREE.CylinderGeometry(0.016, 0.016, WORLD_CONFIG.workerHeight * 0.6, 6);
  const bodyMat = new THREE.MeshStandardMaterial({ color: w.cosmetic.color, roughness: 0.9, metalness: 0 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = WORLD_CONFIG.workerHeight * 0.3;
  group.add(body);

  const headGeo = new THREE.SphereGeometry(0.012, 6, 6);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.9, metalness: 0 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = WORLD_CONFIG.workerHeight * 0.75;
  group.add(head);

  let hat: THREE.Mesh;
  if (w.cosmetic.hat === 'cap') {
    const hatGeo = new THREE.CylinderGeometry(0.014, 0.016, 0.006, 6);
    hat = new THREE.Mesh(hatGeo, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, metalness: 0 }));
    hat.position.y = WORLD_CONFIG.workerHeight * 0.83;
    hat.rotation.x = 0.2;
  } else {
    const hatGeo = new THREE.ConeGeometry(0.016, 0.02, 6);
    hat = new THREE.Mesh(hatGeo, new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9, metalness: 0 }));
    hat.position.y = WORLD_CONFIG.workerHeight * 0.85;
  }
  group.add(hat);

  let tool: THREE.Mesh;
  if (w.role === 'planter') {
    const toolGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.02, 4);
    tool = new THREE.Mesh(toolGeo, new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9, metalness: 0 }));
    tool.position.set(0.008, WORLD_CONFIG.workerHeight * 0.4, 0);
    tool.rotation.z = 0.3;
  } else {
    const toolGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.025, 4);
    tool = new THREE.Mesh(toolGeo, new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9, metalness: 0 }));
    tool.position.set(-0.008, WORLD_CONFIG.workerHeight * 0.4, 0);
    tool.rotation.z = -0.3;
  }
  group.add(tool);

  group.renderOrder = 4;
  planetGroup.add(group);

  return { group, body, head, hat, tool, bobOffset: Math.random() * Math.PI * 2, dropStartTime: performance.now() };
}

function getUsablePlotCount(): number {
  return Math.min(grid.unlockedOrder.length, WORLD_CONFIG.usableStart + state.upgrades.maxTrees * WORLD_CONFIG.maxTreesSlotsPerLevel);
}

function addWorker(role: Role) {
  try {
    const verdant = state.planets.verdant;
    const existing = verdant.workers.filter((w) => w.role === role).length;
    const cost = costOf(role, existing);
    if (!state.currencies.credits.gte(cost)) return;
    state.currencies.credits = state.currencies.credits.sub(cost);
    const id = Date.now();
    verdant.workers.push({
      id, role,
      pos: { x: 0, y: planetRadius + 1, z: 0 },
      state: 'dropping', level: 0, target: undefined, carrying: undefined,
      cosmetic: role === 'planter' ? { hat: 'cap', color: '#3388ff' } : role === 'lumberjack' ? { hat: 'cowboy', color: '#e53935' } : { hat: 'cap', color: '#4488ff' },
      name: role, stuckTimer: 0, dropProgress: 0,
    });
    const vw = createWorkerVisual(verdant.workers[verdant.workers.length - 1]);
    workerVisuals.set(id, vw);
    uiNeedsUpdate = true;
  } catch (err) { showError(`addWorker: ${err instanceof Error ? err.message : err}`); }
}

const ui = new UI(showError);
try {
  ui.setHireHandler('planter', () => addWorker('planter'));
  ui.setHireHandler('lumberjack', () => addWorker('lumberjack'));
  ui.setHireHandler('carrier', () => addWorker('carrier'));

  ui.setUpgradeHandler((id: UpgradeId) => {
    try {
      const level = state.upgrades[id];
      const cost = upgradeCost(id, level);
      if (!state.currencies.credits.gte(cost)) return;
      state.currencies.credits = state.currencies.credits.sub(cost);
      state.upgrades[id] = level + 1;
      // Unlock more plots
      const newUsable = getUsablePlotCount();
      while (verdant?.plots.length < newUsable && verdant?.plots.length < grid?.unlockedOrder.length) {
        const idx = verdant.plots.length;
        const pid = grid?.unlockedOrder[idx];
        if (!pid) break;
        const plot = grid?.plotById.get(pid);
        if (!plot) break;
        verdant.plots.push({
          id: pid,
          row: plot.row,
          col: plot.col,
          dir: { ...plot.dir },
          state: 'empty',
          timer: 0,
          reservedBy: undefined,
          woodLeft: 0,
        });
        verdant.usablePlotCount = idx + 1;
        dirtyTreeSet?.add(pid);
      }
      uiNeedsUpdate = true;
    } catch (err) { showError(`setUpgradeHandler: ${err instanceof Error ? err.message : err}`); }
  });

  ui.setDevHandlers({
    onToggleSpeed: () => { /* handled by UI internally */ },
    onToggleAuto: () => { /* handled by UI internally */ },
  });
} catch (err) { showError('UI handler setup failed', err); }

let lastSave = Date.now();
let lastUiUpdate = 0;
const UI_UPDATE_INTERVAL = 250; // 4 fps max
let uiNeedsUpdate = false;
let uiRenderCount = 0;

let updateGestures: any;
if (sceneAPI) {
  try {
    updateGestures = setupGestures({
      planet: planetGroup,
      camera: sceneAPI.camera,
      planetRadius,
      defaultDist,
      startDist: defaultDist,
      minDist,
      maxDist,
      debug: () => {},
    });
  } catch (err) { showError('setupGestures failed', err); }
}

// Reset zoom to default on page load and when dev menu closes
(window as any).__resetZoomToDefault = () => {
  try {
    updateGestures?.setDist(defaultDist);
    const cam2 = sceneAPI?.camera as THREE.PerspectiveCamera;
    if (cam2) {
      cam2.position.set(0, 0, defaultDist);
      cam2.zoom = 1;
      cam2.updateProjectionMatrix();
    }
    planetGroup?.scale.set(1, 1, 1);
    logEvent(`Zoom reset to default: ${defaultDist.toFixed(2)}`);
  } catch (err) { showError('__resetZoomToDefault failed', err); };
};
(window as any).__resetZoomToDefault();

// Default zoom diagnostic
try {
  const cam = sceneAPI?.camera as THREE.PerspectiveCamera;
  if (cam) {
    logEvent(`DEFAULT ZOOM: dist=${defaultDist.toFixed(2)} minDist=${minDist.toFixed(2)} maxDist=${maxDist.toFixed(2)}`);
    logEvent(`CAMERA: pos.len=${cam.position.length().toFixed(2)} fov=${cam.fov} zoom=${cam.zoom} planetRadius=${planetRadius} treeHeight=${WORLD_CONFIG.treeHeight}`);
  }
} catch (err) { showError('zoom diagnostic failed', err); }

// Reset save button (trash icon) — opens dev menu only; never reloads.
// Reset game lives inside the dev menu with double-tap confirmation.
const btnResetSave = document.getElementById('ui-reset-save') as HTMLButtonElement;
if (btnResetSave) {
  btnResetSave.type = 'button';
  btnResetSave.addEventListener('click', (e) => {
    e.stopPropagation();
    openDevMenu();
  });
}

// ===== Worker visuals (with sky-drop) =====
function updateWorkerVisuals(dt: number): void {
  const verdant = state.planets.verdant;

  for (const w of verdant.workers) {
    let vw = workerVisuals.get(w.id);
    if (!vw) {
      vw = createWorkerVisual(w);
      workerVisuals.set(w.id, vw);
    }

    // Sky-drop animation
    if (w.state === 'dropping' && w.dropProgress !== undefined) {
      const t = Math.min(w.dropProgress, 1);
      const camPos = sceneAPI?.camera.position;
      if (!camPos) continue;
      const dropStart = camPos.clone().multiplyScalar(WORLD_CONFIG.dropStartDistFactor);
      const dropTarget = new THREE.Vector3(w.pos.x, w.pos.y, w.pos.z);
      const lerp = dropStart.clone().lerp(dropTarget, t);
      const arcHeight = Math.sin(t * Math.PI) * 0.6;
      lerp.y += arcHeight;
      // inv planet rotation
      lerp.applyQuaternion(new THREE.Quaternion().copy(planetGroup.quaternion).invert());

      const scale = WORLD_CONFIG.dropStartScale + (1 - WORLD_CONFIG.dropStartScale) * t;
      const tumble = t * Math.PI * 4;
      vw.group.position.set(lerp.x, lerp.y, lerp.z);
      vw.group.quaternion.setFromEuler(new THREE.Euler(tumble, tumble * 0.5, 0));
      vw.group.scale.setScalar(scale);

      if (t >= 1) {
        vw.group.scale.set(1.2, 0.7, 1.2);
        setTimeout(() => {
          vw.group.scale.setScalar(1);
        }, 250);
        w.state = 'idle';
        w.dropProgress = 1;
      }
      continue;
    }

    // Normal positioning on surface
    const dir = w.pos;
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
    const ndir = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    const surfY = planetRadius + WORLD_CONFIG.workerHeight * 0.35;

    vw.group.position.set(ndir.x * surfY, ndir.y * surfY, ndir.z * surfY);
    vw.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ndir.x, ndir.y, ndir.z));

    if (w.state === 'walk' || w.state === 'walkToPost') {
      const target = verdant.plots.find((p: any) => p.id === w.target);
      if (target) {
        const tdir = { x: target.dir.x, y: target.dir.y, z: target.dir.z };
        const forward = new THREE.Vector3(tdir.x - ndir.x, tdir.y - ndir.y, tdir.z - ndir.z);
        const upVec = new THREE.Vector3(ndir.x, ndir.y, ndir.z);
        const right = new THREE.Vector3().crossVectors(upVec, forward).normalize();
        const tangent = new THREE.Vector3().crossVectors(right, upVec).normalize();
        if (tangent.lengthSq() > 0.0001) {
          vw.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        }
      }
    }

    vw.bobOffset += dt * 8;
    const bob = Math.sin(vw.bobOffset) * 0.003;
    vw.group.position.y += bob;

    if (w.state === 'walk' || w.state === 'walkToPost') {
      const swing = Math.sin(vw.bobOffset * 2) * 0.15;
      vw.body.rotation.z = swing;
      vw.head.rotation.z = -swing * 0.5;
    } else {
      vw.body.rotation.z = 0;
      vw.head.rotation.z = 0;
    }

    if (w.state === 'plant' || w.state === 'chop') {
      vw.group.rotation.x = Math.sin(vw.bobOffset * 4) * 0.2;
    } else {
      vw.group.rotation.x = 0;
    }
  }
}

// ===== Tree instance updates (dirty list only) =====
function updateTreeInstances(): void {
  const verdant = state.planets.verdant;
  const usable = getUsablePlotCount();

  // Unlock new plots as usable increases
  while (verdant.plots.length < usable) {
    const idx = verdant.plots.length;
    const pid = grid.unlockedOrder[idx];
    const plot = grid.plotById.get(pid)!;
    verdant.plots.push({
      id: pid,
      row: plot.row,
      col: plot.col,
      dir: { ...plot.dir },
      state: 'empty',
      timer: 0,
      reservedBy: undefined,
      woodLeft: 0,
    });
    verdant.usablePlotCount = idx + 1;
    dirtyTreeSet.add(pid);
  }

  const trunkHeight = WORLD_CONFIG.treeHeight * 0.5;
  const crownHeight = WORLD_CONFIG.treeHeight * 0.55;

  const updateAll = frameCount < 2;
  const indicesToUpdate = updateAll
    ? verdant.plots.map((_, i) => i)
    : Array.from(dirtyTreeSet);

  dirtyTreeSet.clear();

  for (const plotIdx of indicesToUpdate) {
    const plot = verdant.plots[plotIdx];
    if (!plot) continue;
    const poolIdx = plot.id;
    const dir = plot.dir;
    const p = plotWorldPos(plot, planetRadius);
    const up = dir;

    let trunkScale = 0;
    let crownScale = 0;
    let logStack = 0;

    if (plot.state === 'empty') {
      trunkScale = 0;
      crownScale = 0;
    } else if (plot.state === 'sapling') {
      trunkScale = 0.3;
      crownScale = 0.25;
    } else if (plot.state === 'medium') {
      trunkScale = 0.65;
      crownScale = 0.5;
    } else if (plot.state === 'grown') {
      trunkScale = 1.0;
      crownScale = 1.0;
    } else if (plot.state === 'stump') {
      trunkScale = 0.15;
      crownScale = 0;
      logStack = Math.min(plot.woodLeft, 3);
    }

    // Trunk matrix
    const trunkP = {
      x: p.x - up.x * trunkHeight * trunkScale * 0.5,
      y: p.y - up.y * trunkHeight * trunkScale * 0.5,
      z: p.z - up.z * trunkHeight * trunkScale * 0.5,
    };
    treeDummy.position.set(trunkP.x, trunkP.y, trunkP.z);
    treeDummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(up.x, up.y, up.z));
    treeDummy.scale.set(WORLD_CONFIG.treeTrunkRadius * 1.2, trunkHeight * trunkScale, WORLD_CONFIG.treeTrunkRadius * 1.2);
    treeDummy.updateMatrix();
    trunkPool.setMatrixAt(poolIdx, treeDummy.matrix);
    trunkPool.setColorAt(poolIdx, new THREE.Color(TRUNK_VARIANTS[trunkColorPerPlot[poolIdx]]));

    // Crown matrix
    if (crownScale > 0) {
      const crownYOffset = trunkHeight * trunkScale + crownHeight * crownScale * 0.5;
      const crownP = {
        x: p.x + up.x * crownYOffset,
        y: p.y + up.y * crownYOffset,
        z: p.z + up.z * crownYOffset,
      };
      treeDummy.position.set(crownP.x, crownP.y, crownP.z);
      treeDummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(up.x, up.y, up.z));
      const leanAxis = new THREE.Vector3(-up.z, 0, up.x).normalize();
      treeDummy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(leanAxis, plotLean[poolIdx]));
      treeDummy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(up.x, up.y, up.z), plotYaw[poolIdx]));
      const cIdx = crownColorPerPlot[poolIdx];
      treeDummy.scale.set(crownScale, crownScale * 1.1, crownScale);
      treeDummy.updateMatrix();
      crownPool.setMatrixAt(poolIdx, treeDummy.matrix);
      crownPool.setColorAt(poolIdx, new THREE.Color(CROWN_COLORS[cIdx]));
    } else {
      treeDummy.position.set(0, -999, 0);
      treeDummy.scale.setScalar(0.001);
      treeDummy.updateMatrix();
      crownPool.setMatrixAt(poolIdx, treeDummy.matrix);
    }

    // Log pile
    for (let li = 0; li < 3; li++) {
      const logIdx = poolIdx * 3 + li;
      if (li < logStack) {
        const logY = 0.02 + li * 0.028;
        treeDummy.position.set(p.x + up.x * logY, p.y + up.y * logY, p.z + up.z * logY);
        treeDummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(up.x, up.y, up.z));
        treeDummy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        treeDummy.scale.set(0.018, 0.045, 0.018);
        treeDummy.updateMatrix();
        logPool.setMatrixAt(logIdx, treeDummy.matrix);
      } else {
        treeDummy.position.set(0, -999, 0);
        treeDummy.scale.setScalar(0.001);
        treeDummy.updateMatrix();
        logPool.setMatrixAt(logIdx, treeDummy.matrix);
      }
    }

    // Contact shadow under tree
    const shadowScale = crownScale > 0 ? crownScale : 0.001;
    treeDummy.position.set(p.x + up.x * 0.001, p.y + up.y * 0.001, p.z + up.z * 0.001);
    treeDummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(up.x, up.y, up.z));
    treeDummy.scale.setScalar(shadowScale);
    treeDummy.updateMatrix();
    shadowPool.setMatrixAt(poolIdx, treeDummy.matrix);
  }

  trunkPool.instanceMatrix.needsUpdate = true;
  trunkPool.instanceColor!.needsUpdate = true;
  crownPool.instanceMatrix.needsUpdate = true;
  crownPool.instanceColor!.needsUpdate = true;
  logPool.instanceMatrix.needsUpdate = true;
  shadowPool.instanceMatrix.needsUpdate = true;
}

// ===== Tree sway (grown trees near camera, every 2nd frame) =====
function updateTreeSway(): void {
  if (!sceneAPI) return;
  swayFrame++;
  if (swayFrame % 2 !== 0) return;
  const camPos = sceneAPI.camera.position;
  const camLen = Math.sqrt(camPos.x * camPos.x + camPos.y * camPos.y + camPos.z * camPos.z) || 1;
  const cd = { x: camPos.x / camLen, y: camPos.y / camLen, z: camPos.z / camLen };

  const time = performance.now() * 0.002;
  const verdant = state.planets.verdant;

  for (const plot of verdant.plots) {
    if (plot.state !== 'grown') continue;
    const dot = plot.dir.x * cd.x + plot.dir.y * cd.y + plot.dir.z * cd.z;
    if (dot < 0.7) continue; // only near camera
    const sway = Math.sin(time + plot.id * 0.5) * 0.03;
    const treeDummy2 = new THREE.Object3D();
    const p = plotWorldPos(plot, planetRadius);
    const up = plot.dir;
    const crownYOffset = WORLD_CONFIG.treeHeight * 0.5 + WORLD_CONFIG.treeHeight * 0.55 * 0.5;
    const crownP = {
      x: p.x + up.x * crownYOffset,
      y: p.y + up.y * crownYOffset,
      z: p.z + up.z * crownYOffset,
    };
    treeDummy2.position.set(crownP.x, crownP.y, crownP.z);
    treeDummy2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(up.x, up.y, up.z));
    const axis = new THREE.Vector3(-up.z, 0, up.x).normalize();
    treeDummy2.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, sway));
    const m = treeDummy2.matrix;
    crownPool.setMatrixAt(plot.id, m);
  }
  crownPool.instanceMatrix.needsUpdate = true;
}

// ===== Main loop =====
let frameCount = 0;
let debugFrameCount = 0;
let debugLastTime = performance.now();
let debugFPS = 0;

function loop(now: number) {
  requestAnimationFrame(loop);

  try {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (!Number.isFinite(dt)) return;

    try {
      if (!isPaused) {
        const speedMult = gameSpeedMult;
        const stepDt = DT * speedMult;
        const steps = Math.floor(accumulator / stepDt);
        const stepped = Math.min(steps, 6);
        for (let i = 0; i < stepped; i++) {
          tick(state, stepDt);
        }
        accumulator -= stepped * stepDt;
      }
    } catch (err) { console.error(`sim.update: ${err instanceof Error ? err.message : err}`); }

    try {
      updateGestures.update();
    } catch (err) { console.error(`updateGestures: ${err instanceof Error ? err.message : err}`); }

    try {
      updateTreeInstances();
    } catch (err) { console.error(`updateTrees: ${err instanceof Error ? err.message : err}`); }

    try {
      updateTreeSway();
    } catch (err) { console.error(`updateSway: ${err instanceof Error ? err.message : err}`); }

    try {
      updateWorkerVisuals(dt);
    } catch (err) { console.error(`updateWorkers: ${err instanceof Error ? err.message : err}`); }

    try {
      ufoTime += dt;
      if (ufo) ufo.position.y += Math.sin(ufoTime * 3) * 0.002;
    } catch (err) { console.error(`ufo: ${err instanceof Error ? err.message : err}`); }

    try {
      effectMgr?.update(DT);
      sceneAPI?.render();
    } catch (err) { console.error(`render: ${err instanceof Error ? err.message : err}`); }

    try {
      if (!uiFrozen && (now - lastUiUpdate >= UI_UPDATE_INTERVAL || uiNeedsUpdate)) {
        ui.updateUI(state);
        lastUiUpdate = now;
        uiNeedsUpdate = false;
        uiRenderCount++;
      }
    } catch (err) { console.error(`ui.update: ${err instanceof Error ? err.message : err}`); }

    try {
      if (now - lastSave > 15000) {
        save(state);
        lastSave = now;
      }
    } catch (err) { console.error(`autosave: ${err instanceof Error ? err.message : err}`); }

    debugFrameCount++;
    const nowTime = performance.now();
    if (nowTime - debugLastTime >= 1000) {
      debugFPS = debugFrameCount;
      checkQualityFps(debugFPS);
      updateDevStats(verdant.plots.length, debugFPS);
      (window as any).__debugFPS = debugFPS;
      (window as any).__plotCount = verdant.plots.length;
      if (fpsCounterEl) fpsCounterEl.textContent = `FPS: ${debugFPS}`;
      logEvent(`UI render calls/sec: ${uiRenderCount}`);
      uiRenderCount = 0;
      debugFrameCount = 0;
      debugLastTime = nowTime;
    }

    frameCount++;
  } catch (err) {
    console.error(`loop top-level: ${err instanceof Error ? err.message : err}`);
  }
}

window.addEventListener('resize', () => {
  sceneAPI?.resize();
  updateViewport();
});
window.addEventListener('orientationchange', () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(updateViewport);
  });
});
let isPaused = false;
window.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isPaused = true;
    try { save(state); } catch { /* save may fail if state is undefined */ }
  } else {
    isPaused = false;
    lastTime = performance.now(); // reset to avoid huge dt on return
  }
}, { passive: true });

window.addEventListener('beforeunload', () => {
  try { sessionStorage.setItem('tw_last_unload', String(Date.now())); } catch { /* ignore */ }
}, { passive: true });
window.addEventListener('pagehide', () => {
  try { sessionStorage.setItem('tw_last_pagehide', String(Date.now())); } catch { /* ignore */ }
}, { passive: true });

// Debug: triple-tap TW badge opens dev menu
const badgeEl = document.getElementById('ui-player-badge');
if (badgeEl) {
  badgeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    openDevMenu();
  });
}

// Trash button next to Settings opens the dev menu
const btnDev = document.getElementById('ui-reset-save');
if (btnDev) {
  btnDev.addEventListener('click', (e) => {
    e.stopPropagation();
    openDevMenu();
  });
}

// Expose helpers for testing and URL params
(window as any).__fillTrees = () => {
  const verdant2 = state.planets.verdant;
  const existingIds = new Set(verdant2.plots.map((p) => p.id));
  let filled = 0;
  let updated = 0;
  for (const plot of grid.plots) {
    if (existingIds.has(plot.id)) {
      const p = verdant2.plots.find((x) => x.id === plot.id)!;
      if (p.state !== 'grown') {
        p.state = 'grown';
        p.timer = 0;
        p.woodLeft = 0;
        dirtyTreeSet.add(plot.id);
        updated++;
      }
    } else {
      verdant2.plots.push({
        id: plot.id,
        row: plot.row,
        col: plot.col,
        dir: { ...plot.dir },
        state: 'grown',
        timer: 0,
        reservedBy: undefined,
        woodLeft: 0,
      });
      verdant2.usablePlotCount = verdant2.plots.length;
      dirtyTreeSet.add(plot.id);
      filled++;
    }
  }
  rebuildGroundCover();
  logEvent(`__fillTrees: filled ${filled} new, updated ${updated}, total ${verdant2.plots.length}/${grid.plots.length}`);
  updateDevStats(verdant2.plots.length, debugFPS);
  uiNeedsUpdate = true;
};

// Clear every plot to empty (workers kept)
(window as any).__clearTrees = () => {
  const verdant2 = state.planets.verdant;
  let cleared = 0;
  for (const p of verdant2.plots) {
    if (p.state !== 'empty') {
      p.state = 'empty';
      p.timer = 0;
      p.woodLeft = 0;
      dirtyTreeSet.add(p.id);
      cleared++;
    }
  }
  rebuildGroundCover();
  logEvent(`__clearTrees: cleared ${cleared} plots`);
  updateDevStats(verdant2.plots.length, debugFPS);
  uiNeedsUpdate = true;
};

// Set density preset (rebuilds grid and tree system)
(window as any).__setDensity = (count: number) => {
  rebuildDensity(count);
  uiNeedsUpdate = true;
  logEvent(`__setDensity: ${count} plots`);
};

// Reset game (clear save + reload) - requires second tap within 3s
let resetConfirmTime = 0;
(window as any).__resetGame = () => {
  const now = Date.now();
  if (now - resetConfirmTime < 3000) {
    logEvent('__resetGame: confirmed, clearing save. Refresh the page manually.');
    clearSave();
    showToast('Save cleared. Refresh the page to restart.');
    return;
  }
  resetConfirmTime = now;
  showToast('Tap Reset again within 3s to confirm');
  logEvent('__resetGame: waiting for confirmation');
};

// Add credits (dev)
(window as any).__addCredits = (amt: number) => {
  state.currencies.credits = state.currencies.credits.add(new Decimal(amt));
  uiNeedsUpdate = true;
  logEvent(`__addCredits: +${amt}`);
};

// Spawn worker with sky-drop (dev)
(window as any).__spawnWorker = (role: Role) => {
  try {
    addWorker(role);
    uiNeedsUpdate = true;
    logEvent(`__spawnWorker: ${role}`);
  } catch (err) {
    logEvent(`__spawnWorker: ${err instanceof Error ? err.message : err}`);
  }
};

// Game time multiplier (dev)
let gameSpeedMult = 1;
(window as any).__setSpeed = (mult: number) => {
  gameSpeedMult = mult;
  logEvent(`__setSpeed: x${mult}`);
};

// Show FPS toggle (dev)
let fpsCounterEl: HTMLElement | null = null;
let fpsCounterVisible = false;
(window as any).__toggleFps = () => {
  fpsCounterVisible = !fpsCounterVisible;
  if (fpsCounterVisible) {
    if (!fpsCounterEl) {
      fpsCounterEl = document.createElement('div');
      fpsCounterEl.id = 'ui-fps-counter';
      fpsCounterEl.style.cssText = `position:fixed;top:8px;right:8px;z-index:2147483647;pointer-events:none;font-family:monospace;font-size:12px;color:#0f0;background:rgba(0,0,0,0.8);padding:6px 10px;border-radius:6px;border:1px solid #0f0;`;
      document.body.appendChild(fpsCounterEl);
    }
    fpsCounterEl.style.display = 'block';
  } else if (fpsCounterEl) {
    fpsCounterEl.style.display = 'none';
  }
  logEvent(`__toggleFps: ${fpsCounterVisible ? 'on' : 'off'}`);
};

// Hide debug log toggle (dev)
let logBoxHidden = false;
(window as any).__toggleLog = () => {
  logBoxHidden = !logBoxHidden;
  const lb = document.getElementById('ui-log-box');
  if (lb) lb.style.display = logBoxHidden ? 'none' : 'block';
  logEvent(`__toggleLog: ${logBoxHidden ? 'hidden' : 'shown'}`);
};

// Expose grid toggle
(window as any).__toggleGrid = toggleGridOverlay;

// Apply URL parameters (?fill=1, ?clear=1, ?reset=1, ?density=600|1000|1500, ?menu=1)
applyUrlParams();

requestAnimationFrame(() => {
  requestAnimationFrame(updateViewport);
});

requestAnimationFrame(loop);

// ===== Density preset: rebuild grid and tree system =====
function rebuildDensity(targetPlots: number): void {
  // Map target plot count to spacing
  let newSpacing: number;
  if (targetPlots <= 600) newSpacing = 0.37;
  else if (targetPlots <= 1000) newSpacing = 0.29;
  else newSpacing = 0.24;

  WORLD_CONFIG.treeSpacing = newSpacing;

  // Remove old pools from planetGroup
  planetGroup.remove(trunkPool);
  planetGroup.remove(crownPool);
  planetGroup.remove(logPool);
  planetGroup.remove(shadowPool);

  // Rebuild grid
  grid = buildGrid();
  console.log(`Density ${targetPlots}: spacing=${newSpacing}, ${grid.plots.length} plots`);

  // Recreate tree pools
  setupTreePools();

  // Re-initialize plots as empty
  verdant.plots = [];
  verdant.usablePlotCount = 0;
  const usableStart = Math.min(WORLD_CONFIG.usableStart, grid.unlockedOrder.length);
  for (let i = 0; i < usableStart; i++) {
    const pid = grid.unlockedOrder[i];
    const plot = grid.plotById.get(pid)!;
    verdant.plots.push({
      id: pid,
      row: plot.row,
      col: plot.col,
      dir: { ...plot.dir },
      state: 'empty',
      timer: 0,
      reservedBy: undefined,
      woodLeft: 0,
    });
    verdant.usablePlotCount = i + 1;
  }

  // Rebuild ground cover
  rebuildGroundCover();

  // Mark all plots dirty so instances update
  for (const p of verdant.plots) {
    dirtyTreeSet.add(p.id);
  }

  updateDevStats(grid.plots.length, debugFPS);
}
