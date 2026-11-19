import Decimal from 'break_infinity.js';
import { WOOD_PRICE } from './config/world';
import { add, sub, toMoney } from './money';
import type { GameState } from './state';

/** Deterministic sale command; the caller may record UI/debug effects separately. */
export function sellWood(state: GameState, logs: number): Decimal {
  if (!Number.isFinite(logs) || logs <= 0) return toMoney(0);
  const valueMult = 1 + 0.1 * (state.upgrades.woodValue ?? 0);
  const earned = toMoney(logs * WOOD_PRICE * valueMult);
  state.currencies.credits = add(state.currencies.credits, earned);
  state.woodToSell = sub(state.woodToSell, toMoney(Math.min(logs, state.woodToSell.toNumber())));
  if (state.woodToSell.lt(0)) state.woodToSell = toMoney(0);
  state.stats.woodSold = add(state.stats.woodSold, logs);
  state.stats.lifetimeCredits = add(state.stats.lifetimeCredits, earned);
  return earned;
}
