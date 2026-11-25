import Decimal from 'break_infinity.js';
import { initialState, SAVE_VERSION, MIN_SUPPORTED_SAVE_VERSION, type UpgradeId, type BlessingId } from './state';
import { toMoney } from './money';
import type { GameState } from './state';
import { captureProgression, PROGRESSION_SCHEMA_VERSION, type ProgressionSnapshot } from './progression';
import { captureWorld, WORLD_SCHEMA_VERSION, type WorldSnapshot } from './worldSnapshot';

export function serialize(state: unknown): string {
  // JSON.stringify calls Decimal.toJSON before the replacer runs, so `value` is already a
  // string here; the untouched original is only reachable through `this[key]`.
  return JSON.stringify(state, function (this: any, key: string, value: unknown) {
    const original = this[key];
    if (original instanceof Decimal) return { __decimal: original.toString() };
    return value;
  });
}

function revive(_key: string, value: any): unknown {
  if (value && value.__decimal !== undefined) return new Decimal(value.__decimal);
  return value;
}

function asMoney(v: unknown, fallback: Decimal): Decimal {
  if (v === undefined || v === null) return fallback;
  try {
    const d = toMoney(v as number | string | Decimal);
    return Number.isNaN(d.mantissa) || Number.isNaN(d.exponent) ? fallback : d;
  } catch {
    return fallback;
  }
}

// Saves written before serialize() was fixed hold Decimals as bare strings.
function normalizeMoney(merged: GameState, defaults: GameState): void {
  merged.currencies.credits = asMoney(merged.currencies.credits, defaults.currencies.credits);
  merged.currencies.starDust = asMoney(merged.currencies.starDust, defaults.currencies.starDust);
  merged.prestige.starDust = asMoney(merged.prestige.starDust, defaults.prestige.starDust);
  merged.wood = asMoney(merged.wood, defaults.wood);
  merged.woodToSell = asMoney(merged.woodToSell, defaults.woodToSell);
  merged.stats.woodSold = asMoney(merged.stats.woodSold, defaults.stats.woodSold);
  merged.stats.lifetimeCredits = asMoney(merged.stats.lifetimeCredits, defaults.stats.lifetimeCredits);
  for (const pid of Object.keys(defaults.planets) as (keyof GameState['planets'])[]) {
    const resources = merged.planets[pid].resources;
    const defaultResources = defaults.planets[pid].resources;
    for (const key of Object.keys(defaultResources) as (keyof typeof defaultResources)[]) {
      resources[key] = asMoney(resources[key], defaultResources[key]);
    }
  }
}

function isPlainObject(v: any): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && v.constructor === Object;
}

function isDecimal(v: any): boolean {
  return typeof v === 'object' && v !== null && typeof v.toNumber === 'function' && typeof v.e === 'number';
}

function deepMerge<T>(defaults: T, loaded: any): T {
  if (!loaded || typeof loaded !== 'object') return defaults;
  const out: any = Array.isArray(defaults) ? [...defaults] : { ...defaults };
  const defKeys = Object.keys(defaults as Record<string, any>);
  for (const key of defKeys) {
    const defVal = (defaults as any)[key];
    const loadVal = loaded[key];
    if (loadVal === undefined) {
      // keep default
    } else if (isDecimal(loadVal)) {
      out[key] = loadVal;
    } else if (isPlainObject(defVal) && isPlainObject(loadVal)) {
      out[key] = deepMerge(defVal, loadVal);
    } else if (Array.isArray(defVal) && Array.isArray(loadVal)) {
      out[key] = loadVal;
    } else {
      out[key] = loadVal;
    }
  }
  return out as T;
}

const PLOT_STATES = new Set(['empty', 'sapling', 'medium', 'grown', 'falling', 'logs']);
const WORKER_ROLES = new Set(['planter', 'lumberjack', 'carrier']);

const UPGRADE_KEYS: UpgradeId[] = ['planter', 'lumberjack', 'carrier', 'plantSpeed', 'chopSpeed', 'woodValue', 'tapPower', 'maxTrees'];

const BLESSING_KEYS: BlessingId[] = ['woodValue', 'planters', 'lumberjacks', 'carrierSpeed', 'carriers', 'woodValue2'];

function normalizeUpgrades(merged: GameState): void {
  if (!merged.upgrades || typeof merged.upgrades !== 'object') {
    merged.upgrades = { planter: 0, lumberjack: 0, carrier: 0, plantSpeed: 0, chopSpeed: 0, woodValue: 0, tapPower: 0, maxTrees: 0 };
  }
  for (const key of UPGRADE_KEYS) {
    const v = (merged.upgrades as any)[key];
    (merged.upgrades as any)[key] = Number.isFinite(v) ? Math.max(0, Math.floor(Number(v))) : 0;
  }
}

function normalizeBlessings(merged: GameState): void {
  if (!Array.isArray(merged.blessings)) {
    merged.blessings = [];
  }
  merged.blessings = merged.blessings.filter((id) => BLESSING_KEYS.includes(id as BlessingId));
}

function normalizePlots(merged: GameState): void {
  for (const pid of Object.keys(merged.planets) as (keyof GameState['planets'])[]) {
    const planet = merged.planets[pid];
    if (!Array.isArray(planet.plots)) { planet.plots = []; continue; }
    for (const plot of planet.plots) {
      if (!PLOT_STATES.has(plot.state as string)) plot.state = 'empty';
      if (!Number.isFinite(plot.timer)) plot.timer = 0;
      const wood = Number.isFinite(plot.woodLeft) ? Number(plot.woodLeft) : 0;
      plot.woodLeft = Math.max(0, Math.min(3, Math.round(wood)));
      if (plot.state === 'logs' && plot.woodLeft === 0) plot.state = 'empty';
      if (plot.state !== 'logs') plot.woodLeft = 0;
      if (plot.state !== 'falling') plot.fallDir = undefined;
    }
  }
}

function normalizeWorkers(merged: GameState): void {
  for (const planet of Object.values(merged.planets)) {
    if (!Array.isArray(planet.workers)) { planet.workers = []; continue; }
    planet.workers = planet.workers.filter((worker) =>
      worker && WORKER_ROLES.has(worker.role) && Number.isFinite(worker.id) &&
      worker.pos && Number.isFinite(worker.pos.x) &&
      Number.isFinite(worker.pos.y) && Number.isFinite(worker.pos.z));
    for (const worker of planet.workers) {
      worker.level = Number.isFinite(worker.level) ? worker.level : 0;
      worker.stuckTimer = Number.isFinite(worker.stuckTimer) ? worker.stuckTimer : 0;
      worker.stateTimer = Number.isFinite(worker.stateTimer) ? worker.stateTimer : 0;
      worker.carryingLogs = Number.isFinite(worker.carryingLogs) ? worker.carryingLogs : 0;
      worker.name = typeof worker.name === 'string' ? worker.name : worker.role;
      if (!worker.cosmetic || typeof worker.cosmetic !== 'object') {
        worker.cosmetic = { hat: 'cap', color: '#ffffff' };
      }
    }
  }
}

export function deserialize(json: string): GameState | null {
  try {
    const raw = JSON.parse(json, revive);

    // Version check: discard old saves
    if (!raw || raw.version === undefined || raw.version < MIN_SUPPORTED_SAVE_VERSION) {
      return null;
    }

    // Deep-merge loaded data over defaults so missing arrays/fields get defaults
    const defaults = initialState();
    const merged = deepMerge(defaults, raw) as GameState;
    normalizeMoney(merged, defaults);
    merged.lastSaved = Number.isFinite(merged.lastSaved) ? merged.lastSaved : defaults.lastSaved;
    merged.simSeconds = Number.isFinite(merged.simSeconds) ? merged.simSeconds : 0;
    merged.woodLogTimes = Array.isArray(merged.woodLogTimes)
      ? merged.woodLogTimes.filter((t) => typeof t === 'number' && Number.isFinite(t))
      : [];
    normalizePlots(merged);
    normalizeWorkers(merged);
    normalizeUpgrades(merged);
    normalizeBlessings(merged);
    if (!Number.isFinite(merged.woodSpent?.toNumber?.())) {
      merged.woodSpent = new Decimal(0);
    }
    merged.version = SAVE_VERSION;
    return merged;
  } catch {
    return null;
  }
}

/** All snapshot migrations and validation stay beside the legacy save migration. */
export function deserializeProgression(json: string): ProgressionSnapshot | null {
  try {
    const raw = JSON.parse(json, revive);
    if (raw?.schemaVersion !== PROGRESSION_SCHEMA_VERSION ||
        !Number.isSafeInteger(raw.revision) || raw.revision < 0 ||
        !Number.isFinite(raw.updatedAt)) return null;
    const planets = Object.fromEntries(Object.entries(raw.planets ?? {}).map(([pid, value]) => {
      const p = value as any;
      return [pid, { ...p, workers: Array.isArray(p?.workers) ? p.workers.map((w: any) => ({
        ...w, pos: { x: 0, y: 1, z: 0 }, state: 'idle', stuckTimer: 0,
      })) : [] }];
    }));
    const state = deserialize(serialize({ ...raw, version: SAVE_VERSION, planets }));
    return state ? captureProgression(state, raw.revision, raw.updatedAt) : null;
  } catch {
    return null;
  }
}

export function deserializeWorld(json: string): WorldSnapshot | null {
  try {
    const raw = JSON.parse(json);
    if (raw?.schemaVersion !== WORLD_SCHEMA_VERSION) return null;
    const planets = Object.fromEntries(Object.entries(raw.planets ?? {}).map(([pid, value]) => {
      const p = value as any;
      return [pid, { plots: Array.isArray(p?.plots) && p.plots.every((plot: any) =>
        plot && Number.isFinite(plot.id) && plot.dir &&
        Number.isFinite(plot.dir.x) && Number.isFinite(plot.dir.y) && Number.isFinite(plot.dir.z))
        ? p.plots : [] }];
    }));
    const state = deserialize(serialize({ version: SAVE_VERSION, planets }));
    if (!state) return null;
    const world = captureWorld(state);
    world.lastSaved = Number.isFinite(raw.lastSaved) ? raw.lastSaved : 0;
    world.simSeconds = Number.isFinite(raw.simSeconds) ? raw.simSeconds : 0;
    world.woodLogTimes = Array.isArray(raw.woodLogTimes)
      ? raw.woodLogTimes.filter((t: unknown) => Number.isFinite(t)) : [];
    for (const pid of Object.keys(world.planets) as (keyof WorldSnapshot['planets'])[]) {
      const entries = raw.planets?.[pid]?.positions;
      world.planets[pid].positions = Array.isArray(entries) ? entries.filter((entry: any) =>
        Number.isFinite(entry?.id) && entry.pos &&
        Number.isFinite(entry.pos.x) && Number.isFinite(entry.pos.y) && Number.isFinite(entry.pos.z)) : [];
    }
    return world;
  } catch {
    return null;
  }
}

export function exportSave(state: GameState): string {
  return serialize(state);
}

export function importSave(json: string): GameState | null {
  return deserialize(json);
}

