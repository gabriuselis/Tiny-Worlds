import { installTreeToolHooks } from './treeTools';
import { installGameToolHooks } from './gameTools';
import { installDebugStatsHooks } from './debugStats';
import { installOverlayHooks } from './overlays';
import { installInspectHooks } from './inspect';
import { installTestWorkerHook } from './testWorker';

// Everything the dev menu and self-tests reach through `window.__*`.
export function installDevHooks(): void {
  installTreeToolHooks();
  installGameToolHooks();
  installDebugStatsHooks();
  installOverlayHooks();
  installInspectHooks();
  installTestWorkerHook();
}
