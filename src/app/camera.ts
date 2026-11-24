import * as THREE from 'three';
import { WORLD_CONFIG } from '../core/config/world';
import { setupGestures } from '../render/gestures';
import { getPlanetArea } from '../render/viewport';
import { logEvent } from '../ui/ui';
import { ctx } from './context';
import { planetRadius } from './constants';
import { showError } from './errors';

// ===== Default camera distance (try/catch: broken config must not stop the planet) =====
export function initCameraDistances(): void {
  try {
    const fov = 45 * (Math.PI / 180);
    const screenPadding = 0.85;
    ctx.defaultDist = (planetRadius * 2) / (2 * Math.tan(fov / 2) * screenPadding);
    ctx.minDist = planetRadius + WORLD_CONFIG.zoomMinAboveSurface;
    ctx.maxDist = ctx.defaultDist * WORLD_CONFIG.zoomMaxMultiplier;
  } catch (err) { showError('camera distance config failed', err); }
}

// ===== Viewport / camera state =====
let planetArea: { cx: number; cy: number; size: number } | null = null;

export function updateViewport(): void {
  const area = getPlanetArea();
  if (!area) return;
  planetArea = { cx: area.cx, cy: area.cy, size: area.size };
  applyCamera();
}

function applyCamera(): void {
  if (!ctx.sceneAPI) return;
  const camera = ctx.sceneAPI.camera as THREE.PerspectiveCamera;
  const fullWidth = ctx.canvas.clientWidth;
  const fullHeight = ctx.canvas.clientHeight;
  camera.aspect = fullWidth / fullHeight;
  if (planetArea) {
    const offsetX = fullWidth / 2 - planetArea.cx;
    const offsetY = fullHeight / 2 - planetArea.cy;
    camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, fullWidth, fullHeight);
  }
  camera.updateProjectionMatrix();
}

function getLogPlots(): any[] {
  return ctx.state.planets.verdant.plots.filter((p: any) => p.state === 'logs' && (p.woodLeft ?? 0) > 0);
}

export function initGestures(): void {
  if (ctx.sceneAPI) {
    try {
      ctx.updateGestures = setupGestures({
        planet: ctx.planetGroup,
        camera: ctx.sceneAPI.camera,
        planetRadius,
        defaultDist: ctx.defaultDist,
        startDist: ctx.defaultDist,
        minDist: ctx.minDist,
        maxDist: ctx.maxDist,
        debug: () => {},
        getState: () => ctx.state,
        getLogPlots,
        onTapPile: (plotId: number) => {
          const plot = ctx.state.planets.verdant.plots.find((p: any) => p.id === plotId);
          if (!plot) return;
          
          // World position of the pile (slightly above surface)
          const worldPos = new THREE.Vector3(plot.dir.x, plot.dir.y, plot.dir.z)
            .multiplyScalar(planetRadius + 0.3);
          const localPos = worldPos.clone();
          
          // Floating text for logs collected
          if (ctx.floaters) {
            ctx.floaters.spawn(localPos, `+${plot.woodLeft ?? 1} 🪵`);
          }
          
          // Dust puff particles
          if (ctx.particles) {
            ctx.particles.emit('dust', { x: plot.dir.x, y: plot.dir.y, z: plot.dir.z }, 0.3, 8);
          }
          
          // Haptic feedback (if supported)
          if ('vibrate' in navigator) {
            (navigator as any).vibrate?.(30);
          }
          
          logEvent(`Tap collected pile ${plotId}`);
        },
      });
    } catch (err) { showError('setupGestures failed', err); }
  }
}

// Reset zoom to default on page load and when dev menu closes
export function installResetZoom(): void {
  (window as any).__resetZoomToDefault = () => {
    try {
      ctx.updateGestures?.setDist(ctx.defaultDist);
      const cam2 = ctx.sceneAPI?.camera as THREE.PerspectiveCamera;
      if (cam2) {
        cam2.position.set(0, 0, ctx.defaultDist);
        cam2.zoom = 1;
        cam2.updateProjectionMatrix();
      }
      ctx.planetGroup?.scale.set(1, 1, 1);
      logEvent(`Zoom reset to default: ${ctx.defaultDist.toFixed(2)}`);
    } catch (err) { showError('__resetZoomToDefault failed', err); };
  };
  (window as any).__resetZoomToDefault();
}
