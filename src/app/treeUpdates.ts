import * as THREE from 'three';
import { WORLD_CONFIG } from '../core/config/world';
import { CROWN_COLOR_COUNT } from '../render/planet';
import { ctx } from './context';
import {
  fallingPools, treeMatrix, treeScale, dirtyTreeSet, sway,
  hashAngle, clamp01, plotScale, writeTreeMatrices, updateTreeInstance, flagTreeBuffers,
} from './trees';

const fallingCounts = new Array<number>(CROWN_COLOR_COUNT).fill(0);
const _floaterPos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _fallDir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const _yawQ = new THREE.Quaternion();
const _swayQuat = new THREE.Quaternion();
const prevPlotStates: string[] = [];
const prevWoodLeft: number[] = [];
let fallingTotal = 0;

function getUsablePlotCount(): number {
  return ctx.verdant.usablePlotCount;
}

// ===== Tree instance updates (dirty list only, per-frame) =====
export function updateTreeInstances(): void {
  const { state, grid, particles, floaters, ui, surfaceRadius } = ctx;
  const verdant = state.planets.verdant;

  // Unlock new plots as usable increases
  const usable = getUsablePlotCount();
  while (verdant.plots.length < usable) {
    const arrayIdx = verdant.plots.length;
    const pid = grid.unlockedOrder[arrayIdx];
    const plot = grid.plotById.get(pid)!;
    verdant.plots.push({
      id: pid,
      dir: { ...plot.dir },
      state: 'empty',
      timer: 0,
      reservedBy: undefined,
      woodLeft: 0,
    });
    verdant.usablePlotCount = arrayIdx + 1;
    dirtyTreeSet.add(arrayIdx);
  }

  // Mark plots whose stage / pile size changed, plus everything currently animating.
  fallingTotal = 0;
  for (let i = 0; i < verdant.plots.length; i++) {
    const p = verdant.plots[i];
    if (p.state === 'falling') fallingTotal += 1;
    const wood = p.woodLeft ?? 0;
    if (prevPlotStates[i] !== p.state || prevWoodLeft[i] !== wood) {
      // Wood-chip / leaf bursts the moment a tree starts falling, landing dust on impact.
      if (particles) {
        if (p.state === 'falling' && prevPlotStates[i] !== 'falling') {
          particles.emit('leaf', p.dir, 0.36, 14);
          particles.emit('chip', p.dir, 0.18, 8);
        } else if (p.state === 'logs' && prevPlotStates[i] === 'falling') {
          particles.emit('dust', p.dir, 0.02, 8);
        }
      }
      // Every log lifted off a pile: floating +1 above the plot and a Wood bump.
      if (prevPlotStates[i] === 'logs' && wood < prevWoodLeft[i]) {
        const lifted = prevWoodLeft[i] - wood;
        _floaterPos.set(p.dir.x, p.dir.y, p.dir.z).multiplyScalar(surfaceRadius + 0.45);
        for (let k = 0; k < lifted; k++) floaters?.spawn(_floaterPos);
        if (lifted > 0) ui.bumpWood();
      }
      prevPlotStates[i] = p.state;
      prevWoodLeft[i] = wood;
      dirtyTreeSet.add(i);
    }
    if (p.state === 'sapling' || p.state === 'medium' || (p.popTimer ?? 0) > 0) {
      dirtyTreeSet.add(i);
    }
  }

  // writeTreeMatrices never touches dirtyTreeSet, so iterating it directly before clearing is safe.
  let written = 0;
  if (ctx.frameCount < 2) {
    for (let i = 0; i < verdant.plots.length; i++) {
      writeTreeMatrices(verdant.plots[i]);
      written++;
    }
  } else {
    for (const arrayIdx of dirtyTreeSet) {
      const plot = verdant.plots[arrayIdx];
      if (!plot) continue;
      writeTreeMatrices(plot);
      written++;
    }
  }
  dirtyTreeSet.clear();

  if (written === 0) return;
  flagTreeBuffers();
}

// ===== Falling trees: animate the whole merged tree tipping over, then shrinking =====
export function updateFallingTrees(): void {
  if (fallingTotal === 0) {
    for (const pool of fallingPools) {
      if (pool.count > 0) pool.count = 0;
    }
    return;
  }
  const surfaceRadius = ctx.surfaceRadius;
  const counts = fallingCounts;
  counts.fill(0);
  const dir = _dir;
  const pos = _pos;
  const fallDir = _fallDir;
  const axis = _axis;
  const tilt = _tilt;
  const yawQ = _yawQ;

  for (const plot of ctx.state.planets.verdant.plots) {
    if (plot.state !== 'falling') continue;
    const c = plot.id % CROWN_COLOR_COUNT;
    const pool = fallingPools[c];
    const slot = counts[c];
    if (slot >= WORLD_CONFIG.maxFallingTrees) continue;

    dir.set(plot.dir.x, plot.dir.y, plot.dir.z).normalize();
    pos.copy(dir).multiplyScalar(surfaceRadius + 0.002);
    const q = _q.setFromUnitVectors(_up, dir);
    q.premultiply(yawQ.setFromAxisAngle(dir, hashAngle(plot.id)));

    if (plot.fallDir) {
      fallDir.set(plot.fallDir.x, plot.fallDir.y, plot.fallDir.z).normalize();
      axis.crossVectors(dir, fallDir);
      if (axis.lengthSq() > 1e-8) {
        axis.normalize();
        const t = clamp01(1 - Math.max(0, plot.timer) / WORLD_CONFIG.fallTime);
        tilt.setFromAxisAngle(axis, (Math.PI / 2) * Math.pow(t, 1.7));
        q.premultiply(tilt);
      }
    }

    const shrinkT = clamp01((WORLD_CONFIG.fallShrinkTime - Math.max(0, plot.timer)) / WORLD_CONFIG.fallShrinkTime);
    const s = 1 - shrinkT * 0.9;
    treeMatrix.compose(pos, q, treeScale.set(s, s, s));
    pool.setMatrixAt(slot, treeMatrix);
    counts[c] = slot + 1;
  }

  for (let c = 0; c < fallingPools.length; c++) {
    const pool = fallingPools[c];
    pool.count = counts[c];
    pool.instanceMatrix.needsUpdate = true;
  }
}

// ===== Tree sway (grown trees near camera, every 2nd frame) =====
export function updateTreeSway(): void {
  const sceneAPI = ctx.sceneAPI;
  if (!sceneAPI) return;
  sway.frame++;
  if (sway.frame % 2 !== 0) return;
  const surfaceRadius = ctx.surfaceRadius;
  const camPos = sceneAPI.camera.position;
  const camLen = Math.sqrt(camPos.x * camPos.x + camPos.y * camPos.y + camPos.z * camPos.z) || 1;
  const cd = { x: camPos.x / camLen, y: camPos.y / camLen, z: camPos.z / camLen };

  const time = performance.now() * 0.002;
  const verdant = ctx.state.planets.verdant;

  let swayed = false;
  for (const plot of verdant.plots) {
    if (plot.state !== 'grown') continue;
    const dir = _dir.set(plot.dir.x, plot.dir.y, plot.dir.z);
    const dot = dir.x * cd.x + dir.y * cd.y + dir.z * cd.z;
    if (dot < 0.7) continue; // only near camera
    const swayAngle = Math.sin(time + plot.id * 0.5) * 0.03;
    const pos = _pos.set(dir.x * (surfaceRadius + 0.002), dir.y * (surfaceRadius + 0.002), dir.z * (surfaceRadius + 0.002));
    const q = _q.setFromUnitVectors(_up, dir);
    if (!isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || !isFinite(q.w)) {
      q.set(0, 0, 0, 1);
    }
    const axis = _axis.set(-dir.z, 0, dir.x).normalize();
    q.premultiply(_swayQuat.setFromAxisAngle(axis, swayAngle));
    const s = plotScale(plot);
    treeMatrix.compose(pos, q, treeScale.set(s, s, s));
    if (updateTreeInstance(plot.id, treeMatrix)) swayed = true;
  }
  if (!swayed) return;
  flagTreeBuffers();
}
