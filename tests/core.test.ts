import { describe, it, expect } from 'vitest';
import Decimal from 'break_infinity.js';
import { initialState } from '../src/core/state';
import { tick } from '../src/core/sim';
import { costOf, milestoneMultiplier } from '../src/core/config/workers';
import { upgradeCost } from '../src/core/config/upgrades';
import { incomePerSecond } from '../src/core/economy';
import { calculateOffline } from '../src/core/offline';
import { calculateStarDust } from '../src/core/prestige';
import { PLANETS } from '../src/core/config/planets';
import { deserialize, serialize } from '../src/core/save';

describe('cost curves', () => {
  it('planter cost grows exponentially', () => {
    const c0 = costOf('planter', 0);
    const c1 = costOf('planter', 1);
    expect(c1.greaterThan(c0)).toBe(true);
    expect(costOf('planter', 10).greaterThan(costOf('planter', 0))).toBe(true);
  });

  it('upgrade cost grows faster than worker cost', () => {
    const w10 = costOf('planter', 10);
    const u10 = upgradeCost('plantSpeed', 10);
    expect(u10.greaterThan(w10)).toBe(true);
  });
});

describe('milestones', () => {
  it('every 25 owned doubles speed', () => {
    expect(milestoneMultiplier(24)).toBe(1);
    expect(milestoneMultiplier(25)).toBe(2);
    expect(milestoneMultiplier(49)).toBe(2);
    expect(milestoneMultiplier(50)).toBe(4);
  });
});

describe('income', () => {
  it('income per second scales with workers', () => {
    const s = initialState();
    const base = incomePerSecond(s);
    s.planets.verdant.workers.push({ id: 1, role: 'planter', pos: { x: 1, y: 0, z: 0 }, state: 'idle', level: 0, cosmetic: { hat: 'none', color: '#fff' }, name: 'a', stuckTimer: 0 });
    const after = incomePerSecond(s);
    expect(after.greaterThan(base)).toBe(true);
  });
});

describe('offline progress', () => {
  it('calculates credits gained over time', () => {
    const s = initialState();
    const res = calculateOffline(s, Date.now() + 3600 * 1000);
    expect(res.creditsGained.gte(0)).toBe(true);
    expect(res.secondsOffline).toBeCloseTo(3600, -1);
  });

  it('caps offline time at 8 hours', () => {
    const s = initialState();
    const res = calculateOffline(s, Date.now() + 24 * 3600 * 1000);
    expect(res.capped).toBe(true);
    expect(res.secondsOffline).toBeLessThanOrEqual(8 * 3600);
  });
});

describe('prestige', () => {
  it('star dust formula', () => {
    expect(calculateStarDust(new Decimal(1e9)).toNumber()).toBe(1);
    expect(calculateStarDust(new Decimal(1e18)).toNumber()).toBe(31622);
    expect(calculateStarDust(new Decimal(0)).toNumber()).toBe(0);
  });
});

describe('simulation tick', () => {
  it('grows saplings into trees over time', () => {
    const s = initialState();
    s.planets.verdant.plots.push({
      id: 1, row: 0, col: 0, dir: { x: 1, y: 0, z: 0 }, state: 'sapling', timer: 0.5, woodLeft: 0,
    });
    tick(s, 1);
    expect(s.planets.verdant.plots[0].state).toBe('medium');
  });

  it('planting creates a sapling', () => {
    const s = initialState();
    s.planets.verdant.plots.push({
      id: 1, row: 0, col: 0, dir: { x: 1, y: 0, z: 0 }, state: 'sapling', timer: 0.01, reservedBy: 1, woodLeft: 0,
    });
    s.planets.verdant.workers.push({
      id: 1, role: 'planter', pos: { x: 1, y: 0, z: 0 }, state: 'plant', target: 1, level: 0,
      cosmetic: { hat: 'none', color: '#fff' }, name: 'a', stuckTimer: 0,
    });
    tick(s, 1);
    expect(s.planets.verdant.plots[0].state).toBe('sapling');
  });
});

describe('planet config', () => {
  it('verdant has grow time', () => {
    expect(PLANETS.verdant.growTime).toBe(8);
  });
});

describe('save compatibility', () => {
  it('discards old saves with version < 2', () => {
    const oldSave = JSON.stringify({ version: 1, planets: { verdant: { nodes: [] } } });
    const result = deserialize(oldSave);
    expect(result).toBeNull();
  });

  it('discards saves with missing version', () => {
    const noVersion = JSON.stringify({ planets: { verdant: { nodes: [] } } });
    const result = deserialize(noVersion);
    expect(result).toBeNull();
  });

  it('discards malformed JSON', () => {
    const result = deserialize('not json');
    expect(result).toBeNull();
  });

  it('deep-merges valid save over defaults', () => {
    const s = initialState();
    s.currencies.credits = new Decimal(42);
    const json = serialize(s);
    const loaded = deserialize(json)!;
    expect(loaded.currencies.credits.toString()).toBe('42');
    expect(loaded.planets.verdant.plots).toBeDefined();
    expect(Array.isArray(loaded.planets.verdant.plots)).toBe(true);
  });
});
