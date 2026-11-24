// Lumberjack AI: strictly only chops FULLY GROWN, unreserved plots, stands
// beside the trunk and never wanders. Falls back to hauling one log himself
// when there are no carriers (LUMBERJACK_SELF_HAUL).

import {
  WORLD_CONFIG,
  TRADE_POST_DIR,
  LOG_LOGS_PER_PILE,
} from '../config/world';
import { WORKER_RUN_SPEED, WORKER_STUCK_SECONDS } from '../config/worker';
import { recordLogTaken, sellDeliveredLogs } from '../wood';
import {
  angularDist,
  dirFromPos,
  dirToPos,
  advance,
  standSpotDir,
  tangentTowards,
} from './motion';
import { chopSpeedMult } from '../config/upgrades';
import type { GameState, Plot, Vec3, Worker } from '../state';

const CHOP_SECONDS = WORLD_CONFIG.chopTime;
const FALL_SECONDS = WORLD_CONFIG.fallTime;
const STANDING = WORLD_CONFIG.standingOffset;
const CHOP_MAX_DISTANCE = WORLD_CONFIG.chopMaxDistance;
const RETRY = WORLD_CONFIG.lumberjackRetry;
const SELF_HAUL = WORLD_CONFIG.lumberjackSelfHaul;
const DELIVER_SECONDS = 0.6;

function release(w: Worker, plots: Plot[]): void {
  if (w.target === undefined) return;
  const plot = plots.find((p) => p.id === w.target);
  if (plot && plot.reservedBy === w.id) plot.reservedBy = undefined;
}

function goIdle(w: Worker): void {
  w.state = 'idle';
  w.target = undefined;
  w.stuckTimer = 0;
  w.chopTimer = undefined;
  w.actionTimer = undefined;
  w.stateTimer = 0;
  w.carryingLogs = 0;
}

function findGrown(w: Worker, plots: Plot[]): Plot | undefined {
  const myDir = dirFromPos(w.pos);
  let best: Plot | undefined;
  let bestD = Infinity;
  for (const p of plots) {
    if (p.state !== 'grown' || p.reservedBy !== undefined) continue;
    const d = angularDist(myDir, p.dir);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function findPile(w: Worker, plots: Plot[]): Plot | undefined {
  const myDir = dirFromPos(w.pos);
  let best: Plot | undefined;
  let bestD = Infinity;
  for (const p of plots) {
    if (p.state !== 'logs' || (p.woodLeft ?? 0) <= 0 || p.reservedBy !== undefined || p.beingCollected) continue;
    const d = angularDist(myDir, p.dir);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function hasCarrier(game: GameState): boolean {
  return game.planets.verdant.workers.some((w) => w.role === 'carrier');
}

function startWalk(w: Worker, plot: Plot): void {
  plot.reservedBy = w.id;
  w.target = plot.id;
  w.standDir = standSpotDir(plot.dir, dirFromPos(w.pos), STANDING);
  w.state = 'walking';
  w.stuckTimer = 0;
  w.stateTimer = (angularDist(dirFromPos(w.pos), w.standDir) * WORLD_CONFIG.planetRadius) / WORKER_RUN_SPEED;
}

/** Home position of the fallen tree: away from the lumberjack, tangent to the surface. */
export function fallDirectionAwayFrom(plotDir: Vec3, workerDir: Vec3): Vec3 {
  return tangentTowards(workerDir, plotDir);
}

/** Angle of the falling tree for the render layer (ease-in, clamped to 90 deg). */
export function fallAngle(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return (Math.PI / 2) * Math.pow(t, 1.7);
}

export function updateLumberjack(w: Worker, plots: Plot[], game: GameState, dt: number): void {
  const planet = game.planets.verdant;

  switch (w.state) {
    case 'idle': {
      w.stateTimer = Math.max(0, (w.stateTimer ?? 0) - dt);
      if (w.stateTimer > 0) return;
      const tree = findGrown(w, plots);
      if (tree) { startWalk(w, tree); return; }
      if (SELF_HAUL && !hasCarrier(game)) {
        const pile = findPile(w, plots);
        if (pile) { startWalk(w, pile); return; }
      }
      w.state = 'waiting';
      w.stuckTimer = 0;
      w.stateTimer = RETRY;
      return;
    }

    case 'waiting': {
      w.stuckTimer += dt;
      const tree = findGrown(w, plots);
      if (tree) { startWalk(w, tree); return; }
      if (SELF_HAUL && !hasCarrier(game)) {
        const pile = findPile(w, plots);
        if (pile) { startWalk(w, pile); return; }
      }
      if (w.stuckTimer >= WORKER_STUCK_SECONDS) w.stuckTimer = 0;
      w.stateTimer = Math.max(0, RETRY - (w.stuckTimer % RETRY));
      return;
    }

    case 'walking': {
      w.stuckTimer += dt;
      const plot = plots.find((p) => p.id === w.target);
      const valid = plot && plot.reservedBy === w.id && (plot.state === 'grown' || plot.state === 'logs');
      if (!valid) {
        release(w, plots);
        goIdle(w);
        return;
      }
      // If player started collecting this pile, abort
      if (plot.state === 'logs' && plot.beingCollected) {
        release(w, plots);
        goIdle(w);
        return;
      }
      if (w.stuckTimer > WORKER_STUCK_SECONDS) {
        release(w, plots);
        goIdle(w);
        return;
      }

      const stand = w.standDir ?? standSpotDir(plot.dir, dirFromPos(w.pos), STANDING);
      const adv = advance(w.pos, stand, WORKER_RUN_SPEED, dt);
      w.pos = dirToPos(adv.dir);
      w.stateTimer = (adv.remaining * WORLD_CONFIG.planetRadius) / WORKER_RUN_SPEED;
      if (!adv.arrived) return;

      // Arrival: re-check the plot, then require the standing distance for chopping.
      const standingDist = angularDist(plot.dir, dirFromPos(w.pos)) * WORLD_CONFIG.planetRadius;
      if (plot.state === 'grown') {
        if (standingDist > CHOP_MAX_DISTANCE) { w.stateTimer = 0; return; }
        w.state = 'chopping';
        w.chopTimer = CHOP_SECONDS;
        w.stateTimer = CHOP_SECONDS;
        w.stuckTimer = 0;
      } else {
        w.state = 'picking';
        w.actionTimer = WORLD_CONFIG.pickupTime;
        w.stateTimer = WORLD_CONFIG.pickupTime;
        w.stuckTimer = 0;
      }
      return;
    }

case 'chopping': {
      w.stuckTimer += dt;
      const plot = plots.find((p) => p.id === w.target);
      if (!plot || plot.state !== 'grown' || plot.reservedBy !== w.id) {
        release(w, plots);
        goIdle(w);
        return;
      }
      if (w.stuckTimer > WORKER_STUCK_SECONDS) {
        release(w, plots);
        goIdle(w);
        return;
      }
      const chopMult = chopSpeedMult(game.upgrades.chopSpeed);
      const effective = CHOP_SECONDS * chopMult;
      w.chopTimer = Math.max(0, (w.chopTimer ?? effective) - dt);
      w.stateTimer = w.chopTimer;
      if (w.chopTimer > 0) return;

      // Tree falls away from the lumberjack; core owns the falling timer.
      plot.fallDir = fallDirectionAwayFrom(plot.dir, dirFromPos(w.pos));
      plot.state = 'falling';
      plot.timer = FALL_SECONDS;
      plot.reservedBy = undefined;
      planet.treesHarvested += 1;
      goIdle(w);
      return;
    }

    case 'picking': {
      w.stuckTimer += dt;
      const plot = plots.find((p) => p.id === w.target);
      if (!plot || plot.state !== 'logs' || plot.reservedBy !== w.id || (plot.woodLeft ?? 0) <= 0) {
        release(w, plots);
        goIdle(w);
        return;
      }
      // If player started collecting, stop picking and go idle
      if (plot.beingCollected && plot.collectQueue !== undefined && plot.collectQueue > 0) {
        release(w, plots);
        goIdle(w);
        return;
      }
      w.actionTimer = Math.max(0, (w.actionTimer ?? WORLD_CONFIG.pickupTime) - dt);
      w.stateTimer = w.actionTimer;
      if (w.actionTimer > 0) {
        if (w.stuckTimer > WORKER_STUCK_SECONDS) { release(w, plots); goIdle(w); }
        return;
      }
      const take = Math.min(1, plot.woodLeft ?? 0);
      plot.woodLeft = (plot.woodLeft ?? 0) - take;
      if (take > 0) recordLogTaken(game, w.id, plot.id, 'lumberjack');
      if (plot.woodLeft <= 0) {
        plot.state = 'empty';
        plot.woodLeft = 0;
      }
      plot.reservedBy = undefined;
      w.carryingLogs = take;
      w.state = 'carrying';
      w.target = undefined;
      w.stuckTimer = 0;
      w.stateTimer = 0;
      return;
    }

    case 'carrying': {
      w.stuckTimer += dt;
      const adv = advance(w.pos, TRADE_POST_DIR, WORKER_RUN_SPEED * WORLD_CONFIG.carrySpeedFactor, dt);
      w.pos = dirToPos(adv.dir);
      w.stateTimer = (adv.remaining * WORLD_CONFIG.planetRadius) / (WORKER_RUN_SPEED * WORLD_CONFIG.carrySpeedFactor);
      if (adv.arrived) {
        w.state = 'delivering';
        w.actionTimer = DELIVER_SECONDS;
        w.stateTimer = DELIVER_SECONDS;
        w.stuckTimer = 0;
      } else if (w.stuckTimer > WORKER_STUCK_SECONDS) {
        goIdle(w);
      }
      return;
    }

    case 'delivering': {
      w.stuckTimer += dt;
      w.actionTimer = Math.max(0, (w.actionTimer ?? DELIVER_SECONDS) - dt);
      w.stateTimer = w.actionTimer;
      if (w.actionTimer > 0) return;
      const logs = Math.min(LOG_LOGS_PER_PILE, w.carryingLogs ?? 1);
      sellDeliveredLogs(game, logs);
      w.carryingLogs = 0;
      goIdle(w);
      return;
    }
  }

  release(w, plots);
  goIdle(w);
}

