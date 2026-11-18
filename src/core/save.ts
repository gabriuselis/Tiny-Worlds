import Decimal from 'break_infinity.js';
import { initialState, SAVE_VERSION, MIN_SUPPORTED_SAVE_VERSION, type UpgradeId } from './state';
import { toMoney } from './money';
import type { GameState } from './state';

const STORAGE_KEY = 'tiny_worlds_save_v1';

export function serialize(state: GameState): string {
  const plain: any = JSON.parse(JSON.stringify(state, (_key, value) => {
    if (value instanceof Decimal) return { __decimal: value.toString() };
    return value;
  }));
  return JSON.stringify(plain);
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
    // Normalize credits to a Decimal (Money) so .gte() etc. never crash on plain-number saves
    merged.currencies.credits = toMoney(merged.currencies.credits);
    merged.wood = toMoney(merged.wood);
    merged.woodToSell = toMoney(merged.woodToSell);
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

