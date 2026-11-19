import type { GameState, PlanetId, Plot, Vec3 } from './state';

export const WORLD_SCHEMA_VERSION = 1;

export interface WorldSnapshot {
  schemaVersion: number;
  lastSaved: number;
  simSeconds: number;
  woodLogTimes: number[];
  planets: Record<PlanetId, {
    plots: Plot[];
    positions: { id: number; pos: Vec3 }[];
  }>;
}

export function captureWorld(state: GameState): WorldSnapshot {
  const planets = {} as WorldSnapshot['planets'];
  for (const pid of Object.keys(state.planets) as PlanetId[]) {
    const p = state.planets[pid];
    planets[pid] = {
      plots: p.plots.map((plot) => ({ ...plot, dir: { ...plot.dir } })),
      positions: p.workers.map((w) => ({ id: w.id, pos: { ...w.pos } })),
    };
  }
  return { schemaVersion: WORLD_SCHEMA_VERSION, lastSaved: state.lastSaved, simSeconds: state.simSeconds,
    woodLogTimes: [...state.woodLogTimes], planets };
}

export function applyWorld(state: GameState, world: WorldSnapshot): void {
  state.lastSaved = world.lastSaved;
  state.simSeconds = world.simSeconds;
  state.woodLogTimes.splice(0, state.woodLogTimes.length, ...world.woodLogTimes);
  for (const pid of Object.keys(state.planets) as PlanetId[]) {
    const planet = state.planets[pid];
    const source = world.planets[pid];
    planet.plots.splice(0, planet.plots.length,
      ...source.plots.map((plot) => ({ ...plot, dir: { ...plot.dir } })));
    const positions = new Map(source.positions.map((entry) => [entry.id, entry.pos]));
    for (const worker of planet.workers) {
      const pos = positions.get(worker.id);
      if (pos) worker.pos = { ...pos };
    }
  }
}
