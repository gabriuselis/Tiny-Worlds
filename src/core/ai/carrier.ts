// Carrier AI: collects log piles (nearest first) and delivers them to the
// trade post. A pile can only be reserved by one carrier at a time; the plot
// becomes 'empty' immediately when the last visible log is picked up.

import { WORLD_CONFIG, TRADE_POST_DIR, LOG_LOGS_PER_PILE } from '../config/world';
import { WORKER_RUN_SPEED, WORKER_STUCK_SECONDS } from '../config/worker';
import { recordLogTaken, sellDeliveredLogs } from '../wood';
import { angularDist, dirFromPos, dirToPos, advance, standSpotDir } from './motion';
import type { GameState, Plot, Worker } from '../state';

const PICKUP_SECONDS = WORLD_CONFIG.pickupTime;
const PER_LOG_SECONDS = PICKUP_SECONDS / LOG_LOGS_PER_PILE;
const CARRY_CAPACITY = WORLD_CONFIG.carryCapacity;
const STANDING = WORLD_CONFIG.standingOffset;
const RETRY = WORLD_CONFIG.lumberjackRetry;
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
  w.actionTimer = undefined;
  w.stateTimer = 0;
  w.carryingLogs = 0;
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

function startWalk(w: Worker, plot: Plot): void {
  plot.reservedBy = w.id;
  w.target = plot.id;
  w.standDir = standSpotDir(plot.dir, dirFromPos(w.pos), STANDING);
  w.state = 'walking';
  w.stuckTimer = 0;
  w.stateTimer = (angularDist(dirFromPos(w.pos), w.standDir) * WORLD_CONFIG.planetRadius) / WORKER_RUN_SPEED;
}

export function updateCarrier(w: Worker, plots: Plot[], game: GameState, dt: number): void {
  switch (w.state) {
    case 'idle': {
      w.stateTimer = Math.max(0, (w.stateTimer ?? 0) - dt);
      if (w.stateTimer > 0) return;
      const pile = findPile(w, plots);
      if (!pile) {
        w.state = 'waiting';
        w.stuckTimer = 0;
        w.stateTimer = RETRY;
        return;
      }
      startWalk(w, pile);
      return;
    }

    case 'waiting': {
      w.stuckTimer += dt;
      const pile = findPile(w, plots);
      if (pile) { startWalk(w, pile); return; }
      if (w.stuckTimer >= WORKER_STUCK_SECONDS) w.stuckTimer = 0;
      w.stateTimer = Math.max(0, RETRY - (w.stuckTimer % RETRY));
      return;
    }

    case 'walking': {
      w.stuckTimer += dt;
      const plot = plots.find((p) => p.id === w.target);
      if (!plot || plot.state !== 'logs' || plot.reservedBy !== w.id || (plot.woodLeft ?? 0) <= 0 || plot.beingCollected) {
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

      w.state = 'picking';
      w.actionTimer = PICKUP_SECONDS;
      w.stateTimer = PICKUP_SECONDS;
      w.stuckTimer = 0;
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
        // Player takes remaining logs, carrier gets nothing more
        release(w, plots);
        goIdle(w);
        return;
      }
      w.actionTimer = Math.max(0, (w.actionTimer ?? PICKUP_SECONDS) - dt);
      w.stateTimer = w.actionTimer;

      // One log roughly every 0.5 s (PICKUP_SECONDS / 3): wood ticks up per log.
      const elapsed = PICKUP_SECONDS - w.actionTimer;
      const desired = Math.min(CARRY_CAPACITY, Math.floor(elapsed / PER_LOG_SECONDS + 1e-9));
      let take = Math.min(desired - (w.carryingLogs ?? 0), plot.woodLeft ?? 0);
      while (take > 0) {
        recordLogTaken(game, w.id, plot.id, 'carrier');
        plot.woodLeft = (plot.woodLeft ?? 0) - 1;
        w.carryingLogs = (w.carryingLogs ?? 0) + 1;
        take -= 1;
      }
      if ((plot.woodLeft ?? 0) <= 0) {
        // Plot is free for a planter the moment the last log is lifted.
        plot.state = 'empty';
        plot.woodLeft = 0;
        plot.popTimer = undefined;
      }
      if ((plot.woodLeft ?? 0) > 0 && w.actionTimer > 0) return;

      plot.reservedBy = undefined;
      w.state = 'carrying';
      w.target = undefined;
      w.stuckTimer = 0;
      w.stateTimer = 0;
      return;
    }

    case 'carrying': {
      w.stuckTimer += dt;
      const speed = WORKER_RUN_SPEED * (w.carryingLogs && w.carryingLogs > 0 ? 0.85 : 1);
      const adv = advance(w.pos, TRADE_POST_DIR, speed, dt);
      w.pos = dirToPos(adv.dir);
      w.stateTimer = (adv.remaining * WORLD_CONFIG.planetRadius) / speed;
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
      const logs = w.carryingLogs ?? 0;
      sellDeliveredLogs(game, logs);
      w.carryingLogs = 0;
      goIdle(w);
      return;
    }
  }

  release(w, plots);
  goIdle(w);
}

