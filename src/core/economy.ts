import Decimal from 'break_infinity.js';
import { PLANETS } from './config/planets';
import { WORKERS, milestoneMultiplier } from './config/workers';
import { UPGRADES } from './config/upgrades';
import type { GameState, PlanetId, Role, UpgradeId } from './state';

export function globalIncomeMultiplier(state: GameState): number {
  let mult = 1 + state.prestige.starDust.toNumber() * 0.02;
  if (state.upgrades.plantSpeed > 0) mult *= UPGRADES.plantSpeed.effect(state.upgrades.plantSpeed);
  return mult;
}

export function incomePerSecond(state: GameState): Decimal {
  let total = new Decimal(0);
  for (const pid of Object.keys(state.planets) as PlanetId[]) {
    const planet = state.planets[pid];
    if (!planet.unlocked) continue;
    for (const w of planet.workers) {
      const wc = WORKERS[w.role];
      const mult = milestoneMultiplier(w.level);
      const rate = (wc.output / wc.cycleTime) * mult * wc.speed;
      total = total.add(new Decimal(rate));
    }
  }
  return total.mul(globalIncomeMultiplier(state));
}

export function canAffordUpgrade(state: GameState, id: UpgradeId): boolean {
  const level = state.upgrades[id];
  const cost = UPGRADES[id].baseCost.mul(UPGRADES[id].growth ** level);
  return state.currencies.credits.gte(cost);
}

export function canAffordWorker(state: GameState, role: Role, existing: number): boolean {
  const cost = WORKERS[role].baseCost.mul(WORKERS[role].growth ** existing);
  return state.currencies.credits.gte(cost);
}

export function maxTrees(state: GameState, pid: PlanetId): number {
  const p = PLANETS[pid];
  return p.maxTreesBase + state.upgrades.maxTrees * 4;
}
