import { PLANET_RADIUS, GROW_STAGE_SECONDS, GROW_POP_SECONDS } from '../config/world';
import {
  WORKER_MIN_RUN_SECONDS,
  WORKER_RUN_SPEED,
  WORKER_PLANT_SECONDS,
  WORKER_STUCK_SECONDS,
  WORKER_MODEL,
  WORKER_SCALE,
} from '../config/worker';
import { plantSpeedMult } from '../config/upgrades';
import type { GameState, Plot, Vec3, Worker } from '../state';

// Backwards-compatible named exports.
export const WORKER_HEIGHT = WORKER_MODEL.totalHeight * WORKER_SCALE;
export const WALK_SPEED = WORKER_RUN_SPEED;
export const PLANT_TIME = WORKER_PLANT_SECONDS;
export const STUCK_TIME = WORKER_STUCK_SECONDS;

// Minimum angular distance that corresponds to WORKER_MIN_RUN_SECONDS of running.
const MIN_RUN_ANGLE = (WORKER_MIN_RUN_SECONDS * WORKER_RUN_SPEED) / PLANET_RADIUS;
// Close enough to the plot centre to start planting.
const ARRIVE_EPS = 0.001;

export function dirFromPos(pos: Vec3): Vec3 {
  const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) || 1;
  return { x: pos.x / len, y: pos.y / len, z: pos.z / len };
}

function angularDist(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function travelSeconds(from: Vec3, to: Vec3): number {
  return (angularDist(from, to) * PLANET_RADIUS) / WORKER_RUN_SPEED;
}

// Spherical linear interpolation between unit vectors a and b by fraction t (0..1).
function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  if (dot > 0.9999) {
    return { x: a.x, y: a.y, z: a.z };
  }
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  if (s < 1e-6) return { x: a.x, y: a.y, z: a.z };
  const t1 = Math.sin((1 - t) * theta) / s;
  const t2 = Math.sin(t * theta) / s;
  return {
    x: a.x * t1 + b.x * t2,
    y: a.y * t1 + b.y * t2,
    z: a.z * t1 + b.z * t2,
  };
}

/**
 * Nearest free plot that guarantees at least WORKER_MIN_RUN_SECONDS of running.
 * If every free plot is closer than that, pick the farthest free plot instead.
 */
export function findTargetPlot(w: Worker, plots: Plot[]): Plot | undefined {
  const myDir = dirFromPos(w.pos);
  let best: Plot | undefined;
  let bestD = Infinity;
  let farthest: Plot | undefined;
  let farthestD = -Infinity;

  for (const p of plots) {
    if (p.state !== 'empty' || p.reservedBy !== undefined) continue;
    const d = angularDist(myDir, p.dir);
    if (d > farthestD) {
      farthestD = d;
      farthest = p;
    }
    if (d >= MIN_RUN_ANGLE && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ?? farthest;
}

function releasePlot(w: Worker, plots: Plot[]): void {
  if (w.target === undefined) return;
  const plot = plots.find((p) => p.id === w.target);
  if (plot && plot.reservedBy === w.id) plot.reservedBy = undefined;
}

function goIdle(w: Worker, idleSeconds = 0): void {
  w.state = 'idle';
  w.target = undefined;
  w.stuckTimer = 0;
  w.plantTimer = undefined;
  w.stateTimer = idleSeconds;
}

function startWalking(w: Worker, plot: Plot): void {
  plot.reservedBy = w.id;
  w.target = plot.id;
  w.state = 'walking';
  w.stuckTimer = 0;
  w.plantTimer = undefined;
  w.stateTimer = travelSeconds(dirFromPos(w.pos), plot.dir);
}

/**
 * Planter AI state machine (pure):
 *   spawn -> idle 0.5 s -> run >= 3 s -> plant 5 s -> idle -> next plot
 * Reservations guarantee two planters never pick the same plot.
 */
export function updatePlanter(w: Worker, plots: Plot[], gameState: GameState, dt: number): void {
  switch (w.state) {
    case 'idle': {
      w.stateTimer = Math.max(0, (w.stateTimer ?? 0) - dt);
      if (w.stateTimer > 0) return;
      const target = findTargetPlot(w, plots);
      if (!target) {
        w.state = 'waiting';
        w.stuckTimer = 0;
        w.stateTimer = WORKER_STUCK_SECONDS;
        return;
      }
      startWalking(w, target);
      return;
    }

    case 'waiting': {
      w.stuckTimer += dt;
      w.stateTimer = Math.max(0, WORKER_STUCK_SECONDS - w.stuckTimer);
      const target = findTargetPlot(w, plots);
      if (target) {
        startWalking(w, target);
        return;
      }
      if (w.stuckTimer >= WORKER_STUCK_SECONDS) {
        w.stuckTimer = 0;
        w.stateTimer = WORKER_STUCK_SECONDS;
      }
      return;
    }

    case 'walking': {
      w.stuckTimer += dt;
      const plot = plots.find((p) => p.id === w.target);
      if (!plot || plot.state !== 'empty' || plot.reservedBy !== w.id) {
        releasePlot(w, plots);
        goIdle(w);
        return;
      }
      if (w.stuckTimer > WORKER_STUCK_SECONDS) {
        releasePlot(w, plots);
        goIdle(w);
        return;
      }

      const curDir = dirFromPos(w.pos);
      const remaining = angularDist(curDir, plot.dir);
      const step = (WORKER_RUN_SPEED / PLANET_RADIUS) * dt;
      w.stateTimer = (remaining * PLANET_RADIUS) / WORKER_RUN_SPEED;

      if (remaining <= step + ARRIVE_EPS) {
        const R = PLANET_RADIUS;
        w.pos = { x: plot.dir.x * R, y: plot.dir.y * R, z: plot.dir.z * R };
        w.state = 'planting';
        w.plantTimer = WORKER_PLANT_SECONDS;
        w.stateTimer = WORKER_PLANT_SECONDS;
        w.stuckTimer = 0;
        return;
      }

      const newDir = slerp(curDir, plot.dir, step / remaining);
      w.pos = { x: newDir.x * PLANET_RADIUS, y: newDir.y * PLANET_RADIUS, z: newDir.z * PLANET_RADIUS };
      return;
    }

    case 'planting': {
      w.stuckTimer += dt;
      const plot = plots.find((p) => p.id === w.target);
      if (!plot || plot.reservedBy !== w.id) {
        goIdle(w);
        return;
      }
      if (w.stuckTimer > WORKER_STUCK_SECONDS) {
        releasePlot(w, plots);
        goIdle(w);
        return;
      }

      const plantMult = plantSpeedMult(gameState.upgrades.plantSpeed);
      w.plantTimer = Math.max(0, (w.plantTimer ?? WORKER_PLANT_SECONDS) - dt);
      w.stateTimer = w.plantTimer;
      if (w.plantTimer <= 0) {
        plot.state = 'sapling';
        plot.timer = GROW_STAGE_SECONDS[0] * plantMult;
        plot.reservedBy = undefined;
        plot.popTimer = GROW_POP_SECONDS;
        gameState.stats.treesPlanted += 1;
        goIdle(w);
      }
      return;
    }
  }

  // Unknown state: release anything held and recover to idle.
  releasePlot(w, plots);
  goIdle(w);
}
