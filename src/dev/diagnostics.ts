import type * as THREE from 'three';
import { WORLD_CONFIG } from '../core/config/world';
import { startMutationObserver, startDiagnosticEvents, logEvent } from '../ui/ui';
import { ctx } from '../app/context';
import { planetRadius } from '../app/constants';
import { showError } from '../app/errors';

// ===== Diagnostic initialization =====
export function initDiagnostics(): void {
  const { defaultDist, minDist, maxDist } = ctx;
  try {
    startMutationObserver();
    startDiagnosticEvents();
    logEvent('main.ts initialized');
    logEvent(`Default camera distance: ${defaultDist.toFixed(2)}, minDist: ${minDist.toFixed(2)}, maxDist: ${maxDist.toFixed(2)}`);
  } catch (err) { showError('diagnostic init failed', err); }
}

export function logZoomDiagnostics(): void {
  const { defaultDist, minDist, maxDist } = ctx;
  // Default zoom diagnostic
  try {
    const cam = ctx.sceneAPI?.camera as THREE.PerspectiveCamera;
    if (cam) {
      logEvent(`DEFAULT ZOOM: dist=${defaultDist.toFixed(2)} minDist=${minDist.toFixed(2)} maxDist=${maxDist.toFixed(2)}`);
      logEvent(`CAMERA: pos.len=${cam.position.length().toFixed(2)} fov=${cam.fov} zoom=${cam.zoom} planetRadius=${planetRadius} treeHeight=${WORLD_CONFIG.treeHeight}`);
    }
  } catch (err) { showError('zoom diagnostic failed', err); }

  // On-screen zoom diagnostic (built once, patched once): distance, fov, radius, scale
  try {
    const diagEl = document.createElement('div');
    diagEl.id = 'ui-zoom-diag';
    diagEl.style.cssText = `position:fixed;bottom:8px;right:8px;z-index:2147483647;pointer-events:none;font-family:monospace;font-size:11px;color:#0f0;background:rgba(0,0,0,0.8);padding:6px 10px;border-radius:6px;border:1px solid #0f0;white-space:nowrap;display:none;`;
    document.body.appendChild(diagEl);
    const cam2 = ctx.sceneAPI?.camera as THREE.PerspectiveCamera;
    if (cam2) {
      const dist = cam2.position.length();
      const fovRad = (cam2.fov * Math.PI) / 180;
      const fill = (2 * Math.asin(Math.min(1, planetRadius / dist)) / fovRad) * 100;
      diagEl.textContent = `ZOOM: dist=${dist.toFixed(2)} fov=${cam2.fov}Â° R=${planetRadius} scale=${ctx.planetGroup.scale.x.toFixed(2)} fill=${fill.toFixed(0)}%`;
      logEvent(`ZOOM DIAG: dist=${dist.toFixed(2)} fov=${cam2.fov} planetRadius=${planetRadius} scale=1 fill=${fill.toFixed(0)}%`);
    }
  } catch (err) { showError('zoom diag failed', err); }
}
