import type { GameState, PlanetId, Worker } from './state';
import { PLANET_RADIUS } from './config/world';

export const PROGRESSION_SCHEMA_VERSION = 1;

export type WorkerRosterEntry = Pick<Worker, 'id' | 'role' | 'level' | 'cosmetic' | 'name'>;
export type PlanetProgression = Pick<GameState['planets'][PlanetId],
  'unlocked' | 'resources' | 'buildings' | 'treesHarvested' | 'toolsCrafted'> & {
  workers: WorkerRosterEntry[];
};

export interface ProgressionSnapshot {
  schemaVersion: number;
  revision: number;
  updatedAt: number;
  currencies: GameState['currencies'];
  wood: GameState['wood'];
  woodToSell: GameState['woodToSell'];
  woodSpent: GameState['woodSpent'];
  upgrades: GameState['upgrades'];
  blessings: GameState['blessings'];
  prestige: GameState['prestige'];
  quests: GameState['quests'];
  stats: GameState['stats'];
  settings: GameState['settings'];
  planets: Record<PlanetId, PlanetProgression>;
}

export function captureProgression(state: GameState, revision: number, updatedAt: number): ProgressionSnapshot {
  const planets = {} as ProgressionSnapshot['planets'];
  for (const pid of Object.keys(state.planets) as PlanetId[]) {
    const p = state.planets[pid];
    planets[pid] = {
      unlocked: p.unlocked,
      resources: { ...p.resources },
      buildings: { ...p.buildings },
      treesHarvested: p.treesHarvested,
      toolsCrafted: p.toolsCrafted,
      workers: p.workers.map((w) => ({
        id: w.id, role: w.role, level: w.level,
        cosmetic: { ...w.cosmetic }, name: w.name,
      })),
    };
  }
  return {
    schemaVersion: PROGRESSION_SCHEMA_VERSION, revision, updatedAt,
    currencies: { ...state.currencies }, wood: state.wood, woodToSell: state.woodToSell, woodSpent: state.woodSpent,
    upgrades: { ...state.upgrades },
    blessings: [...state.blessings],
    prestige: { ...state.prestige, perks: { ...state.prestige.perks } },
    quests: state.quests.map((q) => ({ ...q })), stats: { ...state.stats },
    settings: { ...state.settings }, planets,
  };
}

/** Apply a winning snapshot without replacing the shared game or planet objects. */
export function applyProgression(state: GameState, snapshot: ProgressionSnapshot): void {
  Object.assign(state.currencies, snapshot.currencies);
  state.wood = snapshot.wood;
  state.woodToSell = snapshot.woodToSell;
  state.woodSpent = snapshot.woodSpent;
  Object.assign(state.upgrades, snapshot.upgrades);
  state.blessings.splice(0, state.blessings.length, ...snapshot.blessings);
  state.prestige.count = snapshot.prestige.count;
  state.prestige.starDust = snapshot.prestige.starDust;
  Object.assign(state.prestige.perks, snapshot.prestige.perks);
  state.quests.splice(0, state.quests.length, ...snapshot.quests.map((q) => ({ ...q })));
  Object.assign(state.stats, snapshot.stats);
  Object.assign(state.settings, snapshot.settings);
  state.lastSaved = snapshot.updatedAt;

  for (const pid of Object.keys(state.planets) as PlanetId[]) {
    const target = state.planets[pid];
    const source = snapshot.planets[pid];
    target.unlocked = source.unlocked;
    Object.assign(target.resources, source.resources);
    target.buildings = { ...source.buildings };
    target.treesHarvested = source.treesHarvested;
    target.toolsCrafted = source.toolsCrafted;
    const existing = new Map(target.workers.map((w) => [w.id, w]));
    const workers = source.workers.map((entry) => {
      const worker = existing.get(entry.id) ?? {
        id: entry.id, role: entry.role,
        pos: { x: 0, y: PLANET_RADIUS, z: 0 },
        state: 'idle' as const, level: 0,
        cosmetic: { hat: 'cap', color: '#ffffff' }, name: entry.role,
        stuckTimer: 0,
      };
      worker.role = entry.role;
      worker.level = entry.level;
      worker.cosmetic = { ...entry.cosmetic };
      worker.name = entry.name;
      worker.state = 'idle';
      worker.target = undefined;
      worker.stuckTimer = 0;
      worker.stateTimer = 0;
      worker.carryingLogs = 0;
      worker.carrying = undefined;
      worker.dropProgress = undefined;
      worker.appearTimer = undefined;
      worker.plantTimer = undefined;
      worker.chopTimer = undefined;
      worker.actionTimer = undefined;
      worker.standDir = undefined;
      return worker;
    });
    target.workers.splice(0, target.workers.length, ...workers);
    for (const plot of target.plots) plot.reservedBy = undefined;
  }
}
