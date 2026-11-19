import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/core/state';
import { captureProgression, applyProgression } from '../src/core/progression';
import { captureWorld, applyWorld } from '../src/core/worldSnapshot';
import { deserializeProgression, deserializeWorld, serialize } from '../src/core/save';
import { hireWorker } from '../src/core/workers';
import { sellWood } from '../src/core/progressionCommands';
import { applyOffline } from '../src/core/offline';
import { resetGame } from '../src/core/game';
import { LocalStorageProgressionRepository } from '../src/persistence/localCache';
import { LayeredProgressionStore, REMOTE_DEBOUNCE_MS } from '../src/persistence/layeredStore';
import { Progression } from '../src/app/progression';
import { LEGACY_STORAGE_KEY } from '../src/persistence/legacySave';
import type { ProgressionRepository } from '../src/core/ports';
import type { ProgressionSnapshot } from '../src/core/progression';

const userId = 'anon:test';
let entries: Map<string, string>;

beforeEach(() => {
  entries = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('progression snapshots', () => {
  it('separates durable roster from local world positions and applies both in place', () => {
    const state = initialState(100);
    const worker = hireWorker(state, 'planter', { free: true })!;
    worker.pos = { x: 1, y: 2, z: 3 };
    state.planets.verdant.plots.push({ id: 0, dir: { x: 1, y: 0, z: 0 }, state: 'grown', timer: 0 });
    const progress = deserializeProgression(serialize(captureProgression(state, 3, 100)))!;
    const world = deserializeWorld(serialize(captureWorld(state)))!;
    expect(progress.planets.verdant.workers[0]).not.toHaveProperty('pos');
    expect(progress.planets.verdant).not.toHaveProperty('plots');
    expect(world.planets.verdant.positions[0].pos).toEqual(worker.pos);

    const target = initialState();
    const planet = target.planets.verdant;
    const plots = planet.plots;
    const workers = planet.workers;
    target.planets.verdant.plots.push({ id: 9, dir: { x: 0, y: 1, z: 0 }, state: 'empty', timer: 0, reservedBy: 999 });
    applyProgression(target, progress);
    expect(target.planets.verdant.plots[0].reservedBy).toBeUndefined();
    applyWorld(target, world);
    expect(target.planets.verdant).toBe(planet);
    expect(planet.plots).toBe(plots);
    expect(planet.workers).toBe(workers);
    expect(planet.workers[0].pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(planet.plots[0].state).toBe('grown');
    expect(target.lastSaved).toBe(100);
  });

  it('migrates the old full save and reads the split cache on the next load', () => {
    const legacy = initialState(500);
    legacy.planets.verdant.plots.push({ id: 0, dir: { x: 1, y: 0, z: 0 }, state: 'logs', timer: 0, woodLeft: 2 });
    hireWorker(legacy, 'carrier', { free: true });
    entries.set(LEGACY_STORAGE_KEY, serialize(legacy));
    const cache = new LocalStorageProgressionRepository();
    const first = cache.loadGame(userId, 900);
    expect(first.progression?.revision).toBe(0);
    expect(entries.has(LEGACY_STORAGE_KEY)).toBe(false);
    const second = cache.loadGame(userId, 1000);
    expect(second.state.planets.verdant.plots[0].woodLeft).toBe(2);
    expect(second.state.planets.verdant.workers[0].role).toBe('carrier');
    expect(second.state.currencies.credits.eq(legacy.currencies.credits)).toBe(true);
  });

  it('sells wood deterministically without ambient time or I/O', () => {
    const state = initialState();
    state.woodToSell = state.woodToSell.add(3);
    expect(sellWood(state, 2).toNumber()).toBe(4);
    expect(state.woodToSell.toNumber()).toBe(1);
    expect(state.stats.woodSold.toNumber()).toBe(2);
  });

  it('uses injected worker ids without colliding with restored workers', () => {
    const state = initialState();
    const first = hireWorker(state, 'planter', { free: true, ids: { next: () => 7 } })!;
    const second = hireWorker(state, 'carrier', { free: true, ids: { next: () => 7 } })!;
    expect([first.id, second.id]).toEqual([7, 8]);
  });

  it('uses supplied timestamps for initial, reset, and offline state', () => {
    const state = initialState(123);
    expect(state.lastSaved).toBe(123);
    resetGame(state, 456);
    expect(state.lastSaved).toBe(456);
    applyOffline(state, { creditsGained: state.currencies.credits, secondsOffline: 1, capped: false }, 789);
    expect(state.lastSaved).toBe(789);
  });
});

describe('layered store', () => {
  it('routes simulation and dev progression through the class, local cache, and remote queue', async () => {
    vi.useFakeTimers();
    const state = initialState();
    const cache = new LocalStorageProgressionRepository();
    const sent: ProgressionSnapshot[] = [];
    const store = new LayeredProgressionStore(state, userId, cache, {
      load: async () => null,
      save: async (_id, snapshot) => { sent.push(snapshot); },
    }, { now: () => 20 }, () => {}, null);
    const progression = new Progression(state, store);
    progression.hire('planter', true);
    progression.advance(0.1);
    progression.devChange((game) => { game.currencies.credits = game.currencies.credits.add(5); });

    const cached = cache.loadSync(userId)!;
    expect(cached.planets.verdant.workers).toHaveLength(1);
    expect(cached.currencies.starDust.gt(0)).toBe(true);
    expect(cached.currencies.credits.toNumber()).toBe(105);
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0].currencies.credits.toNumber()).toBe(105);
    expect(sent[0].currencies.starDust.gt(0)).toBe(true);
  });

  it('saves locally at once, sends only the latest progression after debounce, and lets remote win a tie', async () => {
    vi.useFakeTimers();
    const cache = new LocalStorageProgressionRepository();
    const state = initialState();
    const remoteState = initialState();
    remoteState.currencies.credits = remoteState.currencies.credits.add(100);
    const remoteSnapshot = captureProgression(remoteState, 1, 7);
    const sent: ProgressionSnapshot[] = [];
    const remote: ProgressionRepository = {
      load: async () => remoteSnapshot,
      save: async (_id, snapshot) => { sent.push(snapshot); },
    };
    const store = new LayeredProgressionStore(state, userId, cache, remote, { now: () => 10 }, () => {}, null);
    const loaded = store.start();
    state.currencies.credits = state.currencies.credits.add(1);
    store.saveCurrent();
    expect(cache.loadSync(userId)?.currencies.credits.toNumber()).toBe(101);
    await loaded;
    expect(state.currencies.credits.toNumber()).toBe(200);
    state.currencies.credits = state.currencies.credits.add(1);
    store.saveCurrent();
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0].currencies.credits.toNumber()).toBe(201);
    expect(sent[0].planets.verdant).not.toHaveProperty('plots');
  });

  it('ignores failed remote reads and keeps a newer local revision', async () => {
    const state = initialState();
    const cache = new LocalStorageProgressionRepository();
    const local = captureProgression(state, 5, 50);
    const remote = captureProgression(initialState(), 4, 40);
    const store = new LayeredProgressionStore(state, userId, cache,
      { load: async () => remote, save: async () => { throw new Error('offline'); } },
      { now: () => 60 }, () => {}, local);
    await store.start();
    expect(state.lastSaved).toBe(0);
    const failing = new LayeredProgressionStore(state, userId, cache,
      { load: async () => { throw new Error('offline'); }, save: async () => {} },
      { now: () => 60 }, () => {}, local);
    await failing.start();
    expect(state.currencies.credits.toNumber()).toBe(100);
  });

  it('cancels a queued local write when an equal remote revision wins', async () => {
    vi.useFakeTimers();
    const state = initialState();
    const cache = new LocalStorageProgressionRepository();
    const remoteState = initialState();
    remoteState.currencies.credits = remoteState.currencies.credits.add(50);
    const sent: ProgressionSnapshot[] = [];
    const store = new LayeredProgressionStore(state, userId, cache, {
      load: async () => captureProgression(remoteState, 1, 10),
      save: async (_id, snapshot) => { sent.push(snapshot); },
    }, { now: () => 10 }, () => {}, null);
    const loaded = store.start();
    state.currencies.credits = state.currencies.credits.add(1);
    store.saveCurrent();
    await loaded;
    expect(state.currencies.credits.toNumber()).toBe(150);
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    expect(sent).toHaveLength(0);
  });

  it('queues a newer cached revision when the remote is behind', async () => {
    vi.useFakeTimers();
    const state = initialState(50);
    const local = captureProgression(state, 5, 50);
    const sent: ProgressionSnapshot[] = [];
    const store = new LayeredProgressionStore(state, userId,
      new LocalStorageProgressionRepository(), {
        load: async () => captureProgression(initialState(), 4, 40),
        save: async (_id, snapshot) => { sent.push(snapshot); },
      }, { now: () => 60 }, () => {}, local);
    await store.start();
    await vi.advanceTimersByTimeAsync(REMOTE_DEBOUNCE_MS);
    expect(sent.map((snapshot) => snapshot.revision)).toEqual([5]);
  });
});
