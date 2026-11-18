import Decimal from 'break_infinity.js';
import { WOOD_PRICE } from './config/world';
import { add, sub, toMoney } from './money';
import type { GameState } from './state';

const ONE = toMoney(1);

export interface LogTakeEvent {
  time: number;
  workerId: number;
  plotId: number;
  source: 'carrier' | 'lumberjack';
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
  source: 'carrier' | 'lumberjack' = 'carrier',
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

/** Logs taken during the last 60 s (the "Wood/min" stat). */
export function logsPerMinute(state: GameState): number {
  const cutoff = state.simSeconds - 60;
  let n = 0;
  for (const t of state.woodLogTimes) if (t >= cutoff) n += 1;
  return n;
}

/** Convert delivered logs into credits. Does NOT touch the visible Wood counter. */
export function sellDeliveredLogs(state: GameState, logs: number): Decimal {
  if (logs <= 0) return toMoney(0);
  const valueMult = 1 + 0.1 * (state.upgrades.woodValue ?? 0);
  const earned = toMoney(logs * WOOD_PRICE * valueMult);
  state.currencies.credits = add(state.currencies.credits, earned);
  state.woodToSell = sub(state.woodToSell, toMoney(Math.min(logs, state.woodToSell.toNumber())));
  if (state.woodToSell.lt(0)) state.woodToSell = toMoney(0);
  state.stats.woodSold = add(state.stats.woodSold, logs);
  state.stats.lifetimeCredits = add(state.stats.lifetimeCredits, earned);
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
