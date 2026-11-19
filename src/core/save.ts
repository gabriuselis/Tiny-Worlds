import Decimal from 'break_infinity.js';
import { initialState, SAVE_VERSION, MIN_SUPPORTED_SAVE_VERSION, type UpgradeId } from './state';
import { toMoney } from './money';
import type { GameState } from './state';

const STORAGE_KEY = 'tiny_worlds_save_v1';

export function serialize(state: GameState): string {
  // JSON.stringify calls Decimal.toJSON before the replacer runs, so `value` is already a
  // string here; the untouched original is only reachable through `this[key]`.
  return JSON.stringify(state, function (this: any, key: string, value: unknown) {
    const original = this[key];
    if (original instanceof Decimal) return { __decimal: original.toString() };
    return value;
  });
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

const UPGRADE_KEYS: UpgradeId[] = ['planter', 'lumberjack', 'carrier', 'plantSpeed', 'chopSpeed', 'woodValue', 'tapPower', 'maxTrees'];

function normalizeUpgrades(merged: GameState): void {
  if (!merged.upgrades || typeof merged.upgrades !== 'object') {
    merged.upgrades = { planter: 0, lumberjack: 0, carrier: 0, plantSpeed: 0, chopSpeed: 0, woodValue: 0, tapPower: 0, maxTrees: 0 };
  }
  for (const key of UPGRADE_KEYS) {
    const v = (merged.upgrades as any)[key];
    (merged.upgrades as any)[key] = Number.isFinite(v) ? Math.max(0, Math.floor(Number(v))) : 0;
  }
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

export function deserialize(json: string): GameState | null {
  try {
    const raw = JSON.parse(json, (_key, value) => {
      if (value && value.__decimal !== undefined) return new Decimal(value.__decimal);
      return value;
    });

    // Version check: discard old saves
    if (!raw || raw.version === undefined || raw.version < MIN_SUPPORTED_SAVE_VERSION) {
      return null;
    }

    // Deep-merge loaded data over defaults so missing arrays/fields get defaults
    const defaults = initialState();
    const merged = deepMerge(defaults, raw) as GameState;
    normalizeMoney(merged, defaults);
    merged.simSeconds = Number.isFinite(merged.simSeconds) ? merged.simSeconds : 0;
    merged.woodLogTimes = Array.isArray(merged.woodLogTimes)
      ? merged.woodLogTimes.filter((t) => typeof t === 'number' && Number.isFinite(t))
      : [];
normalizePlots(merged);
    normalizeUpgrades(merged);
    merged.version = SAVE_VERSION;
    return merged;
  } catch {
    return null;
  }
}

export function save(state: GameState): void {
  try {
    state.version = SAVE_VERSION;
    localStorage.setItem(STORAGE_KEY, serialize(state));
  } catch {}
}

export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserialize(raw);
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return null;
  }
}

export function clearSave(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function exportSave(state: GameState): string {
  return serialize(state);
}

export function importSave(json: string): GameState | null {
  return deserialize(json);
}

