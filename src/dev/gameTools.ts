import * as THREE from 'three';
import { initialState } from '../core/state';
import { tick } from '../core/sim';
import { plantSpeedMult, chopSpeedMult, woodValueMult, UPGRADES } from '../core/config/upgrades';
import { hireWorker } from '../core/workers';
import { add, format } from '../core/money';
import { seedEmptyPlots, countPlotStates, logsWaiting } from '../core/game';
import { collectPileByPlayer, processPlayerCollection } from '../core/wood';
import { COLLECT_LOG_INTERVAL } from '../core/config/world';
import type { Role, UpgradeId } from '../core/state';
import { disposeWorkerModel } from '../render/worker';
import { logEvent, showToast } from '../ui/ui';
import { ctx } from '../app/context';
import { DT } from '../app/constants';
import { showError } from '../app/errors';
import { syncTrees } from '../app/trees';
import { workerVisuals, syncWorkers, addWorker } from '../app/workerVisuals';
import { countVisibleTrees, resetTestTreeTimer } from './treeTools';
import { resetTestWorker } from './testWorker';

// Reset game (tap twice within 3s, or force): mutate the SAME game object,
// wipe save + worker meshes + particles, then re-sync everything.
let resetConfirmTime = 0;

function resetGameHook(force?: boolean): void {
  const { state, grid, particles, floaters } = ctx;
  const now = Date.now();
  const confirmed = force === true || now - resetConfirmTime < 3000;
  if (confirmed) {
    try {
      resetConfirmTime = 0;
      ctx.progression.reset(grid.plots, Date.now());

      for (const vm of workerVisuals.values()) {
        try { disposeWorkerModel(vm); } catch { /* ignore */ }
      }
      workerVisuals.clear();
      resetTestWorker();
      resetTestTreeTimer();
      try { particles?.clear(); floaters?.clear(); } catch { /* ignore */ }

      syncTrees();
      syncWorkers();
      const counts = countPlotStates(state);
      const visible = countVisibleTrees();
      const workers = state.planets.verdant.workers.length;
      const credits = format(state.currencies.credits);

      ctx.uiNeedsUpdate = true;
      ctx.lastTime = performance.now();
      ctx.accumulator = 0;
      showToast(`Reset: ${visible} trees, ${workers} workers, credits ${credits} (${counts.empty} empty plots)`);
      logEvent(`__resetGame: reset complete, ${visible} trees, ${workers} workers, credits ${credits}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Reset failed', err);
      showToast(`Reset failed: ${msg}`);
      logEvent(`__resetGame FAILED: ${msg}`);
    }
    return;
  }
  resetConfirmTime = now;
  showToast('Tap Reset again within 3s to confirm');
  logEvent('__resetGame: waiting for confirmation');
}

export function installGameToolHooks(): void {
  (window as any).__resetGame = resetGameHook;

  // Add credits (dev)
  (window as any).__addCredits = (amt: number) => {
    ctx.progression.devChange((game) => {
      game.currencies.credits = add(game.currencies.credits, amt);
    });
    ctx.uiNeedsUpdate = true;
    logEvent(`__addCredits: +${amt}`);
  };

  // Add Wood (visible counter and the amount queued for selling), dev only.
  (window as any).__addWood = (amt = 10) => {
    try {
      const state = ctx.state;
      ctx.progression.devChange((game) => {
        game.wood = add(game.wood, amt);
        game.woodToSell = add(game.woodToSell, amt);
      });
      ctx.ui.bumpWood();
      ctx.uiNeedsUpdate = true;
      showToast(`+${amt} wood`);
      logEvent(`__addWood: +${amt} (wood ${format(state.wood)})`);
    } catch (err) { showError('Add wood failed', err); }
  };

  // Emit one of each particle kind at the plot nearest the camera centre (dev).
  (window as any).__emitTestParticles = () => {
    try {
      const { particles, sceneAPI } = ctx;
      if (!particles || !sceneAPI) return;
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(sceneAPI.camera.quaternion).normalize();
      let best = ctx.state.planets.verdant.plots[0];
      let bestDot = -Infinity;
      for (const p of ctx.state.planets.verdant.plots) {
        const dot = p.dir.x * camDir.x + p.dir.y * camDir.y + p.dir.z * camDir.z;
        if (dot > bestDot) { bestDot = dot; best = p; }
      }
      if (!best) return;
      particles.emit('chip', best.dir, 0.15, 10);
      particles.emit('leaf', best.dir, 0.25, 8);
      particles.emit('dust', best.dir, 0.02, 6);
      logEvent(`__emitTestParticles: ${particles.aliveCount} alive`);
    } catch (err) { showError('Emit test particles failed', err); }
  };

  // Spawn worker with sky-drop (dev)
  (window as any).__spawnWorker = (role: Role) => {
    try {
      addWorker(role, true);
      ctx.uiNeedsUpdate = true;
      logEvent(`__spawnWorker: ${role} (free)`);
    } catch (err) {
      logEvent(`__spawnWorker: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Dev: +1 to every upgrade level (skips max), costs nothing.
  (window as any).__upgradeAllPlus1 = () => {
    try {
      ctx.progression.devChange((game) => {
        for (const id of ['plantSpeed', 'chopSpeed', 'woodValue', 'tapPower', 'maxTrees'] as const) {
          const max = (UPGRADES[id] as any).maxLevel;
          if (max !== undefined && game.upgrades[id] >= max) continue;
          game.upgrades[id] += 1;
        }
      });
      ctx.uiNeedsUpdate = true;
      showToast('Upgrades +1 all');
      logEvent('__upgradeAllPlus1');
    } catch (err) { showError('upgradeAllPlus1 failed', err); }
  };

  // Dev: reset upgrade levels to 0.
  (window as any).__upgradeReset = () => {
    try {
      ctx.progression.devChange((game) => {
        for (const id of Object.keys(game.upgrades) as UpgradeId[]) {
          game.upgrades[id] = 0;
        }
      });
      ctx.uiNeedsUpdate = true;
      showToast('Upgrades reset');
      logEvent('__upgradeReset');
    } catch (err) { showError('upgradeReset failed', err); }
  };

  // Dev: current multipliers for the dev menu line.
  (window as any).__upgradeMultipliers = () => {
    const state = ctx.state;
    return {
      plant: plantSpeedMult(state.upgrades.plantSpeed),
      chop: chopSpeedMult(state.upgrades.chopSpeed),
      value: woodValueMult(state.upgrades.woodValue),
    };
  };

  // Headless 5-minute wood-chain self test: 5 planters, 2 lumberjacks, 2 carriers.
  (window as any).__runWoodSelfTest = () => {
    try {
      const sim = initialState();
      seedEmptyPlots(sim, ctx.grid.plots);
      const spawnDir = { x: 0, y: 0, z: 1 };
      for (let i = 0; i < 5; i++) hireWorker(sim, 'planter', { free: true, spawnDir });
      for (let i = 0; i < 2; i++) hireWorker(sim, 'lumberjack', { free: true, spawnDir });
      for (let i = 0; i < 2; i++) hireWorker(sim, 'carrier', { free: true, spawnDir });

      const steps = Math.round(300 / DT);
      for (let i = 0; i < steps; i++) tick(sim, DT);

      const counts = countPlotStates(sim);
      const stuck = sim.planets.verdant.workers.filter((w) => (w.stuckTimer ?? 0) > 0).length;
      const result = {
        steps,
        plots: counts.total,
        empty: counts.empty,
        sapling: counts.sapling,
        medium: counts.medium,
        grown: counts.grown,
        falling: counts.falling,
        logs: counts.logs,
        wood: format(sim.wood),
        woodToSell: format(sim.woodToSell),
        credits: format(sim.currencies.credits),
        harvested: sim.planets.verdant.treesHarvested,
        logsWaiting: logsWaiting(sim),
        stuck,
      };
      logEvent(`__runWoodSelfTest: ${JSON.stringify(result)}`);
      showToast(`Wood test: ${result.harvested} chopped, ${result.logs} piles, wood ${result.wood}`);
      return result;
    } catch (err) {
      showError('Wood self test failed', err);
      return null;
    }
  };

  // Headless tap-collect self test: one pile, +3 wood exactly once, plot empty.
  (window as any).__runTapCollectSelfTest = () => {
    try {
      const sim = initialState();
      seedEmptyPlots(sim, ctx.grid.plots);
      const plot = sim.planets.verdant.plots[0];
      plot.state = 'logs';
      plot.woodLeft = 3;
      plot.timer = 0;
      plot.reservedBy = undefined;

      const before = sim.wood.toNumber();
      const collected = collectPileByPlayer(sim, plot.id);
      for (let i = 0; i < 3; i++) processPlayerCollection(sim, COLLECT_LOG_INTERVAL);
      const after = sim.wood.toNumber();
      const stateAfter = plot.state as string;

      const ok = collected === 3 && after === before + 3 && stateAfter === 'empty' && (plot.woodLeft ?? 0) === 0;
      const msg = `${ok ? 'PASS' : 'FAIL'} - wood ${before} -> ${after}, plot ${stateAfter}, woodLeft ${plot.woodLeft ?? 0}`;
      logEvent(`__runTapCollectSelfTest: ${msg}`);
      showToast(msg);
      const el = document.getElementById('dev-self-results');
      if (el) {
        const line = document.createElement('div');
        line.textContent = msg;
        line.className = ok ? 'dev-self-pass' : 'dev-self-fail';
        el.appendChild(line);
      }
      return { ok, before, after, collected, state: plot.state };
    } catch (err) {
      showError('Tap collect self test failed', err);
      return null;
    }
  };

  // Game time multiplier (dev)
  (window as any).__setSpeed = (mult: number) => {
    ctx.gameSpeedMult = mult;
    logEvent(`__setSpeed: x${mult}`);
  };
}
