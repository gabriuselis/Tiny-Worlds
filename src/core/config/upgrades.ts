import Decimal from 'break_infinity.js';
import type { UpgradeId } from '../state';

export interface UpgradeConfig {
  id: UpgradeId;
  name: string;
  baseCost: Decimal;
  growth: number;
  effect: (level: number) => number;
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
    baseCost: new Decimal(50),
    growth: 1.15,
    effect: (level) => 1 + level * 0.2,
  },
  chopSpeed: {
    id: 'chopSpeed',
    name: 'Chop Speed',
    baseCost: new Decimal(75),
    growth: 1.15,
    effect: (level) => 1 + level * 0.2,
  },
  woodValue: {
    id: 'woodValue',
    name: 'Wood Value',
    baseCost: new Decimal(100),
    growth: 1.15,
    effect: (level) => 1 + level * 0.5,
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

export function upgradeCost(id: UpgradeId, level: number): Decimal {
  const u = UPGRADES[id];
  return u.baseCost.mul(u.growth ** level);
}
