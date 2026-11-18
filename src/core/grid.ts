import { PLANET_RADIUS, PLOT_COUNT } from './config/world';
import type { Plot } from './state';

export interface Grid {
  plots: Plot[];
  plotById: Map<number, Plot>;
  unlockedOrder: number[];
}

// Golden-angle (Fibonacci) sphere: evenly distributes points over the whole globe
// with no pole clustering and no empty rings.
const PHI = Math.PI * (3 - Math.sqrt(5)); // ~2.399963229728653

export function buildGrid(): Grid {
  const plots: Plot[] = [];
  for (let i = 0; i < PLOT_COUNT; i++) {
    const y = 1 - 2 * (i + 0.5) / PLOT_COUNT;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * PHI;
    const dir = { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
    plots.push({ id: i, dir, state: 'empty', timer: 0, reservedBy: undefined });
  }

  const plotById = new Map<number, Plot>();
  for (const p of plots) plotById.set(p.id, p);

  // All 1500 plots are usable from the start (empty-start design).
  const unlockedOrder = plots.map((p) => p.id);

  return { plots, plotById, unlockedOrder };
}

export function angularDist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

export function plotWorldPos(dir: { x: number; y: number; z: number }, R: number = PLANET_RADIUS): { x: number; y: number; z: number } {
  return { x: dir.x * R, y: dir.y * R, z: dir.z * R };
}
