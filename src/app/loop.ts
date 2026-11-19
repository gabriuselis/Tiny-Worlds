import { tick } from '../core/sim';
import { save } from '../core/save';
import { uiFrozen } from '../ui/ui';
import { ctx } from './context';
import {
  DT,
  MAX_FRAME_DT,
  MAX_SIM_STEPS_PER_FRAME,
  UI_UPDATE_INTERVAL_MS,
  AUTOSAVE_INTERVAL_MS,
} from './constants';
import { createStageGuard } from './errors';
import { updateUfo } from './world';
import { updateTreeInstances, updateFallingTrees, updateTreeSway } from './treeUpdates';
import { updateWorkerVisuals } from './workerVisuals';
import { tickDebugStats } from '../dev/debugStats';
import { animateTestWorker } from '../dev/testWorker';

const guard = createStageGuard();

// All timestamps use performance.now() so interval checks share one clock.
let lastSave = performance.now();
let lastUiUpdate = 0;
let frameNow = 0;
let frameDt = 0;
let running = false;

function stepSim(): void {
  // Speed multiplier scales how much sim time each real second feeds in,
  // while the fixed sim step stays DT (0.1 s).
  ctx.accumulator += frameDt * ctx.gameSpeedMult;
  const steps = Math.min(Math.floor(ctx.accumulator / DT), MAX_SIM_STEPS_PER_FRAME);
  for (let i = 0; i < steps; i++) tick(ctx.state, DT);
  ctx.accumulator -= steps * DT;
}

function stepGestures(): void {
  ctx.updateGestures.update();
}

function stepTrees(): void {
  updateTreeInstances();
  updateFallingTrees();
}

function stepWorkers(): void {
  updateWorkerVisuals(frameDt);
  animateTestWorker(frameDt);
}

function stepUfo(): void {
  updateUfo(frameDt);
}

function stepEffects(): void {
  ctx.particles?.update(frameDt);
  ctx.floaters?.update(frameDt);
}

function stepRender(): void {
  ctx.sceneAPI?.render();
}

function stepUi(): void {
  if (!uiFrozen && (frameNow - lastUiUpdate >= UI_UPDATE_INTERVAL_MS || ctx.uiNeedsUpdate)) {
    ctx.ui.updateUI(ctx.state);
    lastUiUpdate = frameNow;
    ctx.uiNeedsUpdate = false;
    ctx.uiRenderCount++;
  }
}

function stepAutosave(): void {
  if (frameNow - lastSave > AUTOSAVE_INTERVAL_MS) {
    lastSave = frameNow;
    save(ctx.state);
  }
}

function frame(): void {
  frameNow = performance.now();
  frameDt = Math.min(Math.max((frameNow - ctx.lastTime) / 1000, 0), MAX_FRAME_DT);
  ctx.lastTime = frameNow;
  if (!Number.isFinite(frameDt)) return;
  // The browser may keep calling us while hidden; don't simulate, and keep lastTime fresh so no large dt on return.
  if (ctx.isPaused) return;

  guard('sim', stepSim);
  guard('gestures', stepGestures);
  guard('trees', stepTrees);
  guard('sway', updateTreeSway);
  guard('workers', stepWorkers);
  guard('ufo', stepUfo);
  guard('effects', stepEffects);
  guard('render', stepRender);
  guard('ui', stepUi);
  guard('autosave', stepAutosave);
  guard('debugStats', tickDebugStats);

  ctx.frameCount++;
}

export function startLoop(): void {
  if (running || !ctx.sceneAPI) return;
  running = true;
  ctx.lastTime = performance.now();
  ctx.sceneAPI.start(frame);
}

export function stopLoop(): void {
  if (!running) return;
  running = false;
  ctx.sceneAPI?.stop();
}

// Final save first, then stop the loop and release GPU/DOM/listener resources.
export function shutdownApp(): void {
  guard('shutdown.save', () => save(ctx.state));
  stopLoop();
  guard('shutdown.gestures', () => ctx.updateGestures?.dispose?.());
  guard('shutdown.particles', () => ctx.particles?.dispose());
  guard('shutdown.floaters', () => ctx.floaters?.dispose());
  guard('shutdown.scene', () => ctx.sceneAPI?.dispose());
  ctx.particles = null;
  ctx.floaters = null;
}
