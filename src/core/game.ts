// Shared game state helpers for the dev actions (Fill / Clear / Reset).
// Everything mutates the ONE game object it is given: no copies, no new arrays
// replacing the ones other systems hold references to.

import { initialState } from './state';
import type { GameState, PlanetId, PlotStage, ResourceId, Vec3 } from './state';
import { upgradeCost, upgradeMaxLevel } from './config/upgrades';
import { gte, sub } from './money';

export interface PlotSeed {
  id: number;
  dir: Vec3;
}

const RESOURCE_KEYS: ResourceId[] = ['wood', 'stone', 'ore', 'crystal', 'planks', 'bricks', 'parts'];

function resetWorkers(g: GameState): void {
  for (const w of g.planets.verdant.workers) {
    w.state = 'idle';
    w.target = undefined;
    w.plantTimer = undefined;
    w.stuckTimer = 0;
    w.stateTimer = 0;
    w.chopTimer = undefined;
    w.actionTimer = undefined;
    w.carryingLogs = 0;
    w.standDir = undefined;
  }
}

/** Rebuild the verdant plot array IN PLACE so every holder sees the change. */
function rebuildPlots(g: GameState, seeds: PlotSeed[], state: PlotStage): number {
  const planet = g.planets.verdant;
  const plots = planet.plots;
  plots.length = 0;
  for (const seed of seeds) {
    plots.push({
      id: seed.id,
      dir: { x: seed.dir.x, y: seed.dir.y, z: seed.dir.z },
      state,
      timer: 0,
      reservedBy: undefined,
      woodLeft: 0,
      fallDir: undefined,
      popTimer: undefined,
    });
  }
  planet.usablePlotCount = plots.length;
  resetWorkers(g);
  return plots.length;
}

/** All plots exist and are 'empty' (full grid, nothing planted). */
export function seedEmptyPlots(g: GameState, seeds: PlotSeed[]): number {
  return rebuildPlots(g, seeds, 'empty');
}

/** Fill: every plot is grown; reservations cleared, planters idle. */
export function fillPlanet(g: GameState, seeds: PlotSeed[]): number {
  return rebuildPlots(g, seeds, 'grown');
}

/** Clear: every plot is empty again; workers are kept but idle. */
export function clearPlanet(g: GameState, seeds: PlotSeed[]): number {
  return rebuildPlots(g, seeds, 'empty');
}

/**
 * Reset the SAME game object in place: empty planet, 100 credits, no workers.
 * Object identities of `g` and `g.planets[...]` are preserved on purpose.
 */
export function resetGame(g: GameState): void {
  const fresh = initialState();

  g.version = fresh.version;
  g.lastSaved = Date.now();
  g.currencies.credits = fresh.currencies.credits;
  g.currencies.gems = fresh.currencies.gems;
  g.currencies.starDust = fresh.currencies.starDust;
  g.wood = fresh.wood;
  g.woodToSell = fresh.woodToSell;
  g.simSeconds = 0;
  g.woodLogTimes.length = 0;

  for (const pid of Object.keys(g.planets) as PlanetId[]) {
    const dst = g.planets[pid];
    const src = fresh.planets[pid];
    dst.unlocked = src.unlocked;
    for (const key of RESOURCE_KEYS) {
      dst.resources[key] = src.resources[key];
    }
    dst.plots.length = 0;
    dst.workers.length = 0;
    dst.buildings = {};
    dst.treesHarvested = 0;
    dst.toolsCrafted = 0;
    dst.usablePlotCount = 0;
  }

  g.upgrades = { ...fresh.upgrades };
  g.prestige = { count: fresh.prestige.count, starDust: fresh.prestige.starDust, perks: { ...fresh.prestige.perks } };
  g.quests.length = 0;
  g.stats = { ...fresh.stats };
  g.settings = { ...fresh.settings };
}

export interface PlotCounts {
  total: number;
  empty: number;
  sapling: number;
  medium: number;
  grown: number;
  falling: number;
  logs: number;
  planted: number;
}

/** Count plots by stage straight from the state (single source of truth). */
export function countPlotStates(g: GameState): PlotCounts {
  const counts: PlotCounts = { total: 0, empty: 0, sapling: 0, medium: 0, grown: 0, falling: 0, logs: 0, planted: 0 };
  for (const p of g.planets.verdant.plots) {
    counts.total += 1;
    counts[p.state] += 1;
    if (p.state !== 'empty') counts.planted += 1;
  }
  return counts;
}

/** Release reservations held by workers that no longer exist. */
export function sweepReservations(g: GameState): void {
  const live = new Set(g.planets.verdant.workers.map((w) => w.id));
  for (const p of g.planets.verdant.plots) {
    if (p.reservedBy !== undefined && !live.has(p.reservedBy)) {
      p.reservedBy = undefined;
    }
  }
}

/** Dev action: every planted tree becomes fully grown immediately. */
export function growAllTrees(g: GameState): number {
  let n = 0;
  for (const p of g.planets.verdant.plots) {
    if (p.state === 'sapling' || p.state === 'medium') {
      p.state = 'grown';
      p.timer = 0;
      p.popTimer = 0.35;
      n += 1;
    }
  }
  return n;
}

/** Dev action: turn up to `count` grown/empty plots into 3-log piles. */
export function spawnLogPiles(g: GameState, count: number, rng: () => number = Math.random): number {
  const candidates = g.planets.verdant.plots.filter((p) => p.state === 'grown' || p.state === 'empty');
  let spawned = 0;
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const idx = Math.floor(rng() * candidates.length) % candidates.length;
    const plot = candidates.splice(idx, 1)[0];
    plot.state = 'logs';
    plot.woodLeft = 3;
    plot.timer = 0;
    plot.reservedBy = undefined;
    plot.fallDir = undefined;
    plot.popTimer = 0.35;
    spawned += 1;
  }
  return spawned;
}

/** Total logs still lying in piles (drives the "Logs waiting" UI stat). */
export function logsWaiting(g: GameState): number {
  let n = 0;
  for (const p of g.planets.verdant.plots) {
    if (p.state === 'logs') n += p.woodLeft ?? 0;
  }
  return n;
}

/** Buy one upgrade level. Returns true on success, false if unaffordable or at max. */
export function buyUpgrade(g: GameState, id: string): boolean {
  const level = g.upgrades[id as keyof typeof g.upgrades] ?? 0;
  const max = upgradeMaxLevel(id as any);
  if (max !== undefined && level >= max) return false;
  const cost = upgradeCost(id as any, level);
  if (!gte(g.currencies.credits, cost)) return false;
  g.currencies.credits = sub(g.currencies.credits, cost);
  (g.upgrades as any)[id] = level + 1;
  return true;
}
