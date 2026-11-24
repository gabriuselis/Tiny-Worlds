import * as THREE from 'three';
import { WORLD_CONFIG, PLOT_COUNT, GROW_STAGE_SECONDS, GROW_POP_SECONDS, TREE_TOTAL_HEIGHT, LOG_LOGS_PER_PILE, LOG_BOTTOM_Y, LOG_TOP_Y, LOG_RADIUS, LOG_YAW_JITTER, LOG_PILE_CAPACITY } from '../core/config/world';
import type { Plot } from '../core/state';
import { InstanceSlots } from './instanceSlots';
import { showInstance, removeInstance, clearInstances } from './instanceOps';
import { createTreeVariantGeometry, createLogGeometry, createContactShadowGeometry, treeMaterials, CROWN_COLORS, CROWN_COLOR_COUNT } from '../render/planet';
import { logEvent } from '../ui/ui';
import { ctx } from './context';
import { showError } from './errors';

// ===== Tree InstancedMeshes: merged tree variants, log piles, shadows, falling trees =====
export let variantPools: THREE.InstancedMesh[] = [];
export let variantSlots: InstanceSlots[] = [];
export let treeGeometries: THREE.BufferGeometry[] = [];
export let logPool: THREE.InstancedMesh;
export let logSlots: InstanceSlots;
export let shadowPool: THREE.InstancedMesh;
export let shadowSlots: InstanceSlots;
export let treeMatrix: THREE.Matrix4;
export let treeScale: THREE.Vector3;
export let dirtyTreeSet: Set<number>;
export const sway = { frame: 0 };

// Falling trees: one pool per crown color, capacity WORLD_CONFIG.maxFallingTrees.
export let fallingPools: THREE.InstancedMesh[] = [];

// Instance keys: tree/shadow = plot id, log = plot id * LOG_LOGS_PER_PILE + log index.
// Pools draw only [0, count); slots are packed by InstanceSlots (swap-remove).
const POP_AMOUNT = 0.12;
const BOUNDS_MARGIN = 1.2;
// One spare slot for the dev test tree, so a fully grown planet cannot crowd it out.
const SHADOW_CAPACITY = PLOT_COUNT + 1;

// Planet-centred sphere that holds every tree, log and shadow at any planet rotation.
function createPoolBounds(): THREE.Sphere {
  const radius = Math.max(ctx.surfaceRadius, WORLD_CONFIG.planetRadius) + TREE_TOTAL_HEIGHT * (1 + POP_AMOUNT) + BOUNDS_MARGIN;
  return new THREE.Sphere(new THREE.Vector3(), radius);
}

function setupTreePools(): void {
  const planetGroup = ctx.planetGroup;
  const { shadow } = treeMaterials();
  const treeMatOpts = { vertexColors: true, roughness: 0.92, metalness: 0, emissive: 0x000000 };
  const bounds = createPoolBounds();

  // Remove any previously created pools so rebuilds don't stack duplicates
  if (variantPools) {
    for (const vp of variantPools) if (vp) planetGroup.remove(vp);
  }
  if (fallingPools) {
    for (const fp of fallingPools) if (fp) planetGroup.remove(fp);
  }
  if (logPool) planetGroup.remove(logPool);
  if (shadowPool) planetGroup.remove(shadowPool);

  variantPools = [];
  variantSlots = [];
  fallingPools = [];
  treeGeometries = [];
  const prepare = (mesh: THREE.InstancedMesh, name: string, order: number): void => {
    mesh.name = name;
    mesh.renderOrder = order;
    mesh.boundingSphere = bounds.clone();
    mesh.count = 0;
    planetGroup.add(mesh);
  };
  for (let c = 0; c < CROWN_COLOR_COUNT; c++) {
    const geo = createTreeVariantGeometry(CROWN_COLORS[c]);
    treeGeometries.push(geo);
    const vp = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(treeMatOpts), PLOT_COUNT);
    prepare(vp, `tree-variant-pool-${c}`, 3);
    variantPools.push(vp);
    variantSlots.push(new InstanceSlots(PLOT_COUNT));

    const fp = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(treeMatOpts), WORLD_CONFIG.maxFallingTrees);
    prepare(fp, `tree-falling-pool-${c}`, 3);
    fallingPools.push(fp);
  }
  const logGeo = createLogGeometry();
  const logMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: 0x000000 });
  const shadowGeo = createContactShadowGeometry();
  logPool = new THREE.InstancedMesh(logGeo, logMat, LOG_PILE_CAPACITY);
  shadowPool = new THREE.InstancedMesh(shadowGeo, shadow, SHADOW_CAPACITY);
  logSlots = new InstanceSlots(LOG_PILE_CAPACITY);
  shadowSlots = new InstanceSlots(SHADOW_CAPACITY);
  prepare(logPool, 'tree-log-pool', 3);
  prepare(shadowPool, 'tree-shadow-pool', 2);

  treeMatrix = new THREE.Matrix4();
  treeScale = new THREE.Vector3();
  dirtyTreeSet = new Set<number>();
  sway.frame = 0;
}

export function initTreePools(): void {
  try {
    setupTreePools();
  } catch (err) { showError('setupTreePools failed', err); }
}

function removePlotTree(plotId: number): void {
  removeInstance(variantPools[plotId % CROWN_COLOR_COUNT], variantSlots[plotId % CROWN_COLOR_COUNT], plotId);
  removeInstance(shadowPool, shadowSlots, plotId);
}

function removePlotLogs(plotId: number, keep: number): void {
  for (let k = keep; k < LOG_LOGS_PER_PILE; k++) removeInstance(logPool, logSlots, plotId * LOG_LOGS_PER_PILE + k);
}

export function showTreeInstance(plotId: number, matrix: THREE.Matrix4): void {
  const c = plotId % CROWN_COLOR_COUNT;
  showInstance(variantPools[c], variantSlots[c], plotId, matrix);
  showInstance(shadowPool, shadowSlots, plotId, matrix);
}

// Updates only a plot that already has a live tree (sway); never allocates.
export function updateTreeInstance(plotId: number, matrix: THREE.Matrix4): boolean {
  const c = plotId % CROWN_COLOR_COUNT;
  const slot = variantSlots[c].slotOf(plotId);
  const shadowSlot = shadowSlots.slotOf(plotId);
  if (slot < 0 || shadowSlot < 0) return false;
  variantPools[c].setMatrixAt(slot, matrix);
  shadowPool.setMatrixAt(shadowSlot, matrix);
  return true;
}

// Drops every live instance (used before a full rebuild from state).
function clearTreeInstances(): void {
  for (let c = 0; c < variantPools.length; c++) clearInstances(variantPools[c], variantSlots[c]);
  clearInstances(shadowPool, shadowSlots);
  clearInstances(logPool, logSlots);
}

// Stable pseudo-random yaw angle per plot id (deterministic, [0, 2*PI))
export function hashAngle(plotId: number): number {
  return (((plotId * 2654435761) >>> 0) / 4294967296) * Math.PI * 2;
}

export function stageScaleFor(state: string): number {
  if (state === 'empty') return 0.0001; // hidden, never 0 or negative
  if (state === 'sapling') return 0.35;
  if (state === 'medium') return 0.65;
  if (state === 'grown') return 1.0;
  if (state === 'stump') return 0.15;
  return 0.0001;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Smooth growth: the tree scale eases from one stage size to the next over the
// stage duration, plus a short pop when a stage changes.
export function plotScale(plot: Plot): number {
  const pop = plot.popTimer ? 1 + POP_AMOUNT * clamp01(plot.popTimer / GROW_POP_SECONDS) : 1;
  if (plot.state === 'empty') return 0.0001;
  if (plot.state === 'grown') return pop;
  if (plot.state === 'sapling') {
    const t = clamp01(1 - Math.max(0, plot.timer) / GROW_STAGE_SECONDS[0]);
    return (0.35 + (0.65 - 0.35) * t) * pop;
  }
  if (plot.state === 'medium') {
    const t = clamp01(1 - Math.max(0, plot.timer) / GROW_STAGE_SECONDS[1]);
    return (0.65 + (1.0 - 0.65) * t) * pop;
  }
  return 0.0001;
}

const _dir = new THREE.Vector3();
const _basePos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _yawQ = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();

// Shared transform for a plot's tree: trunk, crown and shadow all use the SAME matrix.
// position = dir * R, quaternion = align +Y with dir then yaw by hash angle, uniform scale.
// Never rotate/translate trunk separately; the cylinder is already upright along Y.
export function writeTreeMatrices(plot: Plot): void {
  const hasTree = plot.state === 'sapling' || plot.state === 'medium' || plot.state === 'grown';

  if (!hasTree && plot.state !== 'logs') {
    // 'empty' and 'falling' plots show no standing tree and no log pile.
    removePlotTree(plot.id);
    removePlotLogs(plot.id, 0);
    return;
  }

  const surfaceRadius = ctx.surfaceRadius;
  const dir = _dir.set(plot.dir.x, plot.dir.y, plot.dir.z);
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  dir.divideScalar(len);

  const basePos = _basePos.set(dir.x * (surfaceRadius + 0.002), dir.y * (surfaceRadius + 0.002), dir.z * (surfaceRadius + 0.002));

  const q = _q.setFromUnitVectors(_up, dir);
  if (!isFinite(q.x) || !isFinite(q.y) || !isFinite(q.z) || !isFinite(q.w)) {
    q.set(0, 0, 0, 1);
  }
  q.premultiply(_yawQ.setFromAxisAngle(dir, hashAngle(plot.id)));

  if (hasTree) {
    const s = Math.max(0.0001, plotScale(plot));
    // compose() is only products/sums of these inputs, so a non-finite sum means a bad matrix.
    if (!Number.isFinite(s + basePos.x + basePos.y + basePos.z + q.x + q.y + q.z + q.w)) {
      logEvent(`Tree matrix NaN skipped: plot ${plot.id}`);
      removePlotTree(plot.id);
    } else {
      treeMatrix.compose(basePos, q, treeScale.set(s, s, s));
      // Same matrix for trunk+crown (merged variant pool) and shadow -> trunk attaches to crown, no gap
      showTreeInstance(plot.id, treeMatrix);
    }
  } else {
    removePlotTree(plot.id);
  }

  // Log pile: up to 3 instances per plot, only present while the plot holds logs.
  const logs = plot.state === 'logs' ? Math.min(LOG_LOGS_PER_PILE, Math.max(0, plot.woodLeft ?? 0)) : 0;
  removePlotLogs(plot.id, logs);
  if (logs > 0) writeLogPile(plot, logs, basePos, q);
}

// Lay 1-3 logs in a small pyramid on the plot, axis along the local tangent X.
function writeLogPile(plot: Plot, count: number, basePos: THREE.Vector3, baseQ: THREE.Quaternion): void {
  const yawJitter = (hashAngle(plot.id * 7 + 1) / (Math.PI * 2) - 0.5) * 2 * LOG_YAW_JITTER;
  const yawQ = _yawQ.setFromAxisAngle(_up, yawJitter);
  // Small pop when the pile is first tapped/created (shares the tree pop timer).
  const pop = plot.popTimer ? 1 + POP_AMOUNT * clamp01(plot.popTimer / GROW_POP_SECONDS) : 1;
  for (let k = 0; k < count; k++) {
    if (k === 2) _local.set(0, LOG_TOP_Y, 0);
    else _local.set(k === 0 ? -(LOG_RADIUS + 0.002) : LOG_RADIUS + 0.002, LOG_BOTTOM_Y, 0);
    _world.copy(_local).applyQuaternion(yawQ).applyQuaternion(baseQ).add(basePos);
    treeMatrix.compose(_world, baseQ, treeScale.set(pop, pop, pop));
    showInstance(logPool, logSlots, plot.id * LOG_LOGS_PER_PILE + k, treeMatrix);
  }
}

// ===== syncTrees: rebuild ALL instances and slot maps from state (single source of truth) =====
export function syncTrees(): void {
  const verdant = ctx.state.planets.verdant;
  clearTreeInstances();
  for (let arrayIdx = 0; arrayIdx < verdant.plots.length; arrayIdx++) {
    writeTreeMatrices(verdant.plots[arrayIdx]);
  }
  flagTreeBuffers();
}

export function flagTreeBuffers(): void {
  for (const vp of variantPools) vp.instanceMatrix.needsUpdate = true;
  logPool.instanceMatrix.needsUpdate = true;
  shadowPool.instanceMatrix.needsUpdate = true;
}
