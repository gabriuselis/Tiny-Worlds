import Decimal from 'break_infinity.js';
import { PLANETS } from './config/planets';
import { WORKERS, milestoneMultiplier } from './config/workers';
import { upgradeCost } from './config/upgrades';
import { gte, mul } from './money';
import type { GameState, PlanetId, Role, UpgradeId } from './state';

export function globalIncomeMultiplier(state: GameState): number {
  // Plant Speed now acts on timers (plant/grow/chop durations), not on income.
  return 1 + state.prestige.starDust.toNumber() * 0.02;
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
  return gte(state.currencies.credits, upgradeCost(id, level));
}

export function canAffordWorker(state: GameState, role: Role, existing: number): boolean {
  const cost = mul(WORKERS[role].baseCost, WORKERS[role].growth ** existing);
  return gte(state.currencies.credits, cost);
}

export function maxTrees(state: GameState, pid: PlanetId): number {
  const p = PLANETS[pid];
  return p.maxTreesBase + state.upgrades.maxTrees * 4;
}
