import * as THREE from 'three';
import { WORKER_SCALE, WORKER_APPEAR_SECONDS, WORKER_POOL } from '../core/config/worker';
import { hireWorker } from '../core/workers';
import { sweepReservations } from '../core/game';
import type { Role, Plot } from '../core/state';
import {
  createWorkerModel,
  animateWorker,
  placeWorkerModel,
  tangentTowards,
  disposeWorkerModel,
  getWorkerRenderer,
  WorkerModel,
} from '../render/worker';
import { showToast } from '../ui/ui';
import { ctx } from './context';
import { showError } from './errors';

// ===== Worker visual models (one per worker in state, object pool keyed by worker id) =====
export const workerVisuals = new Map<number, WorkerModel>();
const chopEmitCooldown = new Map<number, number>();
const prevWorkerState = new Map<number, string>();
let lastWorkerCount = -1;
const liveScratch = new Set<number>();
const dirScratch = new THREE.Vector3();
const targetDirScratch = new THREE.Vector3();

function workerRenderer() {
  return getWorkerRenderer(ctx.planetGroup, ctx.surfaceRadius + WORKER_POOL.boundsMargin);
}

// Plot arrays are normally indexed by id, so try that slot before scanning.
function findPlot(plots: Plot[], id: number): Plot | undefined {
  const direct = plots[id];
  if (direct && direct.id === id) return direct;
  return plots.find((p) => p.id === id);
}

// Random surface direction on the camera-facing side, away from the trade post.
function pickSpawnDir(): { x: number; y: number; z: number } {
  const fallback = { x: 0, y: 0, z: 1 };
  try {
    const cam = ctx.sceneAPI?.camera;
    if (!cam) return fallback;
    // Directions are stored in planet-local space, so bring the camera into that space.
    const cd = ctx.planetGroup.worldToLocal(cam.position.clone());
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

export function addWorker(role: Role, free = false) {
  try {
    const spawnDir = pickSpawnDir();
    const worker = hireWorker(ctx.state, role, { free, spawnDir });
    if (!worker) {
      showToast(`Not enough credits for ${role}`);
      return;
    }
    const vm = createWorkerModel(worker.role, workerRenderer());
    vm.puffTimer = WORKER_APPEAR_SECONDS;
    workerVisuals.set(worker.id, vm);
    ctx.uiNeedsUpdate = true;
  } catch (err) { showError(`addWorker: ${err instanceof Error ? err.message : err}`); }
}

// ===== Worker visuals: sync one model per worker from the shared state =====
// Dev actions call this directly; the frame loop calls it too, so the models
// always match the same worker array the simulation uses.
export function syncWorkers(): void {
  const state = ctx.state;
  const workers = state.planets.verdant.workers;
  for (const w of workers) {
    if (!workerVisuals.has(w.id)) {
      const vm = createWorkerModel(w.role, workerRenderer());
      vm.puffTimer = WORKER_APPEAR_SECONDS;
      workerVisuals.set(w.id, vm);
    }
  }
  // Every worker now has a model, so extra models exist only if the sizes differ.
  if (workerVisuals.size !== workers.length) {
    liveScratch.clear();
    for (const w of workers) liveScratch.add(w.id);
    for (const [id, vm] of workerVisuals) {
      if (!liveScratch.has(id)) {
        disposeWorkerModel(vm);
        workerVisuals.delete(id);
        chopEmitCooldown.delete(id);
        prevWorkerState.delete(id);
      }
    }
  }
  // Reservations can only be orphaned when a worker disappears.
  if (workers.length !== lastWorkerCount) {
    lastWorkerCount = workers.length;
    sweepReservations(state);
  }
}

export function updateWorkerVisuals(dt: number): void {
  syncWorkers();
  const { state, grid, particles, surfaceRadius } = ctx;
  const verdant = state.planets.verdant;

  for (const w of verdant.workers) {
    const vm = workerVisuals.get(w.id);
    if (!vm) continue;

    const dir = dirScratch.set(w.pos.x, w.pos.y, w.pos.z);
    if (dir.lengthSq() < 1e-10) dir.set(0, 0, 1);
    dir.normalize();

    // Face the direction of travel while running; keep the last facing otherwise.
    const moving = w.state === 'walking' || w.state === 'walk' || w.state === 'walkToPost';
    if (moving && w.target !== undefined && w.target >= 0) {
      const plot = findPlot(verdant.plots, w.target) ?? grid?.plotById.get(w.target);
      if (plot) {
        const tdir = targetDirScratch.set(plot.dir.x, plot.dir.y, plot.dir.z).normalize();
        tangentTowards(dir, tdir, vm.forward);
      }
    }

    placeWorkerModel(vm, dir, vm.forward, surfaceRadius + 0.001);
    animateWorker(vm, w.state, dt, w.carryingLogs ?? 0);

    // Particle bursts driven by AI state transitions.
    const before = prevWorkerState.get(w.id);
    const targetPlot = w.target !== undefined ? findPlot(verdant.plots, w.target) : undefined;
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
  workerRenderer().flush();
}
