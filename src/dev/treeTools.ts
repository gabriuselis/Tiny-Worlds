import * as THREE from 'three';
import { fillPlanet, clearPlanet, countPlotStates, growAllTrees, spawnLogPiles, logsWaiting } from '../core/game';
import { updateDevStats, logEvent, showToast } from '../ui/ui';
import { ctx } from '../app/context';
import { planetRadius } from '../app/constants';
import { showError } from '../app/errors';
import { variantPools, variantSlots, shadowPool, shadowSlots, treeMatrix, treeScale, syncTrees, flagTreeBuffers } from '../app/trees';
import { showInstance, removeInstance } from '../app/instanceOps';
import { syncWorkers } from '../app/workerVisuals';
import { debugFPS } from './debugStats';

let testTreeTimer: number | null = null;
const TEST_TREE_KEY = -1;

function removeTestTree(): void {
  removeInstance(variantPools[0], variantSlots[0], TEST_TREE_KEY);
  removeInstance(shadowPool, shadowSlots, TEST_TREE_KEY);
  flagTreeBuffers();
}

export function resetTestTreeTimer(): void {
  if (testTreeTimer) { clearTimeout(testTreeTimer); testTreeTimer = null; removeTestTree(); }
}

// ===== Count trees whose instance scale > 0.5 (read back from the matrices) =====
export function countVisibleTrees(): number {
  let n = 0;
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const vp of variantPools) {
    for (let i = 0; i < vp.count; i++) {
      vp.getMatrixAt(i, m);
      m.decompose(p, q, s);
      if (s.x > 0.5) n++;
    }
  }
  return n;
}

// ===== Test tree: place one big grown tree in front of camera for 5 seconds =====
function testTree(): void {
  const sceneAPI = ctx.sceneAPI;
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
  showInstance(variantPools[0], variantSlots[0], TEST_TREE_KEY, treeMatrix);
  showInstance(shadowPool, shadowSlots, TEST_TREE_KEY, treeMatrix);
  flagTreeBuffers();

  // Remove after 5 seconds
  if (testTreeTimer) clearTimeout(testTreeTimer);
  testTreeTimer = setTimeout(() => {
    testTreeTimer = null;
    removeTestTree();
    logEvent('Test tree: removed');
  }, 5000);

  logEvent('Test tree: big tree placed in front of camera for 5s');
}

export function installTreeToolHooks(): void {
  // Fill planet: every plot grown in the shared state -> sync -> read back from
  // the rendered instance matrices and from the state.
  (window as any).__fillTrees = () => {
    try {
      const state = ctx.state;
      const n = fillPlanet(state, ctx.grid.plots);
      syncTrees();
      syncWorkers();
      const counts = countPlotStates(state);
      const visible = countVisibleTrees();
      logEvent(`Fill: state ${counts.grown} grown, ${visible} trees visible`);
      updateDevStats(n, debugFPS);
      ctx.uiNeedsUpdate = true;
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
      const state = ctx.state;
      clearPlanet(state, ctx.grid.plots);
      syncTrees();
      syncWorkers();
      const counts = countPlotStates(state);
      const visible = countVisibleTrees();
      const workers = state.planets.verdant.workers.length;
      logEvent(`Clear: ${visible} trees visible, ${workers} workers kept, ${counts.empty} empty plots`);
      updateDevStats(counts.total, debugFPS);
      ctx.uiNeedsUpdate = true;
      showToast(`Clear: ${visible} trees visible, ${workers} workers kept, ${counts.empty} empty plots`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Clear planet failed', err);
      showToast(`Clear failed: ${msg}`);
      logEvent(`__clearTrees FAILED: ${msg}`);
    }
  };

  // Grow every planted tree instantly (dev)
  (window as any).__growAllTrees = () => {
    try {
      const n = growAllTrees(ctx.state);
      logEvent(`__growAllTrees: ${n} trees grown`);
      showToast(`Grew ${n} trees`);
      ctx.uiNeedsUpdate = true;
      return n;
    } catch (err) {
      showError('Grow all failed', err);
      return 0;
    }
  };

  // Spawn 10 random 3-log piles so the lumberjack/carrier chain can be inspected (dev)
  (window as any).__spawnLogPiles = (count = 10) => {
    try {
      const n = spawnLogPiles(ctx.state, count);
      syncTrees();
      logEvent(`__spawnLogPiles: ${n} piles, ${logsWaiting(ctx.state)} logs waiting`);
      showToast(`${n} log piles spawned`);
      ctx.uiNeedsUpdate = true;
      return n;
    } catch (err) {
      showError('Spawn log piles failed', err);
      return 0;
    }
  };
}
