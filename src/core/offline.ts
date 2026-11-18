import Decimal from 'break_infinity.js';
import { incomePerSecond } from './economy';
import { add, mul } from './money';
import type { GameState } from './state';

const DEFAULT_CAP_HOURS = 8;

export interface OfflineResult {
  creditsGained: Decimal;
  secondsOffline: number;
  capped: boolean;
}

export function calculateOffline(state: GameState, nowMs: number): OfflineResult {
  const capHours = DEFAULT_CAP_HOURS;
  const capMs = capHours * 60 * 60 * 1000;
  const elapsed = Math.min(nowMs - state.lastSaved, capMs);
  const seconds = elapsed / 1000;
  const capped = nowMs - state.lastSaved > capMs;
  const income = incomePerSecond(state);
  const gained = mul(income, seconds);
  return { creditsGained: gained, secondsOffline: seconds, capped };
}

export function applyOffline(state: GameState, result: OfflineResult): GameState {
  state.currencies.credits = add(state.currencies.credits, result.creditsGained);
  state.lastSaved = Date.now();
  return state;
}
