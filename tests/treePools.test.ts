import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

vi.mock('../src/ui/ui', () => ({ logEvent: vi.fn() }));

import { ctx } from '../src/app/context';
import {
  initTreePools, writeTreeMatrices, syncTrees, variantPools, variantSlots, shadowPool, shadowSlots, logPool, logSlots,
  fallingPools, updateTreeInstance,
} from '../src/app/trees';
import { CROWN_COLOR_COUNT } from '../src/render/planet';
import { LOG_LOGS_PER_PILE, PLANET_RADIUS, TREE_TOTAL_HEIGHT, WORLD_CONFIG } from '../src/core/config/world';
import type { Plot } from '../src/core/state';

function plotAt(id: number, state: Plot['state'], extra: Partial<Plot> = {}): Plot {
  const a = id * 0.37;
  const dir = new THREE.Vector3(Math.cos(a), Math.sin(a * 1.3) * 0.5, Math.sin(a)).normalize();
  return { id, dir: { x: dir.x, y: dir.y, z: dir.z }, state, timer: 30, ...extra };
}

function liveTrees(): number {
  return variantPools.reduce((n, vp) => n + vp.count, 0);
}

function setPlots(plots: Plot[]): void {
  (ctx as any).state = { planets: { verdant: { plots } } };
}

beforeEach(() => {
  (ctx as any).planetGroup = new THREE.Group();
  ctx.surfaceRadius = PLANET_RADIUS;
  initTreePools();
});

describe('tree pools', () => {
  it('start empty and keep culling on with a manual planet-centred sphere', () => {
    const meshes = [...variantPools, ...fallingPools, logPool, shadowPool];
    for (const mesh of meshes) {
      expect(mesh.count).toBe(0);
      expect(mesh.frustumCulled).toBe(true);
      const sphere = mesh.boundingSphere!;
      expect(sphere).not.toBeNull();
      expect(sphere.center.lengthSq()).toBe(0);
      expect(sphere.radius).toBeGreaterThan(PLANET_RADIUS + TREE_TOTAL_HEIGHT * 1.12);
    }
  });

  it('shows a plot only while its state has a tree, in the variant for id % colours', () => {
    const plot = plotAt(6, 'sapling');
    writeTreeMatrices(plot);
    const c = plot.id % CROWN_COLOR_COUNT;
    expect(variantPools[c].count).toBe(1);
    expect(liveTrees()).toBe(1);
    expect(shadowPool.count).toBe(1);
    for (const state of ['medium', 'grown'] as const) {
      plot.state = state;
      writeTreeMatrices(plot);
      expect(variantPools[c].count).toBe(1);
      expect(shadowPool.count).toBe(1);
    }
    plot.state = 'falling';
    writeTreeMatrices(plot);
    expect(liveTrees()).toBe(0);
    expect(shadowPool.count).toBe(0);
    expect(logPool.count).toBe(0);
  });

  it('keeps the other plots intact when one is removed', () => {
    const plots = [0, 4, 8, 12, 16].map((id) => plotAt(id, 'grown'));
    plots.forEach(writeTreeMatrices);
    const m = new THREE.Matrix4();
    const before = plots.map((p) => {
      variantPools[0].getMatrixAt(variantSlots[0].slotOf(p.id), m);
      return m.elements.slice();
    });
    plots[1].state = 'empty';
    writeTreeMatrices(plots[1]);
    expect(variantPools[0].count).toBe(4);
    plots.forEach((p, i) => {
      if (i === 1) { expect(variantSlots[0].slotOf(p.id)).toBe(-1); return; }
      variantPools[0].getMatrixAt(variantSlots[0].slotOf(p.id), m);
      expect(m.elements.slice()).toEqual(before[i]);
      shadowPool.getMatrixAt(shadowSlots.slotOf(p.id), m);
      expect(m.elements.slice()).toEqual(before[i]);
    });
  });

  it('log piles hold min(3, woodLeft) logs and shrink as wood is taken', () => {
    const plot = plotAt(9, 'logs', { woodLeft: 3 });
    const other = plotAt(10, 'logs', { woodLeft: 2 });
    writeTreeMatrices(plot);
    writeTreeMatrices(other);
    expect(logPool.count).toBe(5);
    expect(liveTrees()).toBe(0);
    plot.woodLeft = 1;
    writeTreeMatrices(plot);
    expect(logPool.count).toBe(3);
    expect(logSlots.slotOf(9 * LOG_LOGS_PER_PILE)).toBeGreaterThanOrEqual(0);
    expect(logSlots.slotOf(9 * LOG_LOGS_PER_PILE + 1)).toBe(-1);
    plot.woodLeft = 0;
    writeTreeMatrices(plot);
    expect(logPool.count).toBe(2);
    plot.state = 'empty';
    writeTreeMatrices(other);
    other.state = 'empty';
    writeTreeMatrices(other);
    expect(logPool.count).toBe(0);
  });

  it('syncTrees rebuilds slots from state, dropping plots that vanished', () => {
    const plots = Array.from({ length: 30 }, (_, i) => plotAt(i, i % 3 === 0 ? 'logs' : 'grown', { woodLeft: 3 }));
    setPlots(plots);
    syncTrees();
    const grown = plots.filter((p) => p.state === 'grown').length;
    expect(liveTrees()).toBe(grown);
    expect(logPool.count).toBe((30 - grown) * 3);

    setPlots(plots.slice(0, 5));
    syncTrees();
    expect(liveTrees()).toBe(plots.slice(0, 5).filter((p) => p.state === 'grown').length);
    expect(logPool.count).toBe(plots.slice(0, 5).filter((p) => p.state === 'logs').length * 3);

    setPlots([]);
    syncTrees();
    expect(liveTrees() + shadowPool.count + logPool.count).toBe(0);
  });

  it('sway only rewrites live trees and never allocates', () => {
    const live = plotAt(1, 'grown');
    writeTreeMatrices(live);
    const m = new THREE.Matrix4().makeTranslation(1, 2, 3);
    expect(updateTreeInstance(live.id, m)).toBe(true);
    expect(updateTreeInstance(2, m)).toBe(false);
    expect(liveTrees()).toBe(1);
    const slot = variantSlots[live.id % CROWN_COLOR_COUNT].slotOf(live.id);
    const out = new THREE.Matrix4();
    variantPools[live.id % CROWN_COLOR_COUNT].getMatrixAt(slot, out);
    expect(out.elements[12]).toBe(1);
  });

  it('every tree instance stays inside its pool bounding sphere', () => {
    const plots = Array.from({ length: 200 }, (_, i) => plotAt(i, 'grown', { popTimer: 0.35 }));
    plots.forEach(writeTreeMatrices);
    const box = new THREE.Box3();
    const geo = variantPools[0].geometry;
    geo.computeBoundingBox();
    const m = new THREE.Matrix4();
    for (const vp of variantPools) {
      for (let i = 0; i < vp.count; i++) {
        vp.getMatrixAt(i, m);
        box.copy(geo.boundingBox!).applyMatrix4(m);
        const corner = box.min.clone();
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z);
          expect(corner.length()).toBeLessThanOrEqual(vp.boundingSphere!.radius);
        }
      }
    }
  });

  it('falling pools have a fixed capacity matching the config', () => {
    for (const fp of fallingPools) expect(fp.instanceMatrix.count).toBe(WORLD_CONFIG.maxFallingTrees);
  });
});
