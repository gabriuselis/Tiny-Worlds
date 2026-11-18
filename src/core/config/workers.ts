import Decimal from 'break_infinity.js';
import type { Role } from '../state';

export interface WorkerConfig {
  role: Role;
  baseCost: Decimal;
  growth: number;
  speed: number;
  carry: number;
  cycleTime: number;
  output: number;
}

export const WORKERS: Record<Role, WorkerConfig> = {
  planter: {
    role: 'planter',
    baseCost: new Decimal(10),
    growth: 1.15,
    speed: 1.0,
    carry: 1,
    cycleTime: 3,
    output: 1,
  },
  lumberjack: {
    role: 'lumberjack',
    baseCost: new Decimal(12),
    growth: 1.15,
    speed: 1.0,
    carry: 1,
    cycleTime: 3,
    output: 1,
  },
  carrier: {
    role: 'carrier',
    baseCost: new Decimal(30),
    growth: 1.15,
    speed: 1.2,
    carry: 3,
    cycleTime: 4,
    output: 2,
  },
  miner: {
    role: 'miner',
    baseCost: new Decimal(500),
    growth: 1.07,
    speed: 0.9,
    carry: 3,
    cycleTime: 6,
    output: 3,
  },
  prospector: {
    role: 'prospector',
    baseCost: new Decimal(2000),
    growth: 1.12,
    speed: 0.8,
    carry: 1,
    cycleTime: 8,
    output: 1,
  },
  engineer: {
    role: 'engineer',
    baseCost: new Decimal(10000),
    growth: 1.12,
    speed: 1.0,
    carry: 1,
    cycleTime: 5,
    output: 1,
  },
};

export function costOf(role: Role, level: number): Decimal {
  const w = WORKERS[role];
  return w.baseCost.mul(w.growth ** level);
}

export function milestoneMultiplier(level: number): number {
  let mult = 1;
  for (let m = 25; m <= level; m *= 2) {
    if (level >= m) mult *= 2;
  }
  return mult;
}
