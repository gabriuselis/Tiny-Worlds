import Decimal from 'break_infinity.js';
import type { PlanetId, Role, ResourceId } from '../state';

export interface PlanetConfig {
  id: PlanetId;
  name: string;
  theme: { sky: string; ground: string; tree: string; rock: string };
  radius: number;
  maxTreesBase: number;
  growTime: number;
  chopTime: number;
  unlockCost: Decimal;
  unlockTreesHarvested: number;
  workerRoles: Role[];
  resourceIds: ResourceId[];
}

export const PLANETS: Record<PlanetId, PlanetConfig> = {
  verdant: {
    id: 'verdant',
    name: 'Verdant',
    theme: { sky: '#87CEEB', ground: '#2d7a2d', tree: '#4caf50', rock: '#7f8c8d' },
    radius: 5,
    maxTreesBase: 12,
    growTime: 8,
    chopTime: 3,
    unlockCost: new Decimal(0),
    unlockTreesHarvested: 0,
    workerRoles: ['planter', 'lumberjack', 'carrier'],
    resourceIds: ['wood'],
  },
  rocky: {
    id: 'rocky',
    name: 'Rocky',
    theme: { sky: '#e0e0e0', ground: '#5d4037', tree: '#6f4e37', rock: '#b0b0b0' },
    radius: 6,
    maxTreesBase: 0,
    growTime: 0,
    chopTime: 0,
    unlockCost: new Decimal(1e6),
    unlockTreesHarvested: 500,
    workerRoles: ['miner'],
    resourceIds: ['stone', 'ore'],
  },
  crystalis: {
    id: 'crystalis',
    name: 'Crystalis',
    theme: { sky: '#d8bfd8', ground: '#4b0082', tree: '#8a2be2', rock: '#e6e6fa' },
    radius: 7,
    maxTreesBase: 0,
    growTime: 0,
    chopTime: 0,
    unlockCost: new Decimal(0),
    unlockTreesHarvested: 2000,
    workerRoles: ['prospector'],
    resourceIds: ['crystal'],
  },
  forge: {
    id: 'forge',
    name: 'Forge',
    theme: { sky: '#ffeb3b', ground: '#795548', tree: '#ff9800', rock: '#9e9e9e' },
    radius: 8,
    maxTreesBase: 0,
    growTime: 0,
    chopTime: 0,
    unlockCost: new Decimal(5e7),
    unlockTreesHarvested: 0,
    workerRoles: ['engineer'],
    resourceIds: ['planks', 'bricks', 'parts'],
  },
  hub: {
    id: 'hub',
    name: 'Hub',
    theme: { sky: '#4a148c', ground: '#311b92', tree: '#ab47bc', rock: '#7986cb' },
    radius: 10,
    maxTreesBase: 0,
    growTime: 0,
    chopTime: 0,
    unlockCost: new Decimal(0),
    unlockTreesHarvested: 0,
    workerRoles: [],
    resourceIds: [],
  },
};

export const FIBONACCI_POINTS = 200;
