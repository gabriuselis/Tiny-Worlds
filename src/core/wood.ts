import Decimal from 'break_infinity.js';
import { add, toMoney } from './money';
import { sellWood } from './progressionCommands';
import type { GameState, Plot } from './state';
import { TAP_COLLECT_INSTANT_SELL, COLLECT_LOG_INTERVAL } from './config/world';

const ONE = toMoney(1);

export interface LogTakeEvent {
  time: number;
  workerId: number;
  plotId: number;
  source: 'carrier' | 'lumberjack' | 'player';
}

// Page-load counters for the dev pipeline panel (not part of the save).
let logsTaken = 0;
let logsDelivered = 0;
let lastLogTake: LogTakeEvent | null = null;

/** Record one log lifted off a pile: visible Wood +1 and one unit queued for sale. */
export function recordLogTaken(
  state: GameState,
  workerId = -1,
  plotId = -1,
  source: 'carrier' | 'lumberjack' | 'player' = 'carrier',
): void {
  state.wood = add(state.wood, ONE);
  state.woodToSell = add(state.woodToSell, ONE);
  state.woodLogTimes.push(state.simSeconds);
  logsTaken += 1;
  lastLogTake = { time: state.simSeconds, workerId, plotId, source };
  // Rolling window: keep the last 60 s of log timestamps only.
  const cutoff = state.simSeconds - 60;
  let drop = 0;
  while (drop < state.woodLogTimes.length && state.woodLogTimes[drop] < cutoff) drop += 1;
  if (drop > 0) state.woodLogTimes.splice(0, drop);
}

/** Shared log collection logic used by both workers and player.
 * Takes exactly one log from the plot. Returns 1 if a log was taken, 0 otherwise. */
export function takeLog(
  game: GameState,
  plot: Plot,
  source: 'carrier' | 'lumberjack' | 'player',
  workerId = -1
): number {
  if ((plot.woodLeft ?? 0) <= 0) return 0;

  // Shared path: visible Wood +1, one unit queued for sale, rolling window.
  recordLogTaken(game, workerId, plot.id, source);

  if (source === 'player' && TAP_COLLECT_INSTANT_SELL) {
    // Instant sale reuses the same credit/woodToSell conversion as deliveries.
    sellWood(game, 1);
  } else {
    plot.collectQueue = (plot.collectQueue ?? 0) + 1;
  }

  plot.woodLeft = (plot.woodLeft ?? 0) - 1;
  plot.beingCollected = true;
  return 1;
}

/** Player tap collection: collects logs from a pile one by one over time.
 * Returns the number of logs that will be collected (woodLeft at start). */
export function collectPileByPlayer(game: GameState, plotId: number): number {
  const plot = game.planets.verdant.plots.find((p) => p.id === plotId);
  if (!plot) return 0;
  if (plot.state !== 'logs' || (plot.woodLeft ?? 0) <= 0) return 0;
  // One tap = one pile: ignore repeat taps while this pile is already draining.
  if (plot.beingCollected) return 0;

  // If a worker has reserved but not started pickup, release it
  if (plot.reservedBy !== undefined) {
    const worker = game.planets.verdant.workers.find((w) => w.id === plot.reservedBy);
    if (worker && (worker.state === 'walking' || worker.state === 'waiting' || worker.state === 'idle')) {
      plot.reservedBy = undefined;
      worker.state = 'idle';
      worker.target = undefined;
      worker.stuckTimer = 0;
      worker.stateTimer = 0;
    }
    // If worker is in 'picking' state, we'll handle it in the pickup processing
  }
  
  // Mark plot as being collected by player
  plot.beingCollected = true;
  plot.collectTimer = 0; // Start immediately
  plot.collectQueue = (plot.collectQueue ?? 0) + (plot.woodLeft ?? 0);
  
  // Store the total logs to collect for the queue processing
  const totalLogs = plot.woodLeft ?? 0;
  
  // We don't take logs immediately - they're taken one by one in processPlayerCollection
  return totalLogs;
}

/** Process player collection queue - called each sim tick. */
export function processPlayerCollection(game: GameState, dt: number): void {
  for (const plot of game.planets.verdant.plots) {
    if (plot.state !== 'logs' || (plot.woodLeft ?? 0) <= 0) {
      plot.beingCollected = false;
      continue;
    }
    
    if (!plot.beingCollected) continue;
    
    plot.collectTimer = Math.max(0, (plot.collectTimer ?? 0) - dt);
    
    const interval = COLLECT_LOG_INTERVAL;
    
    while (plot.collectTimer <= 0 && (plot.woodLeft ?? 0) > 0 && (plot.collectQueue ?? 0) > 0) {
      takeLog(game, plot, 'player');
      plot.collectQueue = (plot.collectQueue ?? 0) - 1;
      plot.collectTimer += interval;
    }
    
    // If all logs collected, clear the queue and mark plot empty
    if ((plot.woodLeft ?? 0) <= 0) {
      plot.state = 'empty';
      plot.woodLeft = 0;
      plot.collectQueue = 0;
      plot.collectTimer = 0;
      plot.beingCollected = false;
      plot.reservedBy = undefined;
      plot.popTimer = undefined;
    }
  }
}

/** Logs taken during the last 60 s (the "Wood/min" stat). */
export function logsPerMinute(state: GameState): number {
  const cutoff = state.simSeconds - 60;
  let n = 0;
  for (const t of state.woodLogTimes) if (t >= cutoff) n += 1;
  return n;
}

/** Convert delivered logs into credits. Does NOT touch the visible Wood counter. */
export function sellDeliveredLogs(state: GameState, logs: number): Decimal {
  const earned = sellWood(state, logs);
  if (earned.eq(0)) return earned;
  logsDelivered += logs;
  return earned;
}

export function getWoodCounters(): { taken: number; delivered: number; lastTake: LogTakeEvent | null } {
  return { taken: logsTaken, delivered: logsDelivered, lastTake: lastLogTake };
}

export function resetWoodCounters(): void {
  logsTaken = 0;
  logsDelivered = 0;
  lastLogTake = null;
}
