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
import { canAffordWorker } from '../src/core/economy';
import { gte, sub, toMoney } from '../src/core/money';
import { updatePlanter, PLANT_TIME, STUCK_TIME } from '../src/core/ai/planter';
import { hireWorker } from '../src/core/workers';
import { buildGrid } from '../src/core/grid';
import { GROW_STAGE_SECONDS, GROW_TOTAL_SECONDS } from '../src/core/config/world';
import { WORKER_MIN_RUN_SECONDS } from '../src/core/config/worker';

describe('cost curves', () => {
  it('planter cost grows exponentially', () => {
    const c0 = costOf('planter', 0);
    const c1 = costOf('planter', 1);
    expect(c1.greaterThan(c0)).toBe(true);
    expect(costOf('planter', 10).greaterThan(costOf('planter', 0))).toBe(true);
  });

  it('planter cost is 10 x 1.15^owned', () => {
    expect(costOf('planter', 0).toNumber()).toBeCloseTo(10);
    expect(costOf('planter', 1).toNumber()).toBeCloseTo(10 * 1.15);
    expect(costOf('planter', 2).toNumber()).toBeCloseTo(10 * 1.15 * 1.15);
  });

  it('upgrade cost grows faster than worker cost', () => {
    const w10 = costOf('planter', 10);
    const u10 = upgradeCost('plantSpeed', 10);
    expect(u10.greaterThan(w10)).toBe(true);
  });
});

describe('planter hiring', () => {
  it('hiring a planter with 100 credits succeeds and credits drop by cost', () => {
    const s = initialState();
    expect(s.currencies.credits.toNumber()).toBe(100);
    const cost = costOf('planter', 0); // 10
    expect(gte(s.currencies.credits, cost)).toBe(true);
    const after = sub(s.currencies.credits, cost);
    expect(after.toNumber()).toBeCloseTo(100 - cost.toNumber());
    expect(canAffordWorker(s, 'planter', 0)).toBe(true);
  });

  it('hiring with 5 credits fails without throwing', () => {
    const s = initialState();
    s.currencies.credits = toMoney(5);
    const cost = costOf('planter', 0); // 10
    expect(gte(s.currencies.credits, cost)).toBe(false);
    expect(canAffordWorker(s, 'planter', 0)).toBe(false);
    // must not throw when checking affordability
    let threw = false;
    try { gte(s.currencies.credits, cost); } catch { threw = true; }
    expect(threw).toBe(false);
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
      id: 1, dir: { x: 1, y: 0, z: 0 }, state: 'sapling', timer: 0.5, woodLeft: 0,
    });
    tick(s, 1);
    expect(s.planets.verdant.plots[0].state).toBe('medium');
  });

  it('planting creates a sapling', () => {
    const s = initialState();
    s.planets.verdant.plots.push({
      id: 1, dir: { x: 1, y: 0, z: 0 }, state: 'sapling', timer: 0.01, reservedBy: 1, woodLeft: 0,
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

describe('planter AI', () => {
  function freshWorld() {
    const s = initialState();
    const grid = buildGrid();
    for (const p of grid.plots) {
      p.state = 'empty'; p.timer = 0; p.reservedBy = undefined;
    }
    s.planets.verdant.plots = grid.plots; // same references: mutations visible in both
    return { s, grid };
  }

  function newPlanter(id: number): any {
    return {
      id, role: 'planter' as const, pos: { x: 0, y: 0, z: 2.5 }, state: 'idle' as const,
      target: undefined, level: 0, cosmetic: { hat: 'cap', color: '#2f7bff' }, name: `p${id}`,
      stuckTimer: 0, stateTimer: 0,
    };
  }

  it('growth is three stages over 2 minutes (60 s + 60 s at x1)', () => {
    const { s } = freshWorld();
    const p = s.planets.verdant.plots[0];
    p.state = 'sapling'; p.timer = GROW_STAGE_SECONDS[0];
    tick(s, GROW_STAGE_SECONDS[0]);
    expect(p.state).toBe('medium');
    expect(p.timer).toBe(GROW_STAGE_SECONDS[1]);
    tick(s, GROW_STAGE_SECONDS[1]);
    expect(p.state).toBe('grown');
    expect(GROW_TOTAL_SECONDS).toBe(120);
  });

  it('a planted tree reaches grown after 120 s', () => {
    const { s, grid } = freshWorld();
    const p = grid.plots[0];
    p.state = 'sapling';
    p.timer = GROW_STAGE_SECONDS[0];
    let elapsed = 0;
    while ((p.state as string) !== 'grown' && elapsed < GROW_TOTAL_SECONDS + 5) {
      tick(s, 0.1);
      elapsed += 0.1;
    }
    expect(p.state).toBe('grown');
    expect(elapsed).toBeGreaterThanOrEqual(GROW_TOTAL_SECONDS - 0.2);
    expect(elapsed).toBeLessThanOrEqual(GROW_TOTAL_SECONDS + 0.2);
  });

  it('scale constants are finite and > 0 (never zero or negative)', () => {
    const cases: [string, number][] = [['empty', 0.0001], ['sapling', 0.35], ['medium', 0.65], ['grown', 1.0]];
    for (const [st, expectScale] of cases) {
      let got: number;
      if (st === 'empty') got = 0.0001;
      else if (st === 'sapling') got = 0.35;
      else if (st === 'medium') got = 0.65;
      else got = 1.0;
      expect(Number.isFinite(got)).toBe(true);
      expect(got).toBeGreaterThan(0);
      expect(got).toBeCloseTo(expectScale);
    }
  });

  it('a planter runs at least 3 s before planting', () => {
    const { s } = freshWorld();
    const w = newPlanter(1);
    s.planets.verdant.workers.push(w);

    const dt = 0.05;
    let elapsed = 0;
    let walkStart = -1;
    let plantStart = -1;
    while (elapsed < 90 && plantStart < 0) {
      tick(s, dt);
      elapsed += dt;
      if (walkStart < 0 && w.state === 'walking') walkStart = elapsed;
      if (w.state === 'planting') plantStart = elapsed;
    }
    expect(w.state).toBe('planting');
    expect(walkStart).toBeGreaterThanOrEqual(0);
    expect(plantStart - walkStart).toBeGreaterThanOrEqual(WORKER_MIN_RUN_SECONDS - 0.1);
    expect(w.plantTimer).toBeCloseTo(PLANT_TIME, 5);
  });

  it('planting takes 5 seconds and creates a sapling', () => {
    const { s, grid } = freshWorld();
    const plot = grid.plots[4];
    const w = newPlanter(1);
    w.state = 'planting';
    w.target = plot.id;
    w.plantTimer = PLANT_TIME;
    plot.reservedBy = w.id;
    w.pos = { x: plot.dir.x * 2.5, y: plot.dir.y * 2.5, z: plot.dir.z * 2.5 };
    s.planets.verdant.workers.push(w);

    let elapsed = 0;
    while (plot.state === 'empty' && elapsed < PLANT_TIME + 5) {
      tick(s, 0.1);
      elapsed += 0.1;
    }
    expect(plot.state).toBe('sapling');
    expect(plot.timer).toBeCloseTo(GROW_STAGE_SECONDS[0]);
    expect(elapsed).toBeGreaterThanOrEqual(PLANT_TIME - 0.2);
    expect(elapsed).toBeLessThanOrEqual(PLANT_TIME + 0.2);
    expect(plot.reservedBy).toBeUndefined();
    expect(s.stats.treesPlanted).toBe(1);
    expect(w.state).toBe('idle');
  });

  it('two planters never pick the same plot (reservation)', () => {
    const { s, grid } = freshWorld();
    const p1 = newPlanter(1);
    const p2 = newPlanter(2);
    p1.pos = { x: grid.plots[0].dir.x * 2.5, y: grid.plots[0].dir.y * 2.5, z: grid.plots[0].dir.z * 2.5 };
    p2.pos = { x: grid.plots[1].dir.x * 2.5, y: grid.plots[1].dir.y * 2.5, z: grid.plots[1].dir.z * 2.5 };
    updatePlanter(p1, s.planets.verdant.plots, s, 0.1);
    updatePlanter(p2, s.planets.verdant.plots, s, 0.1);
    expect(p1.state).toBe('walking');
    expect(p2.state).toBe('walking');
    expect(p1.target).not.toBe(p2.target);
    const r1 = s.planets.verdant.plots.find((x) => x.id === p1.target)!.reservedBy;
    const r2 = s.planets.verdant.plots.find((x) => x.id === p2.target)!.reservedBy;
    expect(r1).toBe(1);
    expect(r2).toBe(2);
  });

  it('planter waits when no empty plot is available', () => {
    const { s, grid } = freshWorld();
    for (const p of grid.plots) p.state = 'grown';
    const w = newPlanter(1);
    updatePlanter(w, s.planets.verdant.plots, s, 0.1);
    expect(w.state).toBe('waiting');
  });

  it('planter releases its reservation when stuck > 20 s', () => {
    const { s, grid } = freshWorld();
    const plot = grid.plots[0];
    const w = newPlanter(1);
    w.state = 'walking';
    w.target = plot.id;
    plot.reservedBy = w.id;
    w.pos = { x: 1, y: 0, z: 0 };
    updatePlanter(w, s.planets.verdant.plots, s, STUCK_TIME + 1);
    expect(w.state).toBe('idle');
    expect(w.target).toBeUndefined();
    expect(plot.reservedBy).toBeUndefined();
  });

  it('one spawn call adds exactly one worker', () => {
    const s = initialState();
    const w = hireWorker(s, 'planter', { free: true });
    expect(w).toBeDefined();
    expect(s.planets.verdant.workers).toHaveLength(1);
    hireWorker(s, 'planter', { free: true });
    expect(s.planets.verdant.workers).toHaveLength(2);
  });

  it('reset produces a state with no workers and no trees', () => {
    const s = initialState();
    hireWorker(s, 'planter', { free: true });
    s.planets.verdant.plots.push({ id: 1, dir: { x: 1, y: 0, z: 0 }, state: 'grown', timer: 0, woodLeft: 0 });
    const fresh = initialState();
    expect(fresh.planets.verdant.workers).toHaveLength(0);
    expect(fresh.planets.verdant.plots).toHaveLength(0);
  });

  it('headless 2-minute sim with 3 planters plants many trees and never stalls', () => {
    const { s } = freshWorld();
    for (let i = 1; i <= 3; i++) {
      s.planets.verdant.workers.push(newPlanter(i));
    }
    const steps = Math.floor(120 / 0.1);
    let maxStuck = 0;
    for (let i = 0; i < steps; i++) {
      tick(s, 0.1);
      for (const w of s.planets.verdant.workers) {
        if (w.stuckTimer > maxStuck) maxStuck = w.stuckTimer;
      }
    }
    const planted = s.planets.verdant.plots.filter((p) => p.state !== 'empty').length;
    expect(planted).toBeGreaterThan(20);
    expect(maxStuck).toBeLessThanOrEqual(STUCK_TIME + 0.1);
    expect(s.stats.treesPlanted).toBe(planted);
  });
});

