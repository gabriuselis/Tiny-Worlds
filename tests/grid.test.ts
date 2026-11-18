import { describe, it, expect } from 'vitest';
import { buildGrid } from '../src/core/grid';
import { PLOT_COUNT, PLANET_RADIUS } from '../src/core/config/world';

const R = PLANET_RADIUS;
const grid = buildGrid();

function octant(p: { x: number; y: number; z: number }): string {
  return `${p.x >= 0 ? '+' : '-'}${p.y >= 0 ? '+' : '-'}${p.z >= 0 ? '+' : '-'}`;
}

describe('buildGrid (Fibonacci sphere)', () => {
  it(`produces exactly ${PLOT_COUNT} plots`, () => {
    expect(grid.plots.length).toBe(PLOT_COUNT);
    expect(grid.unlockedOrder.length).toBe(PLOT_COUNT);
    expect(grid.plotById.size).toBe(PLOT_COUNT);
    console.log(`Real plot count: ${grid.plots.length}`);
  });

  it('every dir has unit length', () => {
    for (const p of grid.plots) {
      const len = Math.sqrt(p.dir.x * p.dir.x + p.dir.y * p.dir.y + p.dir.z * p.dir.z);
      expect(Math.abs(len - 1)).toBeLessThan(1e-6);
    }
  });

  it('no NaN dirs', () => {
    for (const p of grid.plots) {
      expect(Number.isFinite(p.dir.x)).toBe(true);
      expect(Number.isFinite(p.dir.y)).toBe(true);
      expect(Number.isFinite(p.dir.z)).toBe(true);
    }
  });

  it('hemisphere split is balanced (y, x, z each within 2)', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      let pos = 0, neg = 0;
      for (const p of grid.plots) {
        const v = p.dir[axis];
        if (v > 0) pos++; else if (v < 0) neg++;
      }
      expect(Math.abs(pos - neg)).toBeLessThanOrEqual(2);
      console.log(`axis ${axis}: pos=${pos} neg=${neg}`);
    }
  });

  it('8 octants each hold between 10% and 15% of plots', () => {
    const counts: Record<string, number> = {};
    for (const p of grid.plots) {
      const o = octant(p.dir);
      counts[o] = (counts[o] ?? 0) + 1;
    }
    const lo = PLOT_COUNT * 0.10;
    const hi = PLOT_COUNT * 0.15;
    for (const o of Object.keys(counts)) {
      expect(counts[o]).toBeGreaterThanOrEqual(lo);
      expect(counts[o]).toBeLessThanOrEqual(hi);
      console.log(`octant ${o}: ${counts[o]}`);
    }
    expect(Object.keys(counts).length).toBe(8);
  });

  it('nearest-neighbor distance within 0.5x-1.5x of 0.229 for >=95% of plots', () => {
    const targetSpacing = 0.229;
    let ok = 0;
    for (let i = 0; i < grid.plots.length; i++) {
      const a = grid.plots[i];
      let nearest = Infinity;
      for (let j = i + 1; j < grid.plots.length; j++) {
        const b = grid.plots[j];
        const dx = a.dir.x - b.dir.x;
        const dy = a.dir.y - b.dir.y;
        const dz = a.dir.z - b.dir.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * R;
        if (d < nearest) nearest = d;
      }
      if (nearest >= 0.5 * targetSpacing && nearest <= 1.5 * targetSpacing) ok++;
    }
    const frac = ok / grid.plots.length;
    console.log(`NN within range: ${ok}/${grid.plots.length} = ${(frac * 100).toFixed(1)}%`);
    expect(frac).toBeGreaterThanOrEqual(0.95);
  });
});
