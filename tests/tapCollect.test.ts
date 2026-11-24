import { describe, it, expect } from 'vitest';
import { initialState } from '../src/core/state';
import { buildGrid } from '../src/core/grid';
import { hireWorker } from '../src/core/workers';
import { tick } from '../src/core/sim';
import { collectPileByPlayer, processPlayerCollection } from '../src/core/wood';
import { COLLECT_LOG_INTERVAL, LOG_LOGS_PER_PILE, WOOD_PRICE } from '../src/core/config/world';

function tapWorld() {
  const s = initialState();
  const grid = buildGrid();
  for (const p of grid.plots) {
    p.state = 'empty';
    p.timer = 0;
    p.reservedBy = undefined;
    p.woodLeft = 0;
    p.fallDir = undefined;
    p.collectQueue = 0;
    p.collectTimer = 0;
    p.beingCollected = false;
  }
  s.planets.verdant.plots = grid.plots;
  return { s, grid };
}

function drain(s: ReturnType<typeof initialState>, times: number) {
  for (let i = 0; i < times; i++) processPlayerCollection(s, COLLECT_LOG_INTERVAL);
}

describe('tap collect (core rules A-D)', () => {
  it('one tap collects 3 wood and empties the plot', () => {
    const { s, grid } = tapWorld();
    const plot = grid.plots[5];
    plot.state = 'logs';
    plot.woodLeft = LOG_LOGS_PER_PILE;

    const collected = collectPileByPlayer(s, plot.id);
    expect(collected).toBe(LOG_LOGS_PER_PILE);
    expect(s.wood.toNumber()).toBe(0); // wood is added as the queue drains

    drain(s, LOG_LOGS_PER_PILE);

    expect(s.wood.toNumber()).toBe(3);
    expect(s.currencies.credits.toNumber()).toBe(100 + 3 * WOOD_PRICE);
    expect(plot.state).toBe('empty');
    expect(plot.woodLeft).toBe(0);
    expect(plot.reservedBy).toBeUndefined();
  });

  it('tapping an empty or growing plot does nothing', () => {
    const { s, grid } = tapWorld();
    grid.plots[0].state = 'empty';
    grid.plots[1].state = 'sapling';
    grid.plots[2].state = 'medium';
    grid.plots[3].state = 'grown';

    for (const p of [grid.plots[0], grid.plots[1], grid.plots[2], grid.plots[3]]) {
      expect(collectPileByPlayer(s, p.id)).toBe(0);
    }
    expect(s.wood.toNumber()).toBe(0);
    expect(s.woodToSell.toNumber()).toBe(0);
  });

  it('collecting the same pile twice adds wood only once', () => {
    const { s, grid } = tapWorld();
    const plot = grid.plots[6];
    plot.state = 'logs';
    plot.woodLeft = LOG_LOGS_PER_PILE;

    expect(collectPileByPlayer(s, plot.id)).toBe(LOG_LOGS_PER_PILE);
    expect(collectPileByPlayer(s, plot.id)).toBe(0); // already draining

    drain(s, LOG_LOGS_PER_PILE);

    expect(s.wood.toNumber()).toBe(3);
    expect(plot.state).toBe('empty');
  });

  it('a pile reserved by a carrier is not double counted', () => {
    const { s, grid } = tapWorld();
    const plot = grid.plots[7];
    plot.state = 'logs';
    plot.woodLeft = 2; // carrier already lifted 1
    plot.reservedBy = 44;
    s.wood = s.wood.add(1);
    s.woodToSell = s.woodToSell.add(1);

    const carrier: any = {
      id: 44, role: 'carrier', pos: { x: 0, y: 0, z: 2.5 }, state: 'picking',
      target: plot.id, level: 0, cosmetic: { hat: 'cap', color: '#fff' }, name: 'c',
      stuckTimer: 0, stateTimer: 1.5, actionTimer: 1.0, carryingLogs: 1,
    };
    s.planets.verdant.workers.push(carrier);

    expect(collectPileByPlayer(s, plot.id)).toBe(2);
    drain(s, 2);
    tick(s, 0.1); // carrier reacts and aborts

    expect(s.wood.toNumber()).toBe(3); // 1 (carrier) + 2 (player), never 4
    expect(carrier.state).toBe('idle');
    expect(plot.state).toBe('empty');
  });

  it('a planter can plant on the plot right after', () => {
    const { s, grid } = tapWorld();
    const target = grid.plots[25];
    for (const p of grid.plots) if (p.id !== target.id) p.state = 'grown';
    target.state = 'logs';
    target.woodLeft = LOG_LOGS_PER_PILE;

    collectPileByPlayer(s, target.id);
    drain(s, LOG_LOGS_PER_PILE);

    expect(target.state).toBe('empty');
    expect(target.reservedBy).toBeUndefined();

    const planter = hireWorker(s, 'planter', { free: true, spawnDir: { x: 0, y: 0, z: 1 } })!;
    for (let i = 0; i < 10; i++) tick(s, 0.1);

    expect(planter.state).toBe('walking');
    expect(planter.target).toBe(target.id);
    expect(target.reservedBy).toBe(planter.id);
  });
});