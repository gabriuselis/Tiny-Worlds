import type { GameState } from './state';
import { resetWorkers, seedEmptyPlots, type PlotSeed } from './game';

/** Keep a saved world only when every plot belongs to the current grid. */
export function restoreWorld(g: GameState, seeds: PlotSeed[]): number {
  const planet = g.planets.verdant;
  const plots = planet.plots;
  if (plots.length !== seeds.length || plots.some((plot, i) => plot.id !== seeds[i].id)) {
    return seedEmptyPlots(g, seeds);
  }

  for (let i = 0; i < plots.length; i++) {
    const plot = plots[i];
    const dir = seeds[i].dir;
    plot.dir = { x: dir.x, y: dir.y, z: dir.z };
    plot.reservedBy = undefined;
    plot.popTimer = undefined;
  }
  planet.usablePlotCount = plots.length;
  resetWorkers(g);
  return plots.length;
}
