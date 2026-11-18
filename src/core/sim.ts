import { WORLD_CONFIG, GROW_STAGE_SECONDS, GROW_POP_SECONDS, LOG_LOGS_PER_PILE } from './config/world';
import { incomePerSecond } from './economy';
import { add, mul } from './money';
import { updatePlanter } from './ai/planter';
import { updateLumberjack } from './ai/lumberjack';
import { updateCarrier } from './ai/carrier';
import { plantSpeedMult } from './config/upgrades';
import type { GameState, PlanetState } from './state';

const TICK = 0.1;

export function tick(state: GameState, dt = TICK): void {
  state.simSeconds += dt;
  for (const pid of Object.keys(state.planets) as (keyof GameState['planets'])[]) {
    tickPlanet(state, pid, dt);
  }
  state.currencies.starDust = add(
    state.currencies.starDust,
    mul(incomePerSecond(state), dt / 1e9),
  );
}

function tickPlanet(state: GameState, pid: keyof GameState['planets'], dt: number): void {
  const planet = state.planets[pid];
  if (!planet.unlocked) return;

  tickPlots(state, planet, dt);
  tickWorkers(state, planet, dt);
}

function tickPlots(state: GameState, planet: PlanetState, dt: number): void {
  // Plant Speed multiplies the stage durations; read fresh every tick so a
  // purchase speeds up trees that are already growing (remaining time shrinks).
  const plantMult = plantSpeedMult(state.upgrades.plantSpeed);
  for (const plot of planet.plots) {
    if (plot.state === 'sapling') {
      plot.timer -= dt;
      if (plot.timer <= 0) {
        plot.state = 'medium';
        plot.timer = GROW_STAGE_SECONDS[1] * plantMult;
        plot.popTimer = GROW_POP_SECONDS;
      }
    } else if (plot.state === 'medium') {
      plot.timer -= dt;
      if (plot.timer <= 0) {
        plot.state = 'grown';
        plot.timer = 0;
        plot.popTimer = GROW_POP_SECONDS;
      }
    } else if (plot.state === 'falling') {
      plot.timer -= dt;
      if (plot.timer <= 0) {
        plot.state = 'logs';
        plot.woodLeft = LOG_LOGS_PER_PILE;
        plot.timer = 0;
        plot.fallDir = undefined;
        plot.reservedBy = undefined;
        plot.popTimer = GROW_POP_SECONDS;
      }
    }
    if (plot.popTimer) {
      plot.popTimer = Math.max(0, plot.popTimer - dt);
    }
  }
}

function tickWorkers(state: GameState, planet: PlanetState, dt: number): void {
  for (const w of planet.workers) {
    // Legacy sky-drop animation takes priority (no role uses it now).
    if (w.dropProgress !== undefined && w.dropProgress < 1) {
      w.dropProgress += dt / WORLD_CONFIG.dropFlightTime;
      if (w.dropProgress >= 1) {
        w.dropProgress = 1;
        w.state = 'idle';
      }
      w.stuckTimer = 0;
      continue;
    }
    switch (w.role) {
      case 'planter':
        updatePlanter(w, planet.plots, state, dt);
        break;
      case 'lumberjack':
        updateLumberjack(w, planet.plots, state, dt);
        break;
      case 'carrier':
        updateCarrier(w, planet.plots, state, dt);
        break;
      default:
        // No AI for future roles yet: stay put.
        w.state = 'idle';
        break;
    }
  }
}