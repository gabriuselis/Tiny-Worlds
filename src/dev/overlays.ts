import * as THREE from 'three';
import { PLOT_COUNT, PLANET_RADIUS } from '../core/config/world';
import type { Plot } from '../core/state';
import { logEvent, showToast } from '../ui/ui';
import { ctx } from '../app/context';
import { showError } from '../app/errors';

// ===== Grid overlay debug (LineSegments, opacity 0.15, depthWrite false) =====
let gridOverlay: THREE.LineSegments | null = null;
let gridOverlayVisible = false;
const PLOT_DOT_LIFT = 1.003;
let plotDotsMesh: THREE.InstancedMesh | null = null;
let plotDotsVisible = false;

function buildGridOverlay(): THREE.LineSegments {
  const grid = ctx.grid;
  const lines: number[] = [];
  const R = PLANET_RADIUS;
  const cell = 0.002; // small offset above surface
  // Draw each plot to its nearest neighbor -> a web covering the whole globe.
  for (let i = 0; i < grid.plots.length; i++) {
    const a = grid.plots[i];
    let best: Plot | null = null;
    let bestD = Infinity;
    for (let j = i + 1; j < grid.plots.length; j++) {
      const b = grid.plots[j];
      const dx = a.dir.x - b.dir.x;
      const dy = a.dir.y - b.dir.y;
      const dz = a.dir.z - b.dir.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) {
      const ax = a.dir.x * R, ay = a.dir.y * R, az = a.dir.z * R;
      const bx = best.dir.x * R, by = best.dir.y * R, bz = best.dir.z * R;
      lines.push(ax, ay + cell, az, bx, by + cell, bz);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false });
  return new THREE.LineSegments(geo, mat);
}

function toggleGridOverlay(): void {
  gridOverlayVisible = !gridOverlayVisible;
  if (gridOverlayVisible) {
    if (!gridOverlay) {
      gridOverlay = buildGridOverlay();
      gridOverlay.name = 'grid-overlay';
      gridOverlay.renderOrder = 5;
      ctx.planetGroup.add(gridOverlay);
    }
    gridOverlay.visible = true;
  } else if (gridOverlay) {
    gridOverlay.visible = false;
  }
}

export function installOverlayHooks(): void {
  // Expose grid toggle
  (window as any).__toggleGrid = toggleGridOverlay;

  (window as any).__togglePlotDots = (): void => {
    try {
      const { grid, sceneAPI, planetGroup } = ctx;
      if (!grid || !sceneAPI) return;
      if (plotDotsVisible) {
        if (plotDotsMesh) { planetGroup.remove(plotDotsMesh); plotDotsMesh = null; }
        plotDotsVisible = false;
        showToast('Plot dots: off');
        logEvent('Plot dots off');
        return;
      }
      const dotRadius = 0.03;
      const geo = new THREE.SphereGeometry(dotRadius, 8, 8);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }), PLOT_COUNT);
      mesh.name = 'plot-dots';
      mesh.renderOrder = 5;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS * PLOT_DOT_LIFT + dotRadius + 0.1);
      const color = new THREE.Color();
      const dummy = new THREE.Object3D();
      const verdant = ctx.state.planets.verdant;
      const plotState = new Map<number, string>(verdant.plots.map((p) => [p.id, p.state]));
      for (let i = 0; i < PLOT_COUNT; i++) {
        const p = grid.plots[i];
        const st = plotState.get(p.id) ?? 'empty';
        const dotColor = st === 'empty' ? 0x888888
          : st === 'sapling' ? 0xffeb3b
          : st === 'medium' ? 0xff9800
          : st === 'falling' ? 0xff7043
          : st === 'logs' ? 0x795548
          : 0x4caf50;
        color.set(dotColor);
        dummy.position.set(p.dir.x * PLANET_RADIUS * PLOT_DOT_LIFT, p.dir.y * PLANET_RADIUS * PLOT_DOT_LIFT, p.dir.z * PLANET_RADIUS * PLOT_DOT_LIFT);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      plotDotsMesh = mesh;
      planetGroup.add(mesh);
      plotDotsVisible = true;
      showToast(`Plot dots: on (${PLOT_COUNT})`);
      logEvent(`Plot dots on: ${PLOT_COUNT} dots`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Plot dots failed', msg);
      logEvent(`Plot dots FAILED: ${msg}`);
    }
  };
}
