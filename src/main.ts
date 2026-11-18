import * as THREE from 'three';
import { initialState } from './core/state';
import { tick } from './core/sim';
import { load, save, clearSave } from './core/save';
import { upgradeCost, plantSpeedMult, chopSpeedMult, woodValueMult, UPGRADES } from './core/config/upgrades';
import { WORLD_CONFIG, PLOT_COUNT, PLANET_RADIUS, GROW_STAGE_SECONDS, GROW_POP_SECONDS, LOG_LOGS_PER_PILE, LOG_BOTTOM_Y, LOG_TOP_Y, LOG_RADIUS, LOG_YAW_JITTER, LOG_PILE_CAPACITY } from './core/config/world';
import { WORKER_SCALE, WORKER_APPEAR_SECONDS } from './core/config/worker';
import { hireWorker } from './core/workers';
import { buildGrid } from './core/grid';
import { add, gte, format } from './core/money';
import { seedEmptyPlots, fillPlanet, clearPlanet, resetGame, countPlotStates, sweepReservations, growAllTrees, spawnLogPiles, logsWaiting, buyUpgrade } from './core/game';
import Decimal from 'break_infinity.js';
import type { GameState, Role, UpgradeId, Plot } from './core/state';

import { createScene, SceneAPI } from './render/scene';
import { createPlanetMesh, createTreeVariantGeometry, createLogGeometry, createContactShadowGeometry, treeMaterials, CROWN_COLORS, CROWN_COLOR_COUNT } from './render/planet';
import { createWorkerModel, animateWorker, placeWorkerModel, tangentTowards, disposeWorkerModel, WorkerModel } from './render/worker';
import { ParticleSystem } from './render/particles';
import { FloatingTextPool } from './render/floaters';
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

// Planet-local pooled debris + floating "+1" labels.
let particles: ParticleSystem | null = null;
let floaters: FloatingTextPool | null = null;
try {
  if (sceneAPI) {
    particles = new ParticleSystem(planetGroup);
    floaters = new FloatingTextPool(sceneAPI.camera, planetGroup);
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

// ===== Tree InstancedMeshes: merged tree variants, log piles, shadows, falling trees =====
let variantPools: THREE.InstancedMesh[] = [];
let treeGeometries: THREE.BufferGeometry[] = [];
let logPool: THREE.InstancedMesh;
let shadowPool: THREE.InstancedMesh;
let treeMatrix: THREE.Matrix4;
let treeScale: THREE.Vector3;
let dirtyTreeSet: Set<number>;
let swayFrame = 0;
let testTreeTimer: number | null = null;
let plotDotsMesh: THREE.InstancedMesh | null = null;
let plotDotsVisible = false;

// Falling trees: one pool per crown color, capacity WORLD_CONFIG.maxFallingTrees.
let fallingPools: THREE.InstancedMesh[] = [];
const fallingPrevCounts = [0, 0, 0, 0];

const HIDDEN = new THREE.Matrix4().compose(
  new THREE.Vector3(0, -999, 0),
  new THREE.Quaternion(0, 0, 0, 1),
  new THREE.Vector3(0.001, 0.001, 0.001),
);

function hideInstance(pool: THREE.InstancedMesh, index: number): void {
  if (index >= 0 && index < pool.count) pool.setMatrixAt(index, HIDDEN);
}

function setupTreePools(): void {
  const { shadow } = treeMaterials();
  const treeMatOpts = { vertexColors: true, roughness: 0.92, metalness: 0, emissive: 0x000000 };

  // Remove any previously created pools so rebuilds don't stack duplicates
  if (variantPools) {
    for (const vp of variantPools) if (vp) planetGroup.remove(vp);
  }
  if (fallingPools) {
    for (const fp of fallingPools) if (fp) planetGroup.remove(fp);
  }
  if (logPool) planetGroup.remove(logPool);
  if (shadowPool) planetGroup.remove(shadowPool);

  variantPools = [];
  fallingPools = [];
  treeGeometries = [];
  for (let c = 0; c < CROWN_COLOR_COUNT; c++) {
    const geo = createTreeVariantGeometry(CROWN_COLORS[c]);
    treeGeometries.push(geo);
    const mat = new THREE.MeshStandardMaterial(treeMatOpts);
    const vp = new THREE.InstancedMesh(geo, mat, PLOT_COUNT);
    vp.name = `tree-variant-pool-${c}`;
    vp.renderOrder = 3;
    vp.frustumCulled = false;
    planetGroup.add(vp);
    variantPools.push(vp);

    const fmat = new THREE.MeshStandardMaterial(treeMatOpts);
    const fp = new THREE.InstancedMesh(geo, fmat, WORLD_CONFIG.maxFallingTrees);
    fp.name = `tree-falling-pool-${c}`;
    fp.renderOrder = 3;
    fp.frustumCulled = false;
    planetGroup.add(fp);
    fallingPools.push(fp);
  }
  const logGeo = createLogGeometry();
  const logMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: 0x000000 });
  const shadowGeo = createContactShadowGeometry();
  logPool = new THREE.InstancedMesh(logGeo, logMat, LOG_PILE_CAPACITY);
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
  for (let i = 0; i < PLOT_COUNT; i++) {
    for (const vp of variantPools) vp.setMatrixAt(i, HIDDEN);
    shadowPool.setMatrixAt(i, HIDDEN);
    dirtyTreeSet.add(i);
  }
  for (let i = 0; i < LOG_PILE_CAPACITY; i++) logPool.setMatrixAt(i, HIDDEN);
  for (const fp of fallingPools) {
    for (let i = 0; i < fp.count; i++) fp.setMatrixAt(i, HIDDEN);
    fp.instanceMatrix.needsUpdate = true;
  }
  for (const vp of variantPools) vp.instanceMatrix.needsUpdate = true;
  logPool.instanceMatrix.needsUpdate = true;
  shadowPool.instanceMatrix.needsUpdate = true;
}

try {
  setupTreePools();
} catch (err) { showError('setupTreePools failed', err); }

// ===== State: the ONE shared game object (created once, never replaced) =====
// Dev actions and Reset mutate this object in place, so the simulation, the
// planter AI, the renderer and the UI can never drift onto different copies.
let game: GameState;
try {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('reset') === '1') {
    clearSave();
    urlParams.delete('reset');
    window.history.replaceState({}, '', window.location.pathname);
  }
  game = load() ?? initialState();
  game.lastSaved = Date.now();
} catch (err) {
  showError('state init failed', err);
  game = initialState();
}
const state: GameState = game;
const verdant = state.planets.verdant;

// The grid is the only source of plot positions. Populate the shared state with
// all 1500 plots as 'empty': the planet renders bare, and planters HAVE targets.
try {
  verdant.workers.length = 0; // empty start: no workers restored from a save
  const n = seedEmptyPlots(state, grid.plots);
  logEvent(`state: ${n} plots seeded empty`);
} catch (err) { showError('seed plots failed', err); }

let lastTime = performance.now();
let accumulator = 0;

// ===== Worker visual models (one per worker in state, object pool keyed by worker id) =====
const workerVisuals = new Map<number, WorkerModel>();
const chopEmitCooldown = new Map<number, number>();
const prevWorkerState = new Map<number, string>();
let lastWorkerCount = -1;
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
      const ok = buyUpgrade(state, id);
      if (!ok) {
        const level = state.upgrades[id];
        const cost = upgradeCost(id, level);
        if (!gte(state.currencies.credits, cost)) {
          showToast(`Not enough credits for ${id} (need ${format(cost)})`);
        } else {
          showToast(`${id} is already at max level`);
        }
        return;
      }
      // "+1 level" floating text + small bump on the card button.
      const btn = document.getElementById(`ui-btn-${id}`);
      if (btn) {
        btn.classList.remove('pulse');
        void (btn as HTMLElement).offsetWidth;
        btn.classList.add('pulse');
      }
      floaters?.spawn(new THREE.Vector3(0, 1, 0), `+1 ${id}`);
      ui.bumpWood();
      uiNeedsUpdate = true;
    } catch (err) { showError(`setUpgradeHandler: ${err instanceof Error ? err.message : err}`); }
  });

  // Quick upgrade (green star): buy the cheapest affordable item among
  // hire planter, hire lumberjack, hire carrier and the three real upgrades.
  const quickBuy = document.getElementById('ui-quick-buy');
  if (quickBuy) {
    quickBuy.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const candidates: { id: UpgradeId; cost: Decimal }[] = [];
        for (const id of ['planter', 'lumberjack', 'carrier', 'plantSpeed', 'chopSpeed', 'woodValue'] as UpgradeId[]) {
          const cost = upgradeCost(id, state.upgrades[id]);
          if (gte(state.currencies.credits, cost)) candidates.push({ id, cost });
        }
        if (candidates.length === 0) {
          showToast('Nothing affordable yet');
          return;
        }
        candidates.sort((a, b) => a.cost.toNumber() - b.cost.toNumber());
        const target = candidates[0].id;
        const role = target === 'planter' || target === 'lumberjack' || target === 'carrier';
        if (role) {
          addWorker(target as Role);
        } else {
          buyUpgrade(state, target);
        }
        uiNeedsUpdate = true;
      } catch (err) { showError('quick buy failed', err); }
    });
  }

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
    diagEl.textContent = `ZOOM: dist=${dist.toFixed(2)} fov=${cam2.fov}Â° R=${planetRadius} scale=${planetGroup.scale.x.toFixed(2)} fill=${fill.toFixed(0)}%`;
    logEvent(`ZOOM DIAG: dist=${dist.toFixed(2)} fov=${cam2.fov} planetRadius=${planetRadius} scale=1 fill=${fill.toFixed(0)}%`);
  }
} catch (err) { showError('zoom diag failed', err); }

// Reset save button (trash icon) â€” opens dev menu only; never reloads.
// Reset game lives inside the dev menu with double-tap confirmation.
const btnResetSave = document.getElementById('ui-reset-save') as HTMLButtonElement;
if (btnResetSave) {
  btnResetSave.type = 'button';
  btnResetSave.addEventListener('click', (e) => {
    e.stopPropagation();
    openDevMenu();
  });
}

// ===== Worker visuals: sync one model per worker from the shared state =====
// Dev actions call this directly; the frame loop calls it too, so the models
// always match the same worker array the simulation uses.
function syncWorkers(): void {
  const workers = state.planets.verdant.workers;
  const live = new Set<number>();
  for (const w of workers) {
    live.add(w.id);
    if (!workerVisuals.has(w.id)) {
      const vm = createWorkerModel(w.role);
      vm.puffTimer = WORKER_APPEAR_SECONDS;
      workerVisuals.set(w.id, vm);
      planetGroup.add(vm.group);
    }
  }
  for (const [id, vm] of workerVisuals) {
    if (!live.has(id)) {
      disposeWorkerModel(vm);
      workerVisuals.delete(id);
      chopEmitCooldown.delete(id);
      prevWorkerState.delete(id);
    }
  }
  // Reservations can only be orphaned when a worker disappears.
  if (workers.length !== lastWorkerCount) {
    lastWorkerCount = workers.length;
    sweepReservations(state);
  }
}

function updateWorkerVisuals(dt: number): void {
  syncWorkers();
  const verdant = state.planets.verdant;

  for (const w of verdant.workers) {
    const vm = workerVisuals.get(w.id);
    if (!vm) continue;

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
    animateWorker(vm, w.state, dt, w.carryingLogs ?? 0);

    // Particle bursts driven by AI state transitions.
    const before = prevWorkerState.get(w.id);
    const targetPlot = w.target !== undefined ? verdant.plots.find((p) => p.id === w.target) : undefined;
    if (particles && targetPlot) {
      if (w.state === 'chopping') {
        let cd = (chopEmitCooldown.get(w.id) ?? 0) - dt;
        if (cd <= 0) {
          particles.emit('chip', targetPlot.dir, 0.15, 6);
          particles.emit('leaf', targetPlot.dir, 0.22, 2);
          cd = 0.85;
        }
        chopEmitCooldown.set(w.id, cd);
      } else {
        chopEmitCooldown.set(w.id, 0);
      }
      if (w.state === 'planting' && before !== 'planting') {
        particles.emit('bark', targetPlot.dir, 0.04, 6);
      }
    }
    prevWorkerState.set(w.id, w.state);

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
  if (plot.state === 'grown') return pop;
  if (plot.state === 'sapling') {
    const t = clamp01(1 - Math.max(0, plot.timer) / GROW_STAGE_SECONDS[0]);
    return (0.35 + (0.65 - 0.35) * t) * pop;
  }
  if (plot.state === 'medium') {
    const t = clamp01(1 - Math.max(0, plot.timer) / GROW_STAGE_SECONDS[1]);
    return (0.65 + (1.0 - 0.65) * t) * pop;
  }
  return 0.0001;
}

// Shared transform for a plot's tree: trunk, crown and shadow all use the SAME matrix.
// position = dir * R, quaternion = align +Y with dir then yaw by hash angle, uniform scale.
// Never rotate/translate trunk separately; the cylinder is already upright along Y.
function writeTreeMatrices(plot: Plot): void {
  const dir = new THREE.Vector3(plot.dir.x, plot.dir.y, plot.dir.z);
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  dir.divideScalar(len);

  const basePos = new THREE.Vector3(dir.x * (surfaceRadius + 0.002), dir.y * (surfaceRadius + 0.002), dir.z * (surfaceRadius + 0.002));

  const upAxis = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(upAxis, dir);
  if (!q || !isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || !isFinite(q.w)) {
    q.set(0, 0, 0, 1);
  }
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, hashAngle(plot.id)));

  const vp = variantPools[plot.id % CROWN_COLOR_COUNT];
  const hasTree = plot.state === 'sapling' || plot.state === 'medium' || plot.state === 'grown';

  if (hasTree) {
    const s = Math.max(0.0001, plotScale(plot));
    treeMatrix.compose(basePos, q, treeScale.set(s, s, s));
    const m = treeMatrix.elements;
    let bad = false;
    for (let i = 0; i < 16; i++) {
      if (!isFinite(m[i])) { bad = true; break; }
    }
    if (bad) {
      logEvent(`Tree matrix NaN skipped: plot ${plot.id}`);
      hideInstance(vp, plot.id);
      hideInstance(shadowPool, plot.id);
    } else {
      // Same matrix for trunk+crown (merged variant pool) and shadow -> trunk attaches to crown, no gap
      vp.setMatrixAt(plot.id, treeMatrix);
      shadowPool.setMatrixAt(plot.id, treeMatrix);
    }
  } else {
    // 'empty', 'logs' and 'falling' plots show no standing tree.
    hideInstance(vp, plot.id);
    hideInstance(shadowPool, plot.id);
  }

  // Log pile: 3 instances per plot, only visible while the plot holds logs.
  for (let k = 0; k < LOG_LOGS_PER_PILE; k++) hideInstance(logPool, plot.id * LOG_LOGS_PER_PILE + k);
  if (plot.state === 'logs') writeLogPile(plot, basePos, q);
}

// Lay 1-3 logs in a small pyramid on the plot, axis along the local tangent X.
function writeLogPile(plot: Plot, basePos: THREE.Vector3, baseQ: THREE.Quaternion): void {
  const count = Math.min(LOG_LOGS_PER_PILE, Math.max(0, plot.woodLeft ?? 0));
  if (count === 0) return;
  const yawJitter = (hashAngle(plot.id * 7 + 1) / (Math.PI * 2) - 0.5) * 2 * LOG_YAW_JITTER;
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawJitter);
  const one = new THREE.Vector3(1, 1, 1);
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    if (k === 2) local.set(0, LOG_TOP_Y, 0);
    else local.set(k === 0 ? -(LOG_RADIUS + 0.002) : LOG_RADIUS + 0.002, LOG_BOTTOM_Y, 0);
    world.copy(local).applyQuaternion(yawQ).applyQuaternion(baseQ).add(basePos);
    treeMatrix.compose(world, baseQ, one);
    logPool.setMatrixAt(plot.id * LOG_LOGS_PER_PILE + k, treeMatrix);
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
const prevPlotStates: string[] = [];
const prevWoodLeft: number[] = [];
let fallingTotal = 0;

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

  // Mark plots whose stage / pile size changed, plus everything currently animating.
  fallingTotal = 0;
  for (let i = 0; i < verdant.plots.length; i++) {
    const p = verdant.plots[i];
    if (p.state === 'falling') fallingTotal += 1;
    const wood = p.woodLeft ?? 0;
    if (prevPlotStates[i] !== p.state || prevWoodLeft[i] !== wood) {
      // Wood-chip / leaf bursts the moment a tree starts falling, landing dust on impact.
      if (particles) {
        if (p.state === 'falling' && prevPlotStates[i] !== 'falling') {
          particles.emit('leaf', p.dir, 0.36, 14);
          particles.emit('chip', p.dir, 0.18, 8);
        } else if (p.state === 'logs' && prevPlotStates[i] === 'falling') {
          particles.emit('dust', p.dir, 0.02, 8);
        }
      }
      // Every log lifted off a pile: floating +1 above the plot and a Wood bump.
      if (prevPlotStates[i] === 'logs' && wood < prevWoodLeft[i]) {
        const lifted = prevWoodLeft[i] - wood;
        const pos = new THREE.Vector3(p.dir.x, p.dir.y, p.dir.z).multiplyScalar(surfaceRadius + 0.45);
        for (let k = 0; k < lifted; k++) floaters?.spawn(pos);
        if (lifted > 0) ui.bumpWood();
      }
      prevPlotStates[i] = p.state;
      prevWoodLeft[i] = wood;
      dirtyTreeSet.add(i);
    }
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

// ===== Falling trees: animate the whole merged tree tipping over, then shrinking =====
function updateFallingTrees(): void {
  if (fallingTotal === 0) {
    let stale = false;
    for (let c = 0; c < fallingPools.length; c++) if (fallingPrevCounts[c] > 0) stale = true;
    if (stale) {
      for (let c = 0; c < fallingPools.length; c++) {
        for (let i = 0; i < fallingPrevCounts[c]; i++) hideInstance(fallingPools[c], i);
        fallingPrevCounts[c] = 0;
        fallingPools[c].instanceMatrix.needsUpdate = true;
      }
    }
    return;
  }
  const counts = [0, 0, 0, 0];
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const fallDir = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const tilt = new THREE.Quaternion();
  const yawQ = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);

  for (const plot of state.planets.verdant.plots) {
    if (plot.state !== 'falling') continue;
    const c = plot.id % CROWN_COLOR_COUNT;
    const pool = fallingPools[c];
    const slot = counts[c];
    if (slot >= pool.count) continue;

    dir.set(plot.dir.x, plot.dir.y, plot.dir.z).normalize();
    pos.copy(dir).multiplyScalar(surfaceRadius + 0.002);
    const q = new THREE.Quaternion().setFromUnitVectors(upAxis, dir);
    q.premultiply(yawQ.setFromAxisAngle(dir, hashAngle(plot.id)));

    if (plot.fallDir) {
      fallDir.set(plot.fallDir.x, plot.fallDir.y, plot.fallDir.z).normalize();
      axis.crossVectors(dir, fallDir);
      if (axis.lengthSq() > 1e-8) {
        axis.normalize();
        const t = clamp01(1 - Math.max(0, plot.timer) / WORLD_CONFIG.fallTime);
        tilt.setFromAxisAngle(axis, (Math.PI / 2) * Math.pow(t, 1.7));
        q.premultiply(tilt);
      }
    }

    const shrinkT = clamp01((WORLD_CONFIG.fallShrinkTime - Math.max(0, plot.timer)) / WORLD_CONFIG.fallShrinkTime);
    const s = 1 - shrinkT * 0.9;
    treeMatrix.compose(pos, q, treeScale.set(s, s, s));
    pool.setMatrixAt(slot, treeMatrix);
    counts[c] = slot + 1;
  }

  for (let c = 0; c < fallingPools.length; c++) {
    const pool = fallingPools[c];
    for (let i = counts[c]; i < fallingPrevCounts[c]; i++) hideInstance(pool, i);
    fallingPrevCounts[c] = counts[c];
    pool.instanceMatrix.needsUpdate = true;
  }
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
  for (let k = 0; k < LOG_LOGS_PER_PILE; k++) hideInstance(logPool, k);

  // Hide all other instances temporarily
  const maxPlots = grid.plots.length;
  for (let i = 1; i < maxPlots; i++) {
    for (const vp of variantPools) hideInstance(vp, i);
    hideInstance(shadowPool, i);
    for (let k = 0; k < LOG_LOGS_PER_PILE; k++) hideInstance(logPool, i * LOG_LOGS_PER_PILE + k);
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
  const pos = new THREE.Vector3(dir.x * (surfaceRadius + 0.002), dir.y * (surfaceRadius + 0.002), dir.z * (surfaceRadius + 0.002));
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
      if (!isPaused) {
        // Speed multiplier scales how much sim time each real second feeds in,
        // while the fixed sim step stays DT (0.1 s).
        accumulator += dt * gameSpeedMult;
        const stepDt = DT;
        const steps = Math.floor(accumulator / stepDt);
        const stepped = Math.min(steps, 30);
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
      updateFallingTrees();
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
      particles?.update(dt);
      floaters?.update(dt);
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

// Fill planet: every plot grown in the shared state -> sync -> read back from
// the rendered instance matrices and from the state.
(window as any).__fillTrees = () => {
  try {
    const n = fillPlanet(state, grid.plots);
    syncTrees();
    syncWorkers();
    const counts = countPlotStates(state);
    const visible = countVisibleTrees();
    logEvent(`Fill: state ${counts.grown} grown, ${visible} trees visible`);
    updateDevStats(n, debugFPS);
    uiNeedsUpdate = true;
    showToast(`Fill: state ${counts.grown} grown, ${visible} trees visible`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError('Fill planet failed', err);
    showToast(`Fill failed: ${msg}`);
    logEvent(`__fillTrees FAILED: ${msg}`);
  }
};

// Test tree: place one big grown tree in front of camera for 5 seconds
(window as any).__testTree = () => {
  testTree();
};

// Clear planet: every plot empty again (full grid kept), workers kept + idle.
(window as any).__clearTrees = () => {
  try {
    clearPlanet(state, grid.plots);
    syncTrees();
    syncWorkers();
    const counts = countPlotStates(state);
    const visible = countVisibleTrees();
    const workers = state.planets.verdant.workers.length;
    logEvent(`Clear: ${visible} trees visible, ${workers} workers kept, ${counts.empty} empty plots`);
    updateDevStats(counts.total, debugFPS);
    uiNeedsUpdate = true;
    showToast(`Clear: ${visible} trees visible, ${workers} workers kept, ${counts.empty} empty plots`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError('Clear planet failed', err);
    showToast(`Clear failed: ${msg}`);
    logEvent(`__clearTrees FAILED: ${msg}`);
  }
};

// Reset game (tap twice within 3s, or force): mutate the SAME game object,
// wipe save + worker meshes + particles, then re-sync everything.
let resetConfirmTime = 0;
(window as any).__resetGame = (force?: boolean) => {
  const now = Date.now();
  const confirmed = force === true || now - resetConfirmTime < 3000;
  if (confirmed) {
    try {
      resetConfirmTime = 0;
      clearSave();
      resetGame(state); // in place: no new object, no stale aliases
      seedEmptyPlots(state, grid.plots); // full empty grid => planters have targets

      for (const vm of workerVisuals.values()) {
        try { disposeWorkerModel(vm); } catch { /* ignore */ }
      }
      workerVisuals.clear();
      if (testWorkerModel) {
        try { disposeWorkerModel(testWorkerModel); } catch { /* ignore */ }
        testWorkerModel = null;
      }
      if (testWorkerTimer) { clearTimeout(testWorkerTimer); testWorkerTimer = null; }
      if (testTreeTimer) { clearTimeout(testTreeTimer); testTreeTimer = null; }
      try { particles?.clear(); floaters?.clear(); } catch { /* ignore */ }

      syncTrees();
      syncWorkers();
      const counts = countPlotStates(state);
      const visible = countVisibleTrees();
      const workers = state.planets.verdant.workers.length;
      const credits = format(state.currencies.credits);

      uiNeedsUpdate = true;
      lastTime = performance.now();
      accumulator = 0;
      showToast(`Reset: ${visible} trees, ${workers} workers, credits ${credits} (${counts.empty} empty plots)`);
      logEvent(`__resetGame: reset complete, ${visible} trees, ${workers} workers, credits ${credits}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Reset failed', err);
      showToast(`Reset failed: ${msg}`);
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

// Add Wood (visible counter and the amount queued for selling), dev only.
(window as any).__addWood = (amt = 10) => {
  try {
    state.wood = add(state.wood, amt);
    state.woodToSell = add(state.woodToSell, amt);
    ui.bumpWood();
    uiNeedsUpdate = true;
    showToast(`+${amt} wood`);
    logEvent(`__addWood: +${amt} (wood ${format(state.wood)})`);
  } catch (err) { showError('Add wood failed', err); }
};

// Emit one of each particle kind at the plot nearest the camera centre (dev).
(window as any).__emitTestParticles = () => {
  try {
    if (!particles || !sceneAPI) return;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(sceneAPI.camera.quaternion).normalize();
    let best = state.planets.verdant.plots[0];
    let bestDot = -Infinity;
    for (const p of state.planets.verdant.plots) {
      const dot = p.dir.x * camDir.x + p.dir.y * camDir.y + p.dir.z * camDir.z;
      if (dot > bestDot) { bestDot = dot; best = p; }
    }
    if (!best) return;
    particles.emit('chip', best.dir, 0.15, 10);
    particles.emit('leaf', best.dir, 0.25, 8);
    particles.emit('dust', best.dir, 0.02, 6);
    logEvent(`__emitTestParticles: ${particles.aliveCount} alive`);
  } catch (err) { showError('Emit test particles failed', err); }
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

// Grow every planted tree instantly (dev)
(window as any).__growAllTrees = () => {
  try {
    const n = growAllTrees(state);
    logEvent(`__growAllTrees: ${n} trees grown`);
    showToast(`Grew ${n} trees`);
    uiNeedsUpdate = true;
    return n;
  } catch (err) {
    showError('Grow all failed', err);
    return 0;
  }
};

// Spawn 10 random 3-log piles so the lumberjack/carrier chain can be inspected (dev)
(window as any).__spawnLogPiles = (count = 10) => {
  try {
    const n = spawnLogPiles(state, count);
    syncTrees();
    logEvent(`__spawnLogPiles: ${n} piles, ${logsWaiting(state)} logs waiting`);
    showToast(`${n} log piles spawned`);
    uiNeedsUpdate = true;
    return n;
  } catch (err) {
    showError('Spawn log piles failed', err);
    return 0;
  }
};

// Dev: +1 to every upgrade level (skips max), costs nothing.
(window as any).__upgradeAllPlus1 = () => {
  try {
    for (const id of ['plantSpeed', 'chopSpeed', 'woodValue', 'tapPower', 'maxTrees'] as const) {
      const max = (UPGRADES[id] as any).maxLevel;
      if (max !== undefined && state.upgrades[id] >= max) continue;
      state.upgrades[id] += 1;
    }
    uiNeedsUpdate = true;
    showToast('Upgrades +1 all');
    logEvent('__upgradeAllPlus1');
  } catch (err) { showError('upgradeAllPlus1 failed', err); }
};

// Dev: reset upgrade levels to 0.
(window as any).__upgradeReset = () => {
  try {
    for (const id of Object.keys(state.upgrades) as UpgradeId[]) {
      state.upgrades[id] = 0;
    }
    uiNeedsUpdate = true;
    showToast('Upgrades reset');
    logEvent('__upgradeReset');
  } catch (err) { showError('upgradeReset failed', err); }
};

// Dev: current multipliers for the dev menu line.
(window as any).__upgradeMultipliers = () => {
  return {
    plant: plantSpeedMult(state.upgrades.plantSpeed),
    chop: chopSpeedMult(state.upgrades.chopSpeed),
    value: woodValueMult(state.upgrades.woodValue),
  };
};

// Headless 5-minute wood-chain self test: 5 planters, 2 lumberjacks, 2 carriers.
(window as any).__runWoodSelfTest = () => {
  try {
    const sim = initialState();
    seedEmptyPlots(sim, grid.plots);
    const spawnDir = { x: 0, y: 0, z: 1 };
    for (let i = 0; i < 5; i++) hireWorker(sim, 'planter', { free: true, spawnDir });
    for (let i = 0; i < 2; i++) hireWorker(sim, 'lumberjack', { free: true, spawnDir });
    for (let i = 0; i < 2; i++) hireWorker(sim, 'carrier', { free: true, spawnDir });

    const steps = Math.round(300 / DT);
    for (let i = 0; i < steps; i++) tick(sim, DT);

    const counts = countPlotStates(sim);
    const stuck = sim.planets.verdant.workers.filter((w) => (w.stuckTimer ?? 0) > 0).length;
    const result = {
      steps,
      plots: counts.total,
      empty: counts.empty,
      sapling: counts.sapling,
      medium: counts.medium,
      grown: counts.grown,
      falling: counts.falling,
      logs: counts.logs,
      wood: format(sim.wood),
      woodToSell: format(sim.woodToSell),
      credits: format(sim.currencies.credits),
      harvested: sim.planets.verdant.treesHarvested,
      logsWaiting: logsWaiting(sim),
      stuck,
    };
    logEvent(`__runWoodSelfTest: ${JSON.stringify(result)}`);
    showToast(`Wood test: ${result.harvested} chopped, ${result.logs} piles, wood ${result.wood}`);
    return result;
  } catch (err) {
    showError('Wood self test failed', err);
    return null;
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

// Workers debug: worker count, empty plots, id, role, AI state, chosen target plot id,
// remaining time in the state and position.
(window as any).__getWorkersDebug = (): string => {
  const verdant = state.planets.verdant;
  const counts = countPlotStates(state);
  let lines = `Workers: ${verdant.workers.length} | empty plots: ${counts.empty} | plots: ${counts.total} | tick: ${frameCount}`;
  for (const w of verdant.workers) {
    const left = w.stateTimer !== undefined ? ` left=${w.stateTimer.toFixed(1)}s` : '';
    lines += `\n  ${w.id} ${w.role} ${w.state} target=${w.target ?? '-'}${left} pos=(${w.pos.x.toFixed(2)},${w.pos.y.toFixed(2)},${w.pos.z.toFixed(2)})`;
  }
  lines += `\nParticles alive: ${particles?.aliveCount ?? 0}`;
  return lines;
};

// Compact state summary used by the dev self-test.
(window as any).__getStateSummary = () => {
  const counts = countPlotStates(state);
  return {
    plots: counts.total,
    empty: counts.empty,
    sapling: counts.sapling,
    medium: counts.medium,
    grown: counts.grown,
    falling: counts.falling,
    logs: counts.logs,
    planted: counts.planted,
    harvested: state.planets.verdant.treesHarvested,
    logsWaiting: logsWaiting(state),
    wood: format(state.wood),
    woodToSell: format(state.woodToSell),
    visible: countVisibleTrees(),
    workers: state.planets.verdant.workers.length,
    credits: format(state.currencies.credits),
  };
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
      const dotColor = st === 'empty' ? 0x888888
        : st === 'sapling' ? 0xffeb3b
        : st === 'medium' ? 0xff9800
        : st === 'falling' ? 0xff7043
        : st === 'logs' ? 0x795548
        : 0x4caf50;
      color.set(dotColor);
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









