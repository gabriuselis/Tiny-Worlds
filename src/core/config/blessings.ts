import Decimal from 'break_infinity.js';

export interface BlessingConfig {
  id: string;
  title: string;
  description: string;
  woodCost: Decimal;
  effect: 'woodValue' | 'planters' | 'lumberjacks' | 'carrierSpeed' | 'carriers' | 'woodValue2';
}

export const BLESSINGS: BlessingConfig[] = [
  {
    id: 'woodValue',
    title: '2x Wood Value',
    description: 'Doubles credits per log',
    woodCost: new Decimal(25000),
    effect: 'woodValue',
  },
  {
    id: 'planters',
    title: '+25 Planters',
    description: 'Adds 25 Planter workers',
    woodCost: new Decimal(27000),
    effect: 'planters',
  },
  {
    id: 'lumberjacks',
    title: '+25 Lumberjacks',
    description: 'Adds 25 Lumberjack workers',
    woodCost: new Decimal(29000),
    effect: 'lumberjacks',
  },
  {
    id: 'carrierSpeed',
    title: '2x Carrier Speed',
    description: 'Doubles carrier movement and pickup speed',
    woodCost: new Decimal(30000),
    effect: 'carrierSpeed',
  },
  {
    id: 'carriers',
    title: '+25 Carriers',
    description: 'Adds 25 Carrier workers',
    woodCost: new Decimal(31000),
    effect: 'carriers',
  },
  {
    id: 'woodValue2',
    title: '2x Wood Value',
    description: 'Doubles credits per log again',
    woodCost: new Decimal(52000),
    effect: 'woodValue2',
  },
];

export function getBlessing(id: string): BlessingConfig | undefined {
  return BLESSINGS.find((b) => b.id === id);
}

export function blessingsList(): BlessingConfig[] {
  return [...BLESSINGS];
}

export function blessingWoodCost(id: string): Decimal {
  const b = getBlessing(id);
  return b ? b.woodCost : new Decimal(0);
}