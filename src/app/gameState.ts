import { initialState } from '../core/state';
import { load, clearSave } from '../core/save';
import { seedEmptyPlots } from '../core/game';
import type { GameState } from '../core/state';
import { logEvent } from '../ui/ui';
import { ctx } from './context';
import { showError } from './errors';

// ===== State: the ONE shared game object (created once, never replaced) =====
// Dev actions and Reset mutate this object in place, so the simulation, the
// planter AI, the renderer and the UI can never drift onto different copies.
export function initGameState(): void {
  let game: GameState;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('reset') === '1') {
      clearSave();
      urlParams.delete('reset');
      window.history.replaceState({}, '', window.location.pathname);
    }
    game = load() ?? initialState();
    game.lastSaved = Date.now();
  } catch (err) {
    showError('state init failed', err);
    game = initialState();
  }
  const state: GameState = game;
  ctx.state = state;
  ctx.verdant = state.planets.verdant;

  // The grid is the only source of plot positions. Populate the shared state with
  // all 1500 plots as 'empty': the planet renders bare, and planters HAVE targets.
  try {
    ctx.verdant.workers.length = 0; // empty start: no workers restored from a save
    const n = seedEmptyPlots(state, ctx.grid.plots);
    logEvent(`state: ${n} plots seeded empty`);
  } catch (err) { showError('seed plots failed', err); }
}
