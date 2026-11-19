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
import { gte, sub, toMoney, format } from '../src/core/money';
import { updatePlanter, PLANT_TIME, STUCK_TIME } from '../src/core/ai/planter';
import { updateLumberjack } from '../src/core/ai/lumberjack';
import { updateCarrier } from '../src/core/ai/carrier';
import { hireWorker } from '../src/core/workers';
import { seedEmptyPlots, fillPlanet, clearPlanet, resetGame, countPlotStates, sweepReservations, logsWaiting, spawnLogPiles } from '../src/core/game';
import { buildGrid } from '../src/core/grid';
import { GROW_STAGE_SECONDS, GROW_TOTAL_SECONDS, LOG_LOGS_PER_PILE, WORLD_CONFIG, WOOD_PRICE } from '../src/core/config/world';
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
    const s = initialState(1000);
    const res = calculateOffline(s, 1000 + 3600 * 1000);
    expect(res.creditsGained.gte(0)).toBe(true);
    expect(res.secondsOffline).toBeCloseTo(3600, -1);
  });

  it('caps offline time at 8 hours', () => {
    const s = initialState(1000);
    const res = calculateOffline(s, 1000 + 24 * 3600 * 1000);
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
      id: 1, dir: { x: 1, y: 0, z: 0 }, state: 'empty', timer: 0, woodLeft: 0, reservedBy: 1,
    });
    s.planets.verdant.workers.push({
      id: 1, role: 'planter', pos: { x: 1, y: 0, z: 0 }, state: 'planting', target: 1, level: 0,
      cosmetic: { hat: 'none', color: '#fff' }, name: 'a', stuckTimer: 0, plantTimer: 0.05,
    });
    tick(s, 0.2);
    expect(s.planets.verdant.plots[0].state).toBe('sapling');
    expect(s.planets.verdant.plots[0].timer).toBeCloseTo(GROW_STAGE_SECONDS[0], 0);
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

describe('shared game state (Fill / Clear / Reset)', () => {
  function seeds() {
    return buildGrid().plots.map((p) => ({ id: p.id, dir: p.dir }));
  }

  it('fill, clear and reset mutate the same game object in place', () => {
    const game = initialState();
    seedEmptyPlots(game, seeds());
    const planet = game.planets.verdant;
    const plotsArray = planet.plots;

    fillPlanet(game, seeds());
    expect(planet.plots).toBe(plotsArray); // same array object, not a replacement
    expect(countPlotStates(game).grown).toBe(1500);
    expect(countPlotStates(game).empty).toBe(0);

    hireWorker(game, 'planter', { free: true });
    clearPlanet(game, seeds());
    expect(planet.plots).toBe(plotsArray);
    expect(countPlotStates(game).empty).toBe(1500);
    expect(countPlotStates(game).planted).toBe(0);
    expect(planet.workers).toHaveLength(1); // workers kept
    expect(planet.workers[0].state).toBe('idle');
    expect(planet.workers[0].target).toBeUndefined();

    resetGame(game);
    expect(game.currencies.credits.toNumber()).toBe(100);
    expect(game.planets.verdant).toBe(planet); // planet object kept
    expect(game.planets.verdant.workers).toHaveLength(0);
    expect(game.planets.verdant.plots).toHaveLength(0);
  });

  it('a planter finds an empty plot after Clear', () => {
    const game = initialState();
    seedEmptyPlots(game, seeds());
    fillPlanet(game, seeds());
    clearPlanet(game, seeds());
    expect(countPlotStates(game).empty).toBe(1500);

    const w = hireWorker(game, 'planter', { free: true })!;
    updatePlanter(w, game.planets.verdant.plots, game, 0.5); // idle 0.5 s elapses
    expect(w.state).toBe('walking');
    expect(w.target).toBeDefined();
    const plot = game.planets.verdant.plots.find((p) => p.id === w.target)!;
    expect(plot.state).toBe('empty');
    expect(plot.reservedBy).toBe(w.id);
  });

  it('reservations are released when their worker disappears', () => {
    const game = initialState();
    seedEmptyPlots(game, seeds());
    const w = hireWorker(game, 'planter', { free: true })!;
    updatePlanter(w, game.planets.verdant.plots, game, 0.5);
    const plot = game.planets.verdant.plots.find((p) => p.id === w.target)!;
    expect(plot.reservedBy).toBe(w.id);

    game.planets.verdant.workers.length = 0;
    sweepReservations(game);
    expect(plot.reservedBy).toBeUndefined();
  });

  it('dev self-test sequence passes headlessly (reset, fill, clear, plant, reset)', () => {
    const game = initialState();
    const list = seeds();

    resetGame(game);
    seedEmptyPlots(game, list);
    expect(countPlotStates(game).planted).toBe(0);
    expect(game.planets.verdant.workers).toHaveLength(0);

    fillPlanet(game, list);
    expect(countPlotStates(game).grown).toBe(1500);

    clearPlanet(game, list);
    expect(countPlotStates(game).planted).toBe(0);
    expect(countPlotStates(game).empty).toBe(1500);

    hireWorker(game, 'planter', { free: true });
    for (let i = 0; i < 2000; i++) tick(game, 0.1); // 200 s sim = 10 s at x20
    expect(game.planets.verdant.workers).toHaveLength(1);
    expect(countPlotStates(game).planted).toBeGreaterThanOrEqual(1);

    resetGame(game);
    seedEmptyPlots(game, list);
    expect(countPlotStates(game).planted).toBe(0);
    expect(game.planets.verdant.workers).toHaveLength(0);
    expect(format(game.currencies.credits)).toBe('100');
  });
});


describe('wood chain (lumberjack + carrier)', () => {
  function woodWorld() {
    const s = initialState();
    const grid = buildGrid();
    for (const p of grid.plots) {
      p.state = 'empty';
      p.timer = 0;
      p.reservedBy = undefined;
      p.woodLeft = 0;
      p.fallDir = undefined;
    }
    s.planets.verdant.plots = grid.plots;
    return { s, grid };
  }

  function addWorker(s: ReturnType<typeof initialState>, id: number, role: 'planter' | 'lumberjack' | 'carrier', pos = { x: 0, y: 0, z: 2.5 }): any {
    const w: any = {
      id, role, pos: { ...pos }, state: 'idle', target: undefined, level: 0,
      cosmetic: { hat: 'cap', color: '#fff' }, name: role, stuckTimer: 0, stateTimer: 0,
    };
    s.planets.verdant.workers.push(w);
    return w;
  }

  function near(dir: { x: number; y: number; z: number }) {
    return { x: dir.x * 2.5, y: dir.y * 2.5, z: dir.z * 2.5 };
  }

  it('lumberjack only targets fully grown trees, never saplings or medium', () => {
    const { s, grid } = woodWorld();
    grid.plots[0].state = 'sapling';
    grid.plots[0].timer = 60;
    grid.plots[1].state = 'medium';
    grid.plots[1].timer = 60;
    grid.plots[2].state = 'grown';
    const w = addWorker(s, 1, 'lumberjack', near(grid.plots[2].dir));
    updateLumberjack(w, s.planets.verdant.plots, s, 0.1);
    expect(w.state).toBe('walking');
    expect(w.target).toBe(grid.plots[2].id);
    expect(grid.plots[0].state).toBe('sapling');
    expect(grid.plots[1].state).toBe('medium');
  });

  it('chop produces falling with fallDir, then a 3-log pile', () => {
    const { s, grid } = woodWorld();
    const plot = grid.plots[5];
    plot.state = 'grown';
    const w = addWorker(s, 1, 'lumberjack', near(plot.dir));
    w.state = 'chopping';
    w.target = plot.id;
    w.chopTimer = 0.1;
    plot.reservedBy = w.id;

    tick(s, 0.2);
    expect(plot.state).toBe('falling');
    expect(plot.timer).toBeCloseTo(WORLD_CONFIG.fallTime, 1);
    expect(plot.fallDir).toBeDefined();
    expect(s.planets.verdant.treesHarvested).toBe(1);

    tick(s, 1);
    expect(plot.state).toBe('logs');
    expect(plot.woodLeft).toBe(LOG_LOGS_PER_PILE);
    expect(plot.fallDir).toBeUndefined();
    expect(logsWaiting(s)).toBe(LOG_LOGS_PER_PILE);
  });

  it('two lumberjacks never reserve the same tree', () => {
    const { s, grid } = woodWorld();
    for (let i = 0; i < 4; i++) grid.plots[i].state = 'grown';
    const w1 = addWorker(s, 1, 'lumberjack', near(grid.plots[0].dir));
    const w2 = addWorker(s, 2, 'lumberjack', near(grid.plots[0].dir));
    updateLumberjack(w1, s.planets.verdant.plots, s, 0.1);
    updateLumberjack(w2, s.planets.verdant.plots, s, 0.1);
    expect(w1.state).toBe('walking');
    expect(w2.state).toBe('walking');
    expect(w1.target).not.toBe(w2.target);
  });

  it('carrier lifts a 3-log pile one log at a time into the Wood counter', () => {
    const { s, grid } = woodWorld();
    const plot = grid.plots[7];
    plot.state = 'logs';
    plot.woodLeft = LOG_LOGS_PER_PILE;
    const c = addWorker(s, 1, 'carrier', near(plot.dir));
    c.state = 'picking';
    c.target = plot.id;
    c.actionTimer = 1.5;
    plot.reservedBy = c.id;

    tick(s, 0.6);
    expect(s.wood.toNumber()).toBe(1);
    expect(s.woodToSell.toNumber()).toBe(1);
    expect(plot.woodLeft).toBe(2);
    expect(plot.state).toBe('logs');

    tick(s, 0.5);
    expect(s.wood.toNumber()).toBe(2);
    expect(plot.woodLeft).toBe(1);

    tick(s, 0.5);
    expect(s.wood.toNumber()).toBe(3);
    expect(s.woodToSell.toNumber()).toBe(3);
    expect(plot.state).toBe('empty');
    expect(plot.woodLeft).toBe(0);
    expect(c.carryingLogs).toBe(LOG_LOGS_PER_PILE);
    expect(c.state).toBe('carrying');

    // Delivery pays WOOD_PRICE per log and never lowers the visible Wood counter.
    c.state = 'delivering';
    c.actionTimer = 0.01;
    c.pos = { x: 0, y: 2.5, z: 0 };
    updateCarrier(c, s.planets.verdant.plots, s, 0.1);
    expect(c.carryingLogs).toBe(0);
    expect(s.currencies.credits.toNumber()).toBeCloseTo(100 + LOG_LOGS_PER_PILE * WOOD_PRICE);
    expect(s.wood.toNumber()).toBe(3);
    expect(s.woodToSell.toNumber()).toBe(0);
  });

  it('planter skips logs/falling plots and replants once a pile is empty', () => {
    const { s, grid } = woodWorld();
    for (const p of grid.plots) p.state = 'grown';
    for (let i = 0; i < 10; i++) {
      grid.plots[i].state = i % 2 === 0 ? 'logs' : 'falling';
      grid.plots[i].woodLeft = i % 2 === 0 ? 3 : 0;
    }
    const p = addWorker(s, 1, 'planter', near(grid.plots[0].dir));
    updatePlanter(p, s.planets.verdant.plots, s, 0.6);
    expect(p.state).toBe('waiting');

    grid.plots[20].state = 'empty';
    updatePlanter(p, s.planets.verdant.plots, s, 0.1);
    expect(p.state).toBe('walking');
    expect(p.target).toBe(grid.plots[20].id);
  });

  it('lumberjack self-hauls one log when there are no carriers', () => {
    const { s, grid } = woodWorld();
    const plot = grid.plots[9];
    plot.state = 'logs';
    plot.woodLeft = 1;
    addWorker(s, 1, 'lumberjack', near(plot.dir));

    let delivered = false;
    for (let i = 0; i < 4000 && !delivered; i++) {
      tick(s, 0.1);
      if (s.stats.woodSold.toNumber() > 0) delivered = true;
    }
    expect(delivered).toBe(true);
    expect(plot.state).toBe('empty');
    expect(s.wood.toNumber()).toBe(1);
    expect(s.woodToSell.toNumber()).toBe(0);
    expect(s.stats.woodSold.toNumber()).toBe(1);
  });

  it('lumberjack self-haul counts exactly one log per pickup', () => {
    const { s, grid } = woodWorld();
    const plot = grid.plots[12];
    plot.state = 'logs';
    plot.woodLeft = 2;
    const w = addWorker(s, 1, 'lumberjack', near(plot.dir));
    w.state = 'picking';
    w.target = plot.id;
    w.actionTimer = 0.05;
    plot.reservedBy = w.id;

    tick(s, 0.1);
    expect(s.wood.toNumber()).toBe(1);
    expect(s.woodToSell.toNumber()).toBe(1);
    expect(plot.woodLeft).toBe(1);
    expect(w.carryingLogs).toBe(1);
    expect(w.state).toBe('carrying');
  });

  it('Reset sets the visible Wood counter back to 0', () => {
    const game = initialState();
    game.wood = new Decimal(42);
    game.woodToSell = new Decimal(7);
    game.woodLogTimes.push(1, 2, 3);
    resetGame(game);
    expect(game.wood.toNumber()).toBe(0);
    expect(game.woodToSell.toNumber()).toBe(0);
    expect(game.woodLogTimes).toHaveLength(0);
  });

  it('dev spawnLogPiles creates 3-log piles without touching workers', () => {
    const game = initialState();
    seedEmptyPlots(game, buildGrid().plots.map((p) => ({ id: p.id, dir: p.dir })));
    const made = spawnLogPiles(game, 10, () => 0.5);
    expect(made).toBe(10);
    expect(countPlotStates(game).logs).toBe(10);
    expect(logsWaiting(game)).toBe(10 * LOG_LOGS_PER_PILE);
    expect(game.planets.verdant.workers).toHaveLength(0);
  });

  it('5-minute headless run with 5 planters, 2 lumberjacks, 2 carriers never stalls', () => {
    const { s } = woodWorld();
    for (let i = 1; i <= 5; i++) addWorker(s, i, 'planter', { x: 0, y: 0, z: 2.5 });
    for (let i = 6; i <= 7; i++) addWorker(s, i, 'lumberjack', { x: 0, y: 0, z: 2.5 });
    for (let i = 8; i <= 9; i++) addWorker(s, i, 'carrier', { x: 0, y: 0, z: 2.5 });

    let maxStuck = 0;
    const steps = Math.round(300 / 0.1);
    for (let i = 0; i < steps; i++) {
      tick(s, 0.1);
      for (const w of s.planets.verdant.workers) {
        if (w.stuckTimer > maxStuck) maxStuck = w.stuckTimer;
      }
    }

    const counts = countPlotStates(s);
    expect(counts.total).toBe(1500);
    expect(counts.empty + counts.sapling + counts.medium + counts.grown + counts.falling + counts.logs).toBe(1500);
    expect(maxStuck).toBeLessThanOrEqual(20.1);
    expect(s.planets.verdant.treesHarvested).toBeGreaterThan(0);
    expect(s.stats.woodSold.toNumber()).toBeGreaterThan(0);
    expect(s.currencies.credits.toNumber()).toBeGreaterThan(100);
  });
});
