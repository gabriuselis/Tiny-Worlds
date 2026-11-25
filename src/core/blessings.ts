import Decimal from 'break_infinity.js';
import { sub } from './money';
import type { GameState, BlessingId } from './state';
import { getBlessing, blessingsList } from './config/blessings';
import { hireWorker } from './workers';
import { woodValueMult } from './config/upgrades';

/** Total wood earned (cumulative, never decreases) minus wood spent on blessings. */
export function spendableWood(state: GameState): Decimal {
  return sub(state.wood, state.woodSpent);
}

/** Total wood value multiplier: upgrade multiplier * blessing multiplier. */
export function totalWoodValueMultiplier(state: GameState): number {
  const upgradeMult = woodValueMult(state.upgrades.woodValue ?? 0);
  const blessingMult = blessingWoodValueMultiplier(state);
  return upgradeMult * blessingMult;
}

/** Apply a blessing's effect to the game state. */
function applyBlessingEffect(state: GameState, id: BlessingId): void {
  const blessing = getBlessing(id);
  if (!blessing) return;

  switch (blessing.effect) {
    case 'woodValue':
    case 'woodValue2':
      // Wood value multipliers are handled in progressionCommands.ts sellWood
      // via the blessingWoodValueMultiplier helper
      break;
    case 'planters':
      for (let i = 0; i < 25; i++) {
        hireWorker(state, 'planter', { free: true });
      }
      break;
    case 'lumberjacks':
      for (let i = 0; i < 25; i++) {
        hireWorker(state, 'lumberjack', { free: true });
      }
      break;
    case 'carriers':
      for (let i = 0; i < 25; i++) {
        hireWorker(state, 'carrier', { free: true });
      }
      break;
    case 'carrierSpeed':
      // Carrier speed multiplier is handled in carrier AI via blessingCarrierSpeedMultiplier helper
      break;
  }
}

/** Multiplier from blessings for wood value (credits per log). Stacks multiplicatively with upgrades. */
export function blessingWoodValueMultiplier(state: GameState): number {
  let mult = 1;
  for (const id of state.blessings) {
    const b = getBlessing(id);
    if (b && (b.effect === 'woodValue' || b.effect === 'woodValue2')) {
      mult *= 2;
    }
  }
  return mult;
}

/** Multiplier from blessings for carrier speed (movement and pickup). */
export function blessingCarrierSpeedMultiplier(state: GameState): number {
  for (const id of state.blessings) {
    const b = getBlessing(id);
    if (b && b.effect === 'carrierSpeed') {
      return 2;
    }
  }
  return 1;
}

/** Try to buy a blessing. Returns true on success, false if already owned or not enough spendable wood. */
export function buyBlessing(state: GameState, id: BlessingId): boolean {
  if (state.blessings.includes(id)) return false;

  const blessing = getBlessing(id);
  if (!blessing) return false;

  const available = spendableWood(state);
  if (available.lt(blessing.woodCost)) return false;

  state.woodSpent = state.woodSpent.add(blessing.woodCost);
  state.blessings.push(id);
  applyBlessingEffect(state, id);
  return true;
}

/** Get all blessings with their affordability status. */
export function getBlessingsStatus(state: GameState): Array<{ config: ReturnType<typeof getBlessing>; owned: boolean; affordable: boolean }> {
  const available = spendableWood(state);
  return blessingsList().map((b) => ({
    config: b,
    owned: state.blessings.includes(b.id as BlessingId),
    affordable: available.gte(b.woodCost),
  }));
}

/** Returns true if there's at least one non-owned blessing the player can afford. */
export function hasAffordableBlessing(state: GameState): boolean {
  const available = spendableWood(state);
  for (const b of blessingsList()) {
    if (!state.blessings.includes(b.id as BlessingId) && available.gte(b.woodCost)) {
      return true;
    }
  }
  return false;
}