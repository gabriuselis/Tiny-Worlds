import Decimal from 'break_infinity.js';
import type { UpgradeId } from '../state';

export interface UpgradeConfig {
  id: UpgradeId;
  name: string;
  baseCost: Decimal;
  growth: number;
  effect: (level: number) => number;
  maxLevel?: number;
}

/** Speed upgrades cap here: 0.92^17 ~= 0.244, clamped to 0.25. */
export const MAX_SPEED_LEVEL = 17;

/** Plant/grow time multiplier: 0.92^level, floored at 0.25. */
export function plantSpeedMult(level: number): number {
  if (level <= 0) return 1;
  return Math.max(0.25, Math.pow(0.92, level));
}

/** Chop time multiplier: 0.92^level, floored at 0.25. */
export function chopSpeedMult(level: number): number {
  if (level <= 0) return 1;
  return Math.max(0.25, Math.pow(0.92, level));
}

/** Credits-per-log multiplier: 1 + 0.10 * level. */
export function woodValueMult(level: number): number {
  return 1 + 0.1 * level;
}

export const UPGRADES: Record<UpgradeId, UpgradeConfig> = {
  planter: {
    id: 'planter',
    name: 'Hire Planter',
    baseCost: new Decimal(5),
    growth: 1.07,
    effect: (level) => level + 1,
  },
  lumberjack: {
    id: 'lumberjack',
    name: 'Hire Lumberjack',
    baseCost: new Decimal(25),
    growth: 1.07,
    effect: (level) => level + 1,
  },
  carrier: {
    id: 'carrier',
    name: 'Hire Carrier',
    baseCost: new Decimal(100),
    growth: 1.07,
    effect: (level) => level + 1,
  },
  plantSpeed: {
    id: 'plantSpeed',
    name: 'Plant Speed',
    baseCost: new Decimal(25),
    growth: 1.5,
    effect: (level) => plantSpeedMult(level),
    maxLevel: MAX_SPEED_LEVEL,
  },
  chopSpeed: {
    id: 'chopSpeed',
    name: 'Chop Speed',
    baseCost: new Decimal(25),
    growth: 1.5,
    effect: (level) => chopSpeedMult(level),
    maxLevel: MAX_SPEED_LEVEL,
  },
  woodValue: {
    id: 'woodValue',
    name: 'Wood Value',
    baseCost: new Decimal(40),
    growth: 1.6,
    effect: (level) => woodValueMult(level),
  },
  tapPower: {
    id: 'tapPower',
    name: 'Tap Power',
    baseCost: new Decimal(10),
    growth: 1.15,
    effect: (level) => 1 + level,
  },
  maxTrees: {
    id: 'maxTrees',
    name: 'Max Trees',
    baseCost: new Decimal(200),
    growth: 1.15,
    effect: (level) => 12 + level * 4,
  },
};

/** cost(level) = ceil(base x growth^level), via the shared money helpers. */
export function upgradeCost(id: UpgradeId, level: number): Decimal {
  const u = UPGRADES[id];
  return Decimal.ceil(u.baseCost.mul(Math.pow(u.growth, level)));
}

/** Maximum purchasable level for an upgrade (undefined = no cap). */
export function upgradeMaxLevel(id: UpgradeId): number | undefined {
  return UPGRADES[id].maxLevel;
}