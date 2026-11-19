import { describe, expect, it } from 'vitest';
import { initialState } from '../src/core/state';
import { hireWorker } from '../src/core/workers';
import { restoreWorld } from '../src/core/restore';
import { deserialize, serialize } from '../src/core/save';
import { tick } from '../src/core/sim';
import { incomePerSecond } from '../src/core/economy';

const seeds = [
  { id: 0, dir: { x: 1, y: 0, z: 0 } },
  { id: 1, dir: { x: 0, y: 1, z: 0 } },
];

describe('world restore', () => {
  it('round trips plots and workers, then clears transient AI state in place', () => {
    const state = initialState();
    restoreWorld(state, seeds);
    const plots = state.planets.verdant.plots;
    plots[0].state = 'grown';
    plots[0].dir = { x: 0, y: 0, z: 1 };
    plots[0].reservedBy = 42;
    plots[0].popTimer = 1;
    plots[1].state = 'logs';
    plots[1].woodLeft = 2;
    const worker = hireWorker(state, 'planter', { free: true })!;
    worker.state = 'planting';
    worker.target = 0;
    worker.plantTimer = 1;
    worker.carryingLogs = 2;

    const loaded = deserialize(serialize(state))!;
    const loadedPlots = loaded.planets.verdant.plots;
    const loadedWorkers = loaded.planets.verdant.workers;
    restoreWorld(loaded, seeds);

    expect(loaded.planets.verdant.plots).toBe(loadedPlots);
    expect(loaded.planets.verdant.workers).toBe(loadedWorkers);
    expect(loadedPlots.map((p) => p.state)).toEqual(['grown', 'logs']);
    expect(loadedPlots[1].woodLeft).toBe(2);
    expect(loadedPlots[0].dir).toEqual(seeds[0].dir);
    expect(loadedPlots[0].reservedBy).toBeUndefined();
    expect(loadedPlots[0].popTimer).toBeUndefined();
    expect(loadedWorkers).toHaveLength(1);
    expect(loadedWorkers[0]).toMatchObject({ role: 'planter', state: 'idle', stuckTimer: 0, carryingLogs: 0 });
    expect(loadedWorkers[0].target).toBeUndefined();
    expect(loadedWorkers[0].plantTimer).toBeUndefined();
    expect(loaded.planets.verdant.usablePlotCount).toBe(2);
  });

  it('seeds an empty grid when saved plot ids differ', () => {
    const state = initialState();
    restoreWorld(state, seeds);
    state.planets.verdant.plots[0].id = 7;
    state.planets.verdant.plots[1].state = 'grown';
    const plots = state.planets.verdant.plots;

    restoreWorld(state, seeds);

    expect(state.planets.verdant.plots).toBe(plots);
    expect(plots.map((p) => [p.id, p.state])).toEqual([[0, 'empty'], [1, 'empty']]);
  });

  it('drops invalid workers and defaults missing numeric fields', () => {
    const state = initialState();
    const valid = hireWorker(state, 'carrier', { free: true })!;
    const raw = JSON.parse(serialize(state));
    delete raw.planets.verdant.workers[0].level;
    delete raw.planets.verdant.workers[0].stuckTimer;
    raw.planets.verdant.workers.push({ ...raw.planets.verdant.workers[0], id: valid.id + 1, role: 'miner' });
    raw.planets.verdant.workers.push({ ...raw.planets.verdant.workers[0], id: valid.id + 2, pos: { x: null, y: 0, z: 0 } });
    const loaded = deserialize(JSON.stringify(raw))!;

    expect(loaded.planets.verdant.workers).toHaveLength(1);
    expect(loaded.planets.verdant.workers[0].level).toBe(0);
    expect(loaded.planets.verdant.workers[0].stuckTimer).toBe(0);
  });

  it('resumes worker AI and income after loading', () => {
    const state = initialState();
    restoreWorld(state, seeds);
    const planter = hireWorker(state, 'planter', { free: true })!;
    const before = incomePerSecond(state);
    const loaded = deserialize(serialize(state))!;
    restoreWorld(loaded, seeds);

    expect(loaded.planets.verdant.workers[0].id).toBe(planter.id);
    expect(incomePerSecond(loaded).eq(before)).toBe(true);
    tick(loaded);
    expect(loaded.planets.verdant.workers[0].state).toBe('walking');
    expect(loaded.planets.verdant.plots.some((plot) => plot.reservedBy === planter.id)).toBe(true);
  });
});
