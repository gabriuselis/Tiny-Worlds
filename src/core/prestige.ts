import Decimal from 'break_infinity.js';
import type { GameState, PerkId } from './state';

export function calculateStarDust(lifetimeCredits: Decimal): Decimal {
  return new Decimal(Math.floor(Math.sqrt(lifetimeCredits.div(1e9).toNumber())));
}

export function prestigeIncomeBonus(starDust: Decimal): number {
  return 1 + starDust.toNumber() * 0.02;
}

export function perkCost(_perk: PerkId, level: number): Decimal {
  return new Decimal(50 * (level + 1));
}

export function canBuyPerk(state: GameState, perk: PerkId): boolean {
  return state.prestige.starDust.gte(perkCost(perk, state.prestige.perks[perk] ?? 0));
}

export function buyPerk(state: GameState, perk: PerkId): boolean {
  if (!canBuyPerk(state, perk)) return false;
  state.prestige.starDust = state.prestige.starDust.sub(perkCost(perk, state.prestige.perks[perk] ?? 0));
  state.prestige.perks[perk] = (state.prestige.perks[perk] ?? 0) + 1;
  return true;
}

export function doPrestige(state: GameState): GameState {
  const starDust = calculateStarDust(state.stats.lifetimeCredits);
  state.prestige.count += 1;
  state.prestige.starDust = state.prestige.starDust.add(starDust);
  state.planets = {
    verdant: state.planets.verdant,
    rocky: { ...state.planets.rocky, unlocked: false },
    crystalis: { ...state.planets.crystalis, unlocked: false },
    forge: { ...state.planets.forge, unlocked: false },
    hub: { ...state.planets.hub, unlocked: false },
  };
  for (const p of Object.values(state.planets)) {
    p.resources = Object.fromEntries(
      Object.keys(p.resources).map((k) => [k, new Decimal(0)])
    ) as any;
    p.plots = [];
    p.workers = [];
    p.buildings = {};
    p.treesHarvested = 0;
    p.toolsCrafted = 0;
  }
  state.upgrades = { planter: 0, lumberjack: 0, carrier: 0, plantSpeed: 0, chopSpeed: 0, woodValue: 0, tapPower: 0, maxTrees: 0 };
  state.currencies.credits = new Decimal(0);
  state.stats.treesPlanted = 0;
  state.stats.woodSold = new Decimal(0);
  return state;
}
