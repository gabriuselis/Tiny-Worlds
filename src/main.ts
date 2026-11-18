import * as THREE from 'three';
import { initialState } from './core/state';
import { tick } from './core/sim';
import { load, save, clearSave } from './core/save';
import { upgradeCost } from './core/config/upgrades';
import { WORLD_CONFIG, PLOT_COUNT, PLANET_RADIUS, GROW_STAGE_SECONDS, GROW_POP_SECONDS } from './core/config/world';
import { WORKER_SCALE, WORKER_APPEAR_SECONDS } from './core/config/worker';
import { hireWorker } from './core/workers';
import { buildGrid } from './core/grid';
import { add, gte, sub } from './core/money';
import type { GameState, Role, UpgradeId, Plot } from './core/state';

import { createScene, SceneAPI } from './render/scene';
import { createPlanetMesh, createTreeVariantGeometry, createLogPileGeometry, createContactShadowGeometry, treeMaterials, CROWN_COLORS, CROWN_COLOR_COUNT } from './render/planet';
import { createWorkerModel, animateWorker, placeWorkerModel, tangentTowards, disposeWorkerModel, WorkerModel } from './render/worker';
import { EffectManager } from './render/effects';
import { setupGestures } from './render/gestures';
import { getPlanetArea } from './render/viewport';
import { UI, applyUrlParams, openDevDialog as openDevMenu, updateDevStats, logEvent, startMutationObserver, startDiagnosticEvents, uiFrozen, showToast } from './ui/ui';
import './ui/style.css';

const TICK_RATE = 10;
const DT = 1 / TICK_RATE;
const planetRadius = WORLD_CONFIG.planetRadius;

// Measured surface radius of the real planet mesh (used so tree bases sit in the ground).
let surfaceRadius = planetRadius;

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
  console.log(`Plot grid: ${grid.plots.length} plots (target ${PLOT_COUNT}), unlocked=${grid.unlockedOrder.length}`);
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

// Measure the real surface radius from the planet mesh vertices so tree bases sit in the ground.
try {
  const pos = (planetMesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d < min) min = d;
  }
  if (isFinite(min) && min > 0) surfaceRadius = min;
  logEvent(`Planet surface radius measured: ${surfaceRadius.toFixed(4)} (config ${planetRadius})`);
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

// ===== Grid overlay debug (LineSegments, opacity 0.15, depthWrite false) =====
let gridOverlay: THREE.LineSegments | null = null;
let gridOverlayVisible = false;

function buildGridOverlay(): THREE.LineSegments {
  const lines: number[] = [];
  const R = PLANET_RADIUS;
  const cell = 0.002; // small offset above surface
  // Draw each plot to its nearest neighbor -> a web covering the whole globe.
  for (let i = 0; i < grid.plots.length; i++) {
    const a = grid.plots[i];
    let best: Plot | null = null;
    let bestD = Infinity;
    for (let j = i + 1; j < grid.plots.length; j++) {
      const b = grid.plots[j];
      const dx = a.dir.x - b.dir.x;
      const dy = a.dir.y - b.dir.y;
      const dz = a.dir.z - b.dir.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      const ax = a.dir.x * R, ay = a.dir.y * R, az = a.dir.z * R;
      const bx = best.dir.x * R, by = best.dir.y * R, bz = best.dir.z * R;
      lines.push(ax, ay + cell, az, bx, by + cell, bz);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false });
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

// ===== Tree InstancedMeshes: trunks, crowns (4 per color), log piles, shadows =====
let variantPools: THREE.InstancedMesh[] = [];
let logPool: THREE.InstancedMesh;
let shadowPool: THREE.InstancedMesh;
let treeMatrix: THREE.Matrix4;
let treeScale: THREE.Vector3;
let dirtyTreeSet: Set<number>;
let swayFrame = 0;
let testTreeTimer: number | null = null;
let plotDotsMesh: THREE.InstancedMesh | null = null;
let plotDotsVisible = false;

function setupTreePools(): void {
  const { shadow } = treeMaterials();
  const logMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9, metalness: 0 });

  // Remove any previously created pools so rebuilds don't stack duplicates
  if (variantPools) {
    for (const vp of variantPools) if (vp) planetGroup.remove(vp);
  }
  if (logPool) planetGroup.remove(logPool);
  if (shadowPool) planetGroup.remove(shadowPool);

  variantPools = [];
  for (let c = 0; c < CROWN_COLOR_COUNT; c++) {
    const geo = createTreeVariantGeometry(CROWN_COLORS[c]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    const vp = new THREE.InstancedMesh(geo, mat, PLOT_COUNT);
    vp.name = `tree-variant-pool-${c}`;
    vp.renderOrder = 3;
    vp.frustumCulled = false;
    planetGroup.add(vp);
    variantPools.push(vp);
  }
  const logGeo = createLogPileGeometry();
  const shadowGeo = createContactShadowGeometry();
  logPool = new THREE.InstancedMesh(logGeo, logMat, PLOT_COUNT);
  shadowPool = new THREE.InstancedMesh(shadowGeo, shadow, PLOT_COUNT);
  logPool.name = 'tree-log-pool';
  shadowPool.name = 'tree-shadow-pool';
  logPool.renderOrder = 3;
  shadowPool.renderOrder = 2;
  logPool.frustumCulled = false;
  shadowPool.frustumCulled = false;
  planetGroup.add(logPool);
  planetGroup.add(shadowPool);

  treeMatrix = new THREE.Matrix4();
  treeScale = new THREE.Vector3();
  dirtyTreeSet = new Set<number>();
  swayFrame = 0;

  // Initialize all instances hidden
  const hideMatrix = new THREE.Matrix4();
  const hideQ = new THREE.Quaternion(0, 0, 0, 1);
  const hideS = new THREE.Vector3(0.001, 0.001, 0.001);
  for (let i = 0; i < PLOT_COUNT; i++) {
    hideMatrix.compose(new THREE.Vector3(0, -999, 0), hideQ, hideS);
    for (const vp of variantPools) vp.setMatrixAt(i, hideMatrix);
    logPool.setMatrixAt(i, hideMatrix);
    shadowPool.setMatrixAt(i, hideMatrix);
  }
  for (const vp of variantPools) vp.instanceMatrix.needsUpdate = true;
  logPool.instanceMatrix.needsUpdate = true;
  shadowPool.instanceMatrix.needsUpdate = true;
}

try {
  setupTreePools();
} catch (err) { showError('setupTreePools failed', err); }

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

  // EMPTY START: no pre-planted trees, no workers. All 1500 plots exist in the grid
  // but none are planted until Fill/hire. usablePlotCount drives what the renderer draws.
  verdant.plots = [];
  verdant.workers = [];
  verdant.usablePlotCount = 0;
} catch (err) { showError('state init failed', err); }

let lastTime = performance.now();
let accumulator = 0;

// ===== Worker visual models (one per worker in state, object pool keyed by worker id) =====
const workerVisuals = new Map<number, WorkerModel>();
let testWorkerModel: WorkerModel | null = null;

// Random surface direction on the camera-facing side, away from the trade post.
function pickSpawnDir(): { x: number; y: number; z: number } {
  const fallback = { x: 0, y: 0, z: 1 };
  try {
    const cam = sceneAPI?.camera;
    if (!cam) return fallback;
    // Directions are stored in planet-local space, so bring the camera into that space.
    const cd = planetGroup.worldToLocal(cam.position.clone());
    const cdLen = cd.length() || 1;
    cd.divideScalar(cdLen);
    const postDir = new THREE.Vector3(0, 1, 0); // trade post sits at the north pole
    let best: { x: number; y: number; z: number } | null = null;
    let bestDot = -Infinity;
    for (let i = 0; i < 24; i++) {
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);
      const d = { x: Math.sin(phi) * Math.cos(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.sin(theta) };
      const camDot = d.x * cd.x + d.y * cd.y + d.z * cd.z;
      const postDot = d.x * postDir.x + d.y * postDir.y + d.z * postDir.z;
      if (camDot > 0.6 && postDot < 0.85) return d;
      if (camDot > bestDot && postDot < 0.85) { bestDot = camDot; best = d; }
    }
    // Prefer the camera-facing side; fall back to the best candidate found.
    if (best && bestDot > 0) return best;
  } catch (err) {
    console.error(`pickSpawnDir: ${err instanceof Error ? err.message : err}`);
  }
  return fallback;
}

function getUsablePlotCount(): number {
  return verdant.usablePlotCount;
}

function addWorker(role: Role, free = false) {
  try {
    const spawnDir = pickSpawnDir();
    const worker = hireWorker(state, role, { free, spawnDir });
    if (!worker) {
      showToast(`Not enough credits for ${role}`);
      return;
    }
    const vm = createWorkerModel(worker.role);
    vm.puffTimer = WORKER_APPEAR_SECONDS;
    workerVisuals.set(worker.id, vm);
    planetGroup.add(vm.group);
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
      if (!gte(state.currencies.credits, cost)) return;
      state.currencies.credits = sub(state.currencies.credits, cost);
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

// On-screen zoom diagnostic (built once, patched once): distance, fov, radius, scale
try {
  const diagEl = document.createElement('div');
  diagEl.id = 'ui-zoom-diag';
  diagEl.style.cssText = `position:fixed;bottom:8px;right:8px;z-index:2147483647;pointer-events:none;font-family:monospace;font-size:11px;color:#0f0;background:rgba(0,0,0,0.8);padding:6px 10px;border-radius:6px;border:1px solid #0f0;white-space:nowrap;display:none;`;
  document.body.appendChild(diagEl);
  const cam2 = sceneAPI?.camera as THREE.PerspectiveCamera;
  if (cam2) {
    const dist = cam2.position.length();
    const fovRad = (cam2.fov * Math.PI) / 180;
    const fill = (2 * Math.asin(Math.min(1, planetRadius / dist)) / fovRad) * 100;
    diagEl.textContent = `ZOOM: dist=${dist.toFixed(2)} fov=${cam2.fov}° R=${planetRadius} scale=${planetGroup.scale.x.toFixed(2)} fill=${fill.toFixed(0)}%`;
    logEvent(`ZOOM DIAG: dist=${dist.toFixed(2)} fov=${cam2.fov} planetRadius=${planetRadius} scale=1 fill=${fill.toFixed(0)}%`);
  }
} catch (err) { showError('zoom diag failed', err); }

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

// ===== Worker visuals: sync one model per worker from state (object pool) =====
function updateWorkerVisuals(dt: number): void {
  const verdant = state.planets.verdant;
  const live = new Set<number>();

  for (const w of verdant.workers) {
    live.add(w.id);
    let vm = workerVisuals.get(w.id);
    if (!vm) {
      vm = createWorkerModel(w.role);
      vm.puffTimer = WORKER_APPEAR_SECONDS;
      workerVisuals.set(w.id, vm);
      planetGroup.add(vm.group);
    }

    const dir = new THREE.Vector3(w.pos.x, w.pos.y, w.pos.z);
    if (dir.lengthSq() < 1e-10) dir.set(0, 0, 1);
    dir.normalize();

    // Face the direction of travel while running; keep the last facing otherwise.
    const moving = w.state === 'walking' || w.state === 'walk' || w.state === 'walkToPost';
    if (moving && w.target !== undefined && w.target >= 0) {
      const plot = verdant.plots.find((p: Plot) => p.id === w.target) ?? grid?.plotById.get(w.target);
      if (plot) {
        const tdir = new THREE.Vector3(plot.dir.x, plot.dir.y, plot.dir.z).normalize();
        vm.forward.copy(tangentTowards(dir, tdir));
      }
    }

    placeWorkerModel(vm, dir, vm.forward, surfaceRadius + 0.001);
    animateWorker(vm, w.state, dt);

    // Spawn scale-in: 0.2 -> 1.0 over WORKER_APPEAR_SECONDS with a small overshoot.
    let spawnScale = 1;
    if (w.appearTimer !== undefined) {
      w.appearTimer -= dt;
      const t = Math.min(1, 1 - Math.max(0, w.appearTimer) / WORKER_APPEAR_SECONDS);
      spawnScale = 0.2 + 0.8 * t;
      if (t > 0.7) spawnScale += Math.sin(((t - 0.7) / 0.3) * Math.PI) * 0.15;
      if (w.appearTimer <= 0) {
        w.appearTimer = undefined;
        spawnScale = 1;
      }
    }
    vm.group.scale.setScalar(WORKER_SCALE * spawnScale);
  }

  // Remove models whose workers no longer exist (reset / clear).
  for (const [id, vm] of workerVisuals) {
    if (!live.has(id)) {
      disposeWorkerModel(vm);
      workerVisuals.delete(id);
    }
  }
}

// Stable pseudo-random yaw angle per plot id (deterministic, [0, 2*PI))
function hashAngle(plotId: number): number {
  return (((plotId * 2654435761) >>> 0) / 4294967296) * Math.PI * 2;
}

export function stageScaleFor(state: string): number {
  if (state === 'empty') return 0.0001; // hidden, never 0 or negative
  if (state === 'sapling') return 0.35;
  if (state === 'medium') return 0.65;
  if (state === 'grown') return 1.0;
  if (state === 'stump') return 0.15;
  return 0.0001;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Smooth growth: the tree scale eases from one stage size to the next over the
// stage duration, plus a short pop when a stage changes.
function plotScale(plot: Plot): number {
  const pop = plot.popTimer ? 1 + 0.12 * clamp01(plot.popTimer / GROW_POP_SECONDS) : 1;
  if (plot.state === 'empty') return 0.0001;
  if (plot.state === 'stump') return 0.15;
  if (plot.state === 'grown') return pop;
  if (plot.state === 'sapling') {
    const t = clamp01(1 - Math.max(0, plot.timer) / GROW_STAGE_SECONDS[0]);
    return (0.35 + (0.65 - 0.35) * t) * pop;
  }
  if (plot.state === 'medium') {
    const t = clamp01(1 - Math.max(0, plot.timer) / GROW_STAGE_SECONDS[1]);
    return (0.65 + (1.0 - 0.65) * t) * pop;
  }
  return 0.35;
}

// Shared transform for a plot's tree: trunk, crown and shadow all use the SAME matrix.
// position = dir * R, quaternion = align +Y with dir then yaw by hash angle, uniform scale.
// Never rotate/translate trunk separately; the cylinder is already upright along Y.
function writeTreeMatrices(plot: Plot): void {
  const dir = new THREE.Vector3(plot.dir.x, plot.dir.y, plot.dir.z);
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  dir.divideScalar(len);

  const pos = new THREE.Vector3(dir.x * (surfaceRadius - 0.01), dir.y * (surfaceRadius - 0.01), dir.z * (surfaceRadius - 0.01));

  const upAxis = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(upAxis, dir);
  if (!q || !isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || !isFinite(q.w)) {
    q.set(0, 0, 0, 1);
  }
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, hashAngle(plot.id)));

  const s = Math.max(0.0001, plotScale(plot));
  treeMatrix.compose(pos, q, treeScale.set(s, s, s));
  const m = treeMatrix.elements;
  let bad = false;
  for (let i = 0; i < 16; i++) {
    if (!isFinite(m[i])) { bad = true; break; }
  }
  if (bad) {
    logEvent(`Tree matrix NaN skipped: plot ${plot.id}`);
    return;
  }

  // Same matrix for trunk+crown (merged variant pool) and shadow -> trunk attaches to crown, no gap
  const vp = variantPools[plot.id % CROWN_COLOR_COUNT];
  vp.setMatrixAt(plot.id, treeMatrix);
  shadowPool.setMatrixAt(plot.id, treeMatrix);

  // Stump log (chopped tree only): short upright cylinder on the ground.
  // Grown trees never show a stump/log-pile mesh.
  if (plot.state === 'stump') {
    logPool.setMatrixAt(plot.id, treeMatrix);
  } else {
    treeMatrix.compose(new THREE.Vector3(0, -999, 0), q, treeScale.set(0.001, 0.001, 0.001));
    logPool.setMatrixAt(plot.id, treeMatrix);
  }
}

// ===== syncTrees: rewrite ALL instance matrices from state (single source of truth) =====
function syncTrees(): void {
  const verdant = state.planets.verdant;
  for (let arrayIdx = 0; arrayIdx < verdant.plots.length; arrayIdx++) {
    writeTreeMatrices(verdant.plots[arrayIdx]);
  }
  for (const vp of variantPools) vp.instanceMatrix.needsUpdate = true;
  logPool.instanceMatrix.needsUpdate = true;
  shadowPool.instanceMatrix.needsUpdate = true;
}

// ===== Tree instance updates (dirty list only, per-frame) =====
function updateTreeInstances(): void {
  const verdant = state.planets.verdant;

  // Unlock new plots as usable increases
  const usable = getUsablePlotCount();
  while (verdant.plots.length < usable) {
    const arrayIdx = verdant.plots.length;
    const pid = grid.unlockedOrder[arrayIdx];
    const plot = grid.plotById.get(pid)!;
    verdant.plots.push({
      id: pid,
      dir: { ...plot.dir },
      state: 'empty',
      timer: 0,
      reservedBy: undefined,
      woodLeft: 0,
    });
    verdant.usablePlotCount = arrayIdx + 1;
    dirtyTreeSet.add(arrayIdx);
  }

  // Growing trees change scale every tick, so re-write them each frame.
  for (let i = 0; i < verdant.plots.length; i++) {
    const p = verdant.plots[i];
    if (p.state === 'sapling' || p.state === 'medium' || (p.popTimer ?? 0) > 0) {
      dirtyTreeSet.add(i);
    }
  }

  const updateAll = frameCount < 2;
  const indicesToUpdate = updateAll
    ? verdant.plots.map((_, i) => i)
    : Array.from(dirtyTreeSet);

  dirtyTreeSet.clear();

  for (const arrayIdx of indicesToUpdate) {
    const plot = verdant.plots[arrayIdx];
    if (!plot) continue;
    writeTreeMatrices(plot);
  }

  for (const vp of variantPools) vp.instanceMatrix.needsUpdate = true;
  logPool.instanceMatrix.needsUpdate = true;
  shadowPool.instanceMatrix.needsUpdate = true;
}

// ===== Count trees whose instance scale > 0.5 (read back from the matrices) =====
function countVisibleTrees(): number {
  let n = 0;
  const m = new THREE.Matrix4();
  const s = new THREE.Vector3();
  for (const vp of variantPools) {
    for (let i = 0; i < vp.count; i++) {
      vp.getMatrixAt(i, m);
      m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      if (s.x > 0.5) n++;
    }
  }
  return n;
}

// ===== Test tree: place one big grown tree in front of camera for 5 seconds =====
function testTree(): void {
  if (!sceneAPI) return;
  const cam = sceneAPI.camera;
  const camPos = cam.position.clone();
  const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
  const spawnPos = camPos.clone().add(camDir.multiplyScalar(4));
  const spawnDir = spawnPos.clone().normalize();
  const spawnDist = planetRadius + 0.05;

  // Place at a point in front of the camera, projected onto the planet surface
  const surfacePos = spawnDir.clone().multiplyScalar(spawnDist);

  const upAxis = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(spawnDir.x, spawnDir.y, spawnDir.z);
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  dir.divideScalar(len);
  const q = new THREE.Quaternion().setFromUnitVectors(upAxis, dir);
  if (!q || !isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || !isFinite(q.w)) {
    q.set(0, 0, 0, 1);
  }

  const s = 3; // big tree for inspection
  treeMatrix.compose(surfacePos, q, treeScale.set(s, s, s));
  const m = treeMatrix.elements;
  let bad = false;
  for (let i = 0; i < 16; i++) { if (!isFinite(m[i])) { bad = true; break; } }
  if (bad) { logEvent('Test tree: NaN matrix'); return; }

  // Same matrix for trunk+crown (merged variant pool) and shadow -> trunk attaches to crown
  variantPools[0].setMatrixAt(0, treeMatrix);
  shadowPool.setMatrixAt(0, treeMatrix);
  logPool.setMatrixAt(0, treeMatrix);

  // Hide all other instances temporarily
  const maxPlots = grid.plots.length;
  const hideMatrix = new THREE.Matrix4();
  const hideQ = new THREE.Quaternion(0, 0, 0, 1);
  const hideS = new THREE.Vector3(0.001, 0.001, 0.001);
    for (let i = 1; i < maxPlots; i++) {
      hideMatrix.compose(new THREE.Vector3(0, -999, 0), hideQ, hideS);
      for (const vp of variantPools) vp.setMatrixAt(i, hideMatrix);
      shadowPool.setMatrixAt(i, hideMatrix);
      logPool.setMatrixAt(i, hideMatrix);
    }

    for (const vp of variantPools) vp.instanceMatrix.needsUpdate = true;
    shadowPool.instanceMatrix.needsUpdate = true;
    logPool.instanceMatrix.needsUpdate = true;

  // Restore after 5 seconds
  if (testTreeTimer) clearTimeout(testTreeTimer);
  testTreeTimer = setTimeout(() => {
    for (let i = 0; i < maxPlots; i++) {
      dirtyTreeSet.add(i);
    }
    testTreeTimer = null;
    logEvent('Test tree: restored normal rendering');
  }, 5000);

  logEvent('Test tree: big tree placed in front of camera for 5s');
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

  const upAxis = new THREE.Vector3(0, 1, 0);
  const swayQuat = new THREE.Quaternion();

  for (const plot of verdant.plots) {
    if (plot.state !== 'grown') continue;
    const dir = new THREE.Vector3(plot.dir.x, plot.dir.y, plot.dir.z);
    const dot = dir.x * cd.x + dir.y * cd.y + dir.z * cd.z;
    if (dot < 0.7) continue; // only near camera
    const sway = Math.sin(time + plot.id * 0.5) * 0.03;
  const pos = new THREE.Vector3(dir.x * (surfaceRadius - 0.01), dir.y * (surfaceRadius - 0.01), dir.z * (surfaceRadius - 0.01));
    const q = new THREE.Quaternion().setFromUnitVectors(upAxis, dir);
    if (!q || !isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || !isFinite(q.w)) {
      q.set(0, 0, 0, 1);
    }
    const axis = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    q.premultiply(swayQuat.setFromAxisAngle(axis, sway));
    const s = plotScale(plot);
    treeMatrix.compose(pos, q, treeScale.set(s, s, s));
    variantPools[plot.id % CROWN_COLOR_COUNT].setMatrixAt(plot.id, treeMatrix);
    shadowPool.setMatrixAt(plot.id, treeMatrix);
  }
  for (const vp of variantPools) vp.instanceMatrix.needsUpdate = true;
  shadowPool.instanceMatrix.needsUpdate = true;
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
      accumulator += dt; // was missing: the simulation never stepped before this fix
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
      if (testWorkerModel) animateWorker(testWorkerModel, 'idle', dt);
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

// Fill planet: set ALL 1500 plots to grown, sync trees, toast real visible count.
(window as any).__fillTrees = () => {
  try {
    const verdant2 = state.planets.verdant;
    verdant2.plots = [];
    for (const plot of grid.plots) {
      verdant2.plots.push({
        id: plot.id,
        dir: { ...plot.dir },
        state: 'grown',
        timer: 0,
        reservedBy: undefined,
        woodLeft: 0,
      });
    }
    verdant2.usablePlotCount = verdant2.plots.length;
    // Workers keep standing but lose their target: every plot is grown now.
    for (const w of verdant2.workers) {
      w.state = 'idle';
      w.target = undefined;
      w.plantTimer = undefined;
      w.stuckTimer = 0;
      w.stateTimer = 0;
    }
    syncTrees();
    const visible = countVisibleTrees();
    logEvent(`__fillTrees: ${verdant2.plots.length}/${grid.plots.length} grown, ${visible} visible`);
    updateDevStats(verdant2.plots.length, debugFPS);
    uiNeedsUpdate = true;
    showToast(`Fill: ${visible}/${verdant2.plots.length} trees visible`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError('Fill planet failed', msg);
    showToast(`Fill failed: ${msg}`);
    logEvent(`__fillTrees FAILED: ${msg}`);
  }
};

// Test tree: place one big grown tree in front of camera for 5 seconds
(window as any).__testTree = () => {
  testTree();
};

// Clear planet: set ALL plots to empty, sync trees, toast real visible count.
(window as any).__clearTrees = () => {
  try {
    const verdant2 = state.planets.verdant;
    verdant2.plots = [];
    verdant2.usablePlotCount = 0;
    // Keep workers but release every reservation and stop them.
    for (const w of verdant2.workers) {
      w.state = 'idle';
      w.target = undefined;
      w.plantTimer = undefined;
      w.stuckTimer = 0;
      w.stateTimer = 0;
    }
    syncTrees();
    const visible = countVisibleTrees();
    logEvent(`__clearTrees: cleared all, ${visible} visible`);
    updateDevStats(verdant2.plots.length, debugFPS);
    uiNeedsUpdate = true;
    showToast(`Clear: ${visible} trees visible`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError('Clear planet failed', msg);
    showToast(`Clear failed: ${msg}`);
    logEvent(`__clearTrees FAILED: ${msg}`);
  }
};

// Reset game (tap twice): new empty initial state, remove worker meshes, clear save, sync trees.
let resetConfirmTime = 0;
(window as any).__resetGame = () => {
  const now = Date.now();
  if (now - resetConfirmTime < 3000) {
    // Confirmed: in-place reset
    try {
      clearSave();
      state = initialState();
      state.lastSaved = Date.now();
      verdant = state.planets.verdant;
      // Remove all worker models and their GPU resources.
      for (const vw of workerVisuals.values()) {
        try { disposeWorkerModel(vw); } catch { /* ignore */ }
      }
      workerVisuals.clear();
      if (testWorkerModel) {
        try { disposeWorkerModel(testWorkerModel); } catch { /* ignore */ }
        testWorkerModel = null;
      }
      syncTrees();
      uiNeedsUpdate = true;
      lastTime = performance.now();
      accumulator = 0;
      showToast('Reset: empty planet');
      logEvent('__resetGame: reset complete, empty planet');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Reset failed', msg);
      logEvent(`__resetGame FAILED: ${msg}`);
    }
    return;
  }
  resetConfirmTime = now;
  showToast('Tap Reset again within 3s to confirm');
  logEvent('__resetGame: waiting for confirmation');
};

// Add credits (dev)
(window as any).__addCredits = (amt: number) => {
  state.currencies.credits = add(state.currencies.credits, amt);
  uiNeedsUpdate = true;
  logEvent(`__addCredits: +${amt}`);
};

// Spawn worker with sky-drop (dev)
(window as any).__spawnWorker = (role: Role) => {
  try {
    addWorker(role, true);
    uiNeedsUpdate = true;
    logEvent(`__spawnWorker: ${role} (free)`);
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
let logBoxHidden = true;
(window as any).__toggleLog = () => {
  logBoxHidden = !logBoxHidden;
  const lb = document.getElementById('ui-log-box');
  if (lb) lb.style.display = logBoxHidden ? 'none' : 'block';
  logEvent(`__toggleLog: ${logBoxHidden ? 'hidden' : 'shown'}`);
};

// Expose grid toggle
(window as any).__toggleGrid = toggleGridOverlay;

// Expose coverage stats for the dev menu debug display
(window as any).__getCoverageStats = (): string => {
  if (!grid) return 'Coverage: grid not ready';
  const plots = grid.plots;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  let yPos = 0, yNeg = 0, xPos = 0, xNeg = 0, zPos = 0, zNeg = 0;
  for (const p of plots) {
    const lat = Math.asin(Math.max(-1, Math.min(1, p.dir.y))) * 180 / Math.PI;
    const lon = Math.atan2(p.dir.z, p.dir.x) * 180 / Math.PI;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (p.dir.y > 0) yPos++; else if (p.dir.y < 0) yNeg++;
    if (p.dir.x > 0) xPos++; else if (p.dir.x < 0) xNeg++;
    if (p.dir.z > 0) zPos++; else if (p.dir.z < 0) zNeg++;
  }
  let meshInfo = '';
  if (variantPools) {
    for (let c = 0; c < variantPools.length; c++) meshInfo += ` variant${c}:${variantPools[c].count}`;
  }
  if (shadowPool) meshInfo += ` shadow:${shadowPool.count}`;
  if (logPool) meshInfo += ` log:${logPool.count}`;
  const equatorBand = grid.plots.filter((p: any) => Math.abs(p.dir.y) < 0.05).length;
  return `Plots: ${plots.length} | Y+:${yPos} Y-:${yNeg} X+:${xPos} X-:${xNeg} Z+:${zPos} Z-:${zNeg} equator:${equatorBand}${meshInfo}`;
};

// Workers debug: id, role, AI state, target plot id, remaining time in the state, position.
(window as any).__getWorkersDebug = (): string => {
  const verdant = state.planets.verdant;
  let lines = `Workers: ${verdant.workers.length} | tick: ${frameCount}`;
  for (const w of verdant.workers) {
    const left = w.stateTimer !== undefined ? ` left=${w.stateTimer.toFixed(1)}s` : '';
    lines += `\n  ${w.id} ${w.role} ${w.state} target=${w.target ?? '-'}${left} pos=(${w.pos.x.toFixed(2)},${w.pos.y.toFixed(2)},${w.pos.z.toFixed(2)})`;
  }
  return lines;
};

// Test worker: one model at 3x scale in front of the camera for 8 seconds, standing still.
let testWorkerTimer: number | null = null;
(window as any).__testWorker = () => {
  try {
    if (!sceneAPI) return;
    if (testWorkerModel) {
      try { disposeWorkerModel(testWorkerModel); } catch { /* ignore */ }
      testWorkerModel = null;
    }
    if (testWorkerTimer) { clearTimeout(testWorkerTimer); testWorkerTimer = null; }

    const vm = createWorkerModel('planter');
    const cam = sceneAPI.camera;
    const camPos = cam.position.clone();
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    const pos = camPos.clone().addScaledVector(camDir, 1.5);

    const up = new THREE.Vector3(0, 1, 0);
    const toCam = camPos.clone().sub(pos).normalize();
    const x = new THREE.Vector3().crossVectors(up, toCam).normalize();
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    vm.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
    vm.group.position.copy(pos);
    vm.group.scale.setScalar(3);
    sceneAPI.scene.add(vm.group);
    animateWorker(vm, 'idle', 0);
    testWorkerModel = vm;

    testWorkerTimer = window.setTimeout(() => {
      if (testWorkerModel) {
        try { disposeWorkerModel(testWorkerModel); } catch { /* ignore */ }
        testWorkerModel = null;
      }
      testWorkerTimer = null;
    }, 8000);
    logEvent('Test worker: model at 3x in front of camera for 8s');
    showToast('Test worker: 8 s');
  } catch (err) {
    showError('Test worker failed', err);
  }
};

// ===== Surface check: verify trees sit on (not inside / floating above) the planet =====
function meshRadiusOrSize(mesh: THREE.Mesh | THREE.LineSegments): string {
  if (!mesh.geometry) return 'no-geo';
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position;
  if (!pos) return 'no-pos';
  let min = Infinity, max = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return `min=${min.toFixed(3)} max=${max.toFixed(3)}`;
}

function matSummary(m: THREE.Material): string {
  const transparent = m.transparent === true ? 'T' : '-';
  const depthWrite = m.depthWrite === false ? 'F' : 'T';
  const side = m.side === THREE.BackSide ? 'back' : (m.side === THREE.DoubleSide ? 'double' : 'front');
  return `mat(transp=${transparent} depthWrite=${depthWrite} side=${side})`;
}

(window as any).__listMeshes = (): string => {
  const lines: string[] = [];
  const walk = (obj: THREE.Object3D, prefix: string): void => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      const s = obj.scale;
      lines.push(`${prefix}${obj.name || '(unnamed)'} [${obj.type}] scale=(${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}) worldScale=${obj.getWorldScale(new THREE.Vector3()).length().toFixed(2)} radius=${meshRadiusOrSize(obj)} renderOrder=${obj.renderOrder} ${obj.material ? matSummary(obj.material) : ''}`);
    }
    obj.children.forEach((c) => walk(c, prefix + '  '));
  };
  walk(sceneAPI?.scene ?? new THREE.Scene(), '');
  return lines.join('\n');
};

(window as any).__surfaceCheck = (): void => {
  try {
    if (!grid || !planetMesh || !sceneAPI) { showToast('Surface check: scene not ready'); return; }
    const cam = sceneAPI.camera;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();

    // Real surface radius from the planet mesh vertices (max distance from origin)
    const posAttr = (planetMesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
    let maxSurf = 0, minSurf = Infinity;
    for (let i = 0; i < posAttr.count; i++) {
      const d = Math.sqrt(posAttr.getX(i) ** 2 + posAttr.getY(i) ** 2 + posAttr.getZ(i) ** 2);
      if (d > maxSurf) maxSurf = d;
      if (d < minSurf) minSurf = d;
    }
    const meshWorldScale = planetMesh.getWorldScale(new THREE.Vector3()).length();

    // 8 sample plots: nearest to camera + 7 spread around
    const samples: any[] = [];
    const nearest = grid.plots.reduce((best: any, p: any) => {
      const dot = p.dir.x * camDir.x + p.dir.y * camDir.y + p.dir.z * camDir.z;
      return !best || dot > best.dot ? { plot: p, dot } : best;
    }, null as { plot: any; dot: number } | null);
    if (nearest) samples.push(nearest.plot);
    const step = Math.max(1, Math.floor(grid.plots.length / 7));
    for (let i = step; i < grid.plots.length && samples.length < 8; i += step) samples.push(grid.plots[i]);

    const baseRadius = surfaceRadius - 0.01;
    let lines = `Surface check:\n geomRadius=${planetRadius.toFixed(4)} PLANET_RADIUS=${PLANET_RADIUS.toFixed(4)}`;
    lines += `\n realSurf max=${maxSurf.toFixed(4)} min=${minSurf.toFixed(4)} meshWorldScale=${meshWorldScale.toFixed(4)} surfaceRadius(used)=${surfaceRadius.toFixed(4)} baseRadius=${baseRadius.toFixed(4)}`;
    lines += `\n camera near=0.05 far=2000 planet depthWrite=true (MeshStandard) outline depthWrite=false renderOrder=-1`;
    for (const p of samples) {
      const verdict = maxSurf > baseRadius + 0.001 ? 'BURIED' : 'OK';
      lines += `\n plot${p.id} baseDist=${baseRadius.toFixed(4)} dir=(${p.dir.x.toFixed(2)},${p.dir.y.toFixed(2)},${p.dir.z.toFixed(2)}) ${verdict}`;
    }
    // tree mesh counts + instances with scale > 0.5
    let trunkVisible = 0, crownVisible = 0;
    const verdant = state.planets.verdant;
    for (const p of verdant.plots) {
      const s = stageScaleFor(p.state);
      if (s > 0.5) { trunkVisible++; crownVisible++; }
    }
    lines += `\n tree meshes: variant.count=${variantPools?.[0]?.count ?? 0} shadow.count=${shadowPool?.count ?? 0} log.count=${logPool?.count ?? 0}`;
    lines += `\n instances scale>0.5: trunk=${trunkVisible} crown=${crownVisible}`;
    const msg = lines;
    logEvent(msg);
    showToast(msg.split('\n').slice(0, 4).join(' | '));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError('Surface check failed', msg);
    showToast(`Surface check failed: ${msg}`);
    logEvent(`Surface check FAILED: ${msg}`);
  }
};

(window as any).__togglePlotDots = (): void => {
  try {
    if (!grid || !sceneAPI) return;
    if (plotDotsVisible) {
      if (plotDotsMesh) { planetGroup.remove(plotDotsMesh); plotDotsMesh = null; }
      plotDotsVisible = false;
      showToast('Plot dots: off');
      logEvent('Plot dots off');
      return;
    }
    const geo = new THREE.SphereGeometry(0.03, 8, 8);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }), PLOT_COUNT);
    mesh.name = 'plot-dots';
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    const color = new THREE.Color();
    const dummy = new THREE.Object3D();
    const verdant = state.planets.verdant;
    const plotState = new Map<number, string>(verdant.plots.map((p) => [p.id, p.state]));
    for (let i = 0; i < PLOT_COUNT; i++) {
      const p = grid.plots[i];
      const st = plotState.get(p.id) ?? 'empty';
      color.set(st === 'empty' ? 0x888888 : st === 'sapling' ? 0xffeb3b : st === 'medium' ? 0xff9800 : 0x4caf50);
      dummy.position.set(p.dir.x * PLANET_RADIUS * 1.003, p.dir.y * PLANET_RADIUS * 1.003, p.dir.z * PLANET_RADIUS * 1.003);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    plotDotsMesh = mesh;
    planetGroup.add(mesh);
    plotDotsVisible = true;
    showToast(`Plot dots: on (${PLOT_COUNT})`);
    logEvent(`Plot dots on: ${PLOT_COUNT} dots`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError('Plot dots failed', msg);
    logEvent(`Plot dots FAILED: ${msg}`);
  }
};

// Apply URL parameters (?fill=1, ?clear=1, ?reset=1, ?menu=1)
applyUrlParams();

requestAnimationFrame(() => {
  requestAnimationFrame(updateViewport);
});

requestAnimationFrame(loop);


