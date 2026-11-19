import { initialState } from '../core/state';
import { LocalStorageProgressionRepository } from '../persistence/localCache';
import { RemoteProgressionRepository } from '../persistence/remoteProgression';
import { AnonymousLocalIdentity } from '../persistence/anonymousIdentity';
import { LayeredProgressionStore } from '../persistence/layeredStore';
import { Progression } from './progression';
import { syncWorkers } from './workerVisuals';
import { restoreWorld } from '../core/restore';
import type { GameState } from '../core/state';
import { logEvent } from '../ui/ui';
import { ctx } from './context';
import { showError } from './errors';

// ===== State: the ONE shared game object (created once, never replaced) =====
// Dev actions and Reset mutate this object in place, so the simulation, the
// planter AI, the renderer and the UI can never drift onto different copies.
export function initGameState(): void {
  let game: GameState;
  let loadedProgression;
  const cache = new LocalStorageProgressionRepository();
  const userId = new AnonymousLocalIdentity().userId();
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('reset') === '1') {
      cache.clear(userId);
      urlParams.delete('reset');
      window.history.replaceState({}, '', window.location.pathname);
    }
    const loaded = cache.loadGame(userId, Date.now());
    game = loaded.state;
    loadedProgression = loaded.progression;
  } catch (err) {
    showError('state init failed', err);
    game = initialState(Date.now());
    loadedProgression = null;
  }
  const state: GameState = game;
  ctx.state = state;
  ctx.verdant = state.planets.verdant;
  ctx.progressionStore = new LayeredProgressionStore(
    state, userId, cache, new RemoteProgressionRepository(),
    { now: () => Date.now() }, () => { syncWorkers(); ctx.uiNeedsUpdate = true; }, loadedProgression,
  );
  ctx.progression = new Progression(state, ctx.progressionStore);

  // The grid supplies plot positions; a matching saved world keeps its progress.
  try {
    const n = restoreWorld(state, ctx.grid.plots);
    logEvent(`state: ${n} plots ready`);
  } catch (err) { showError('seed plots failed', err); }
  void ctx.progressionStore.start();
}
