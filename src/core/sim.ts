import Decimal from 'break_infinity.js';
import { PLANETS } from './config/planets';
import { WORKERS } from './config/workers';
import { WORLD_CONFIG, GROW_STAGE_SECONDS, GROW_POP_SECONDS } from './config/world';
import { incomePerSecond } from './economy';
import { add, mul } from './money';
import { updatePlanter } from './ai/planter';
import type { GameState, Worker, PlanetId } from './state';

const TICK = 0.1;

let sellAccumulator = 0;

export function tick(state: GameState, dt = TICK): void {
  sellAccumulator += dt;
  if (sellAccumulator >= WORLD_CONFIG.sellInterval) {
    sellAccumulator = 0;
    doSelling(state);
  }
  for (const pid of Object.keys(state.planets) as PlanetId[]) {
    tickPlanet(state, pid, dt);
  }
  state.currencies.starDust = add(
    state.currencies.starDust,
    mul(incomePerSecond(state), dt / 1e9),
  );
}

function doSelling(state: GameState): void {
  const planet = state.planets.verdant;
  const wood = planet.resources.wood;
  const woodNum = wood.toNumber();
  if (woodNum > 0) {
    const price = WORLD_CONFIG.woodPrice * (1 + state.upgrades.woodValue * WORLD_CONFIG.woodValueBoost);
    const earn = woodNum * price;
    planet.resources.wood = new Decimal(0);
    state.currencies.credits = add(state.currencies.credits, earn);
    state.stats.woodSold = add(state.stats.woodSold, woodNum);
    state.stats.lifetimeCredits = add(state.stats.lifetimeCredits, earn);
  }
}

function tickPlanet(state: GameState, pid: PlanetId, dt: number): void {
  const planet = state.planets[pid];
  const cfg = PLANETS[pid];
  if (!planet.unlocked) return;

  tickPlots(planet, dt);
  tickWorkers(state, planet, pid, cfg, dt);
}

function tickPlots(planet: any, dt: number): void {
  for (const plot of planet.plots) {
    if (plot.state === 'sapling') {
      if (plot.reservedBy !== undefined) continue;
      plot.timer -= dt;
      if (plot.timer <= 0) {
        plot.state = 'medium';
        plot.timer = GROW_STAGE_SECONDS[1];
        plot.popTimer = GROW_POP_SECONDS;
      }
    } else if (plot.state === 'medium') {
      plot.timer -= dt;
      if (plot.timer <= 0) {
        plot.state = 'grown';
        plot.popTimer = GROW_POP_SECONDS;
      }
    } else if (plot.state === 'stump') {
      plot.timer -= dt;
      if (plot.timer <= 0 && plot.woodLeft <= 0) {
        plot.state = 'empty';
        plot.timer = 0;
        plot.reservedBy = undefined;
      }
    }
    if (plot.reservedBy !== undefined) {
      plot.timer = Math.max(plot.timer, 0);
    }
    if (plot.popTimer) {
      plot.popTimer = Math.max(0, plot.popTimer - dt);
    }
  }
}

function tickWorkers(
  state: GameState,
  planet: any,
  pid: PlanetId,
  cfg: any,
  dt: number
): void {
  for (const w of planet.workers) {
    // Sky-drop animation takes priority
    if (w.dropProgress !== undefined && w.dropProgress < 1) {
      w.dropProgress += dt / WORLD_CONFIG.dropFlightTime;
      if (w.dropProgress >= 1) {
        w.dropProgress = 1;
        w.state = 'idle';
      }
      w.stuckTimer = 0;
      continue;
    }
    // Planter has its own dedicated AI state machine.
    if (w.role === 'planter') {
      updatePlanter(w, planet.plots, state, dt);
      continue;
    }
    w.stuckTimer += dt;
    switch (w.state) {
      case 'idle':
        handleIdle(state, planet, pid, w, cfg, dt);
        break;
      case 'walk':
      case 'walkToPost':
        handleWalk(planet, w, dt);
        break;
      case 'plant':
        handlePlant(state, planet, cfg, w, dt);
        break;
      case 'chop':
        handleChop(state, planet, w, dt);
        break;
      case 'pickup':
        handlePickup(planet, w, dt);
        break;
      case 'deliver':
        handleDeliver(state, planet, w, dt);
        break;
      case 'wander':
        handleWander(planet, w, dt);
        break;
    }
    if (w.stuckTimer > 10 && w.state !== 'dropping') {
      w.state = 'idle';
      w.stuckTimer = 0;
      w.target = undefined;
    }
  }
}

function handleIdle(
  _state: GameState,
  planet: any,
  _pid: PlanetId,
  w: Worker,
  _cfg: any,
  _dt: number
): void {
  if (w.role === 'planter') {
    const spot = findFreePlot(planet, w);
    if (spot) {
      spot.reservedBy = w.id;
      w.target = spot.id;
      w.state = 'walk';
      w.stuckTimer = 0;
      return;
    }
  } else if (w.role === 'lumberjack') {
    const tree = findGrownPlot(planet, w);
    if (tree) {
      tree.reservedBy = w.id;
      w.target = tree.id;
      w.state = 'walk';
      w.stuckTimer = 0;
      return;
    }
  } else if (w.role === 'carrier') {
    const stump = findStumpWithWood(planet, w);
    if (stump) {
      stump.reservedBy = w.id;
      w.target = stump.id;
      w.state = 'walk';
      w.stuckTimer = 0;
      return;
    }
  }
  w.state = 'wander';
}

function findFreePlot(planet: any, _w: Worker): any | undefined {
  return planet.plots.find((p: any) => p.state === 'empty' && p.reservedBy === undefined);
}

function findGrownPlot(planet: any, _w: Worker): any | undefined {
  return planet.plots.find((p: any) => p.state === 'grown' && p.reservedBy === undefined);
}

function findStumpWithWood(planet: any, _w: Worker): any | undefined {
  return planet.plots.find((p: any) => p.state === 'stump' && p.woodLeft > 0 && p.reservedBy === undefined);
}

function handleWalk(planet: any, w: Worker, dt: number): void {
  let targetPos: { x: number; y: number; z: number };
  let targetPlot: any;

  if (w.target === -1) {
    // walking to trade post
    targetPos = planet.tradePostPos ?? { x: 0, y: planetRadius + 0.02, z: 0 };
  } else {
    targetPlot = planet.plots.find((n: any) => n.id === w.target);
    if (!targetPlot) {
      w.state = 'idle';
      w.target = undefined;
      return;
    }
    targetPos = { x: targetPlot.dir.x * planetRadius, y: targetPlot.dir.y * planetRadius, z: targetPlot.dir.z * planetRadius };
  }

  w.stuckTimer = 0;
  const dist = angularDist(w.pos, targetPos);
  if (dist < 0.05) {
    if (w.state === 'walkToPost') {
      w.state = 'deliver';
    } else {
      w.state = w.role === 'planter' ? 'plant' : w.role === 'lumberjack' ? 'chop' : 'pickup';
    }
    return;
  }
  slerpTowards(w.pos, targetPos, WORKERS[w.role].speed * WORLD_CONFIG.walkSpeed * dt);
}

function handlePlant(state: GameState, planet: any, _cfg: any, w: Worker, dt: number): void {
  const plot = planet.plots.find((n: any) => n.id === w.target);
  if (!plot) { w.state = 'idle'; w.target = undefined; return; }
  plot.timer -= dt;
  if (plot.timer <= 0) {
    plot.state = 'sapling';
    plot.timer = GROW_STAGE_SECONDS[0];
    plot.reservedBy = undefined;
    plot.popTimer = GROW_POP_SECONDS;
    w.state = 'idle';
    w.target = undefined;
    w.stuckTimer = 0;
    state.stats.treesPlanted += 1;
  }
}

function handleChop(_state: GameState, planet: any, w: Worker, dt: number): void {
  const plot = planet.plots.find((n: any) => n.id === w.target);
  if (!plot) { w.state = 'idle'; w.target = undefined; return; }
  plot.timer -= dt;
  if (plot.timer <= 0) {
    plot.state = 'stump';
    plot.woodLeft = 3;
    plot.timer = WORLD_CONFIG.stumpDecayTime;
    plot.reservedBy = undefined;
    w.carrying = undefined;
    w.state = 'idle';
    w.target = undefined;
    w.stuckTimer = 0;
    planet.treesHarvested += 1;

    // If no carrier, lumberjack picks up the logs itself
    const hasCarrier = planet.workers.some((ww: any) => ww.role === 'carrier' && ww.state !== 'dropping');
    if (!hasCarrier) {
      w.target = plot.id;
      w.state = 'pickup';
      plot.reservedBy = w.id;
    }
  }
}

function handlePickup(planet: any, w: Worker, _dt: number): void {
  const plot = planet.plots.find((n: any) => n.id === w.target);
  if (!plot) { w.state = 'idle'; w.target = undefined; return; }
  if (plot.state !== 'stump' || plot.woodLeft <= 0) {
    w.state = 'idle';
    w.target = undefined;
    plot.reservedBy = undefined;
    return;
  }
  const take = Math.min(WORKERS[w.role].carry, plot.woodLeft);
  plot.woodLeft -= take;
  w.carrying = { res: 'wood', amt: take };
  w.state = 'walkToPost';
  w.target = -1;
  w.stuckTimer = 0;
  if (plot.woodLeft <= 0) {
    plot.reservedBy = undefined;
  }
}

function handleDeliver(state: GameState, planet: any, w: Worker, _dt: number): void {
  if (!w.carrying) { w.state = 'idle'; return; }
  const amt = w.carrying.amt;
  planet.resources.wood = planet.resources.wood.add(amt);
  state.stats.woodSold = state.stats.woodSold.add(amt);
  const price = WORLD_CONFIG.woodPrice * (1 + state.upgrades.woodValue * WORLD_CONFIG.woodValueBoost);
  const earn = amt * price;
  state.currencies.credits = add(state.currencies.credits, earn);
  state.stats.lifetimeCredits = add(state.stats.lifetimeCredits, earn);
  w.carrying = undefined;
  w.state = 'idle';
  w.target = undefined;
  w.stuckTimer = 0;
}

function handleWander(_planet: any, w: Worker, dt: number): void {
  const angle = (Math.random() - 0.5) * 0.5 * dt;
  slerpTowards(w.pos, { x: w.pos.x, y: w.pos.y, z: w.pos.z }, angle);
}

const planetRadius = WORLD_CONFIG.planetRadius;

function angularDist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function slerpTowards(
  cur: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  t: number
): void {
  const lerped = {
    x: cur.x + (target.x - cur.x) * t,
    y: cur.y + (target.y - cur.y) * t,
    z: cur.z + (target.z - cur.z) * t,
  };
  const len = Math.sqrt(lerped.x * lerped.x + lerped.y * lerped.y + lerped.z * lerped.z) || 1;
  cur.x = lerped.x / len;
  cur.y = lerped.y / len;
  cur.z = lerped.z / len;
}
