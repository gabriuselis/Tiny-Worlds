import { applyUrlParams } from './ui/ui';
import './ui/style.css';

import { ctx } from './app/context';
import { installErrorHandling } from './app/errors';
import { initScene, initGrid, initPlanet, initTradePost } from './app/world';
import { initCameraDistances, initGestures, installResetZoom, updateViewport } from './app/camera';
import { initTreePools } from './app/trees';
import { initGameState } from './app/gameState';
import { initUi } from './app/uiSetup';
import { wireResetSaveButton, installEvents } from './app/events';
import { startLoop } from './app/loop';
import { initDiagnostics, logZoomDiagnostics } from './dev/diagnostics';
import { installDevHooks } from './dev';
import { LogPileAffordance } from './render/affordance';

export { stageScaleFor } from './app/trees';

installErrorHandling();

initScene();
initCameraDistances();
initDiagnostics();
initGrid();
initPlanet();
initTradePost();
initTreePools();
initGameState();
ctx.lastTime = performance.now();
initUi();
initGestures();

// Initialize affordance system for log pile tap hints
if (ctx.sceneAPI) {
  ctx.affordance = new LogPileAffordance(
    ctx.sceneAPI.scene,
    ctx.sceneAPI.camera,
    ctx.planetGroup
  );
}

installResetZoom();
logZoomDiagnostics();
wireResetSaveButton();
installEvents();
installDevHooks();

// Apply URL parameters (?fill=1, ?clear=1, ?reset=1, ?menu=1)
applyUrlParams();

requestAnimationFrame(() => {
  requestAnimationFrame(updateViewport);
});

startLoop();
