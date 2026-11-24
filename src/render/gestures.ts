import { Quaternion, Vector3, type Object3D, type PerspectiveCamera, Matrix4 } from 'three';
import { WORLD_CONFIG, TAP_RADIUS_PX, TAP_RADIUS_SCALE_FACTOR, TAP_CAMERA_FACING_DOT } from '../core/config/world';
import { collectPileByPlayer } from '../core/wood';
import type { GameState, Plot } from '../core/state';

interface Opts {
  planet: Object3D;
  camera: PerspectiveCamera;
  planetRadius: number;
  defaultDist: number;
  startDist: number;
  minDist: number;
  maxDist: number;
  debug?: (text: string) => void;
  getState: () => GameState;
  getLogPlots: () => Plot[];
  onTapPile?: (plotId: number, screenX: number, screenY: number) => void;
}

const TAP_MAX_MOVEMENT_PX = 10;
const TAP_MAX_DURATION_MS = 350;

export function setupGestures(o: Opts) {
  let dist = o.startDist;
  let targetDist = o.startDist;
  let vx = 0, vy = 0;
  let lastInput = performance.now();
  let pinchPrev = 0;
  let frames = 0;
  let lastEvent = 'none';
  let lastTapTime = 0;
  const pointers = new Map<number, { x: number; y: number; downX: number; downY: number; downTime: number; moved: boolean }>();
  const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);
  const q = new Quaternion();

  let devMenu: HTMLElement | null = null;
  const devMenuOpen = () => {
    if (!devMenu || !devMenu.isConnected) devMenu = document.getElementById('dev-menu');
    return !!devMenu && devMenu.hasAttribute('open');
  };

  const pinchDistance = () => {
    const it = pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const getMinDist = () => o.minDist;
  const getMaxDist = () => o.maxDist;

  const clampDist = (d: number) => Math.min(getMaxDist(), Math.max(getMinDist(), d));

  const setDist = (d: number) => {
    targetDist = clampDist(d);
  };

  const isUI = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest('button, a, input, [data-ui], #dev-menu');

  // Distance above surface = dist - planetRadius
  const distAboveSurface = () => dist - o.planetRadius;

  // Zoom speed: proportional to distance above surface (slower when close)
  const zoomSpeedFactor = () => Math.max(0.1, distAboveSurface() * 0.002);

  // Drag sensitivity: angle per pixel = k * dist / planetRadius
  const rotate = (dx: number, dy: number) => {
    const k = WORLD_CONFIG.dragSensitivityK * (dist / o.planetRadius);
    o.planet.quaternion.premultiply(q.setFromAxisAngle(Y, dx * k));
    o.planet.quaternion.premultiply(q.setFromAxisAngle(X, dy * k));
  };

  // Find the nearest tappable log pile to the screen coordinates
  const findTappedPile = (screenX: number, screenY: number): Plot | null => {
    const logPlots = o.getLogPlots();
    if (logPlots.length === 0) return null;

    const camera = o.camera;
    const viewMatrix = new Matrix4().copy(camera.matrixWorldInverse);
    const projMatrix = new Matrix4().copy(camera.projectionMatrix);
    const viewProjMatrix = new Matrix4().multiplyMatrices(projMatrix, viewMatrix);

    const cameraDir = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

    let bestPlot: Plot | null = null;
    let bestDist = Infinity;

    for (const plot of logPlots) {
      // Only camera-facing piles
      const dot = plot.dir.x * cameraDir.x + plot.dir.y * cameraDir.y + plot.dir.z * cameraDir.z;
      if (dot <= TAP_CAMERA_FACING_DOT) continue;

      // Project plot position to screen
      const worldPos = new Vector3(plot.dir.x, plot.dir.y, plot.dir.z).multiplyScalar(o.planetRadius + 0.3);
      const screenPos = worldPos.clone().applyMatrix4(viewProjMatrix);
      
      // Convert NDC to screen pixels
      const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
      
      // Skip if behind camera
      if (screenPos.z > 1 || screenPos.z < -1) continue;

      const dx = x - screenX;
      const dy = y - screenY;
      const distPx = Math.hypot(dx, dy);

      // Scale tap radius with pile screen size
      const pileScreenSize = Math.max(1, 0.3 * window.innerHeight / (dist / o.planetRadius));
      const tapRadius = Math.max(TAP_RADIUS_PX, TAP_RADIUS_SCALE_FACTOR * pileScreenSize);

      if (distPx <= tapRadius && distPx < bestDist) {
        bestDist = distPx;
        bestPlot = plot;
      }
    }

    return bestPlot;
  };

  const down = (e: PointerEvent) => {
    lastEvent = 'down';
    if (isUI(e.target)) return;
    const now = performance.now();
    pointers.set(e.pointerId, { 
      x: e.clientX, 
      y: e.clientY,
      downX: e.clientX,
      downY: e.clientY,
      downTime: now,
      moved: false
    });
    lastInput = now; 
    vx = vy = 0;
    if (pointers.size === 2) {
      pinchPrev = pinchDistance();
    }
    // double tap reset
    if (pointers.size === 1 && now - lastTapTime < 300) {
      setDist(o.startDist);
    }
    lastTapTime = now;
  };

  const move = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    lastEvent = 'move';
    lastInput = performance.now();
    
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    
    // Check if pointer has moved enough to not be a tap
    const totalDx = e.clientX - p.downX;
    const totalDy = e.clientY - p.downY;
    if (Math.hypot(totalDx, totalDy) > TAP_MAX_MOVEMENT_PX) {
      p.moved = true;
    }
    
    if (pointers.size === 1 && !p.moved) {
      // Still potential tap - don't rotate yet
    } else if (pointers.size === 1) {
      rotate(dx, dy); 
      vx = dx; 
      vy = dy;
    } else if (pointers.size === 2) {
      p.x = e.clientX; 
      p.y = e.clientY;
      const d = pinchDistance();
      if (pinchPrev > 0) {
        const scale = pinchPrev / d;
        setDist(dist * scale);
      }
      pinchPrev = d; 
      vx = vy = 0;
      return;
    }
    p.x = e.clientX; 
    p.y = e.clientY;
  };

  const up = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    const now = performance.now();
    
    // Check for tap: single pointer, not moved much, short duration, no pinch/drag occurred
    if (p && pointers.size === 1 && !p.moved && (now - p.downTime) < TAP_MAX_DURATION_MS && lastEvent !== 'move') {
      const tappedPlot = findTappedPile(e.clientX, e.clientY);
      if (tappedPlot) {
        const logsCollected = collectPileByPlayer(o.getState(), tappedPlot.id);
        if (logsCollected > 0) {
          o.onTapPile?.(tappedPlot.id, e.clientX, e.clientY);
        }
      }
    }
    
    pointers.delete(e.pointerId); 
    pinchPrev = 0; 
    lastEvent = 'up';
  };

  const wheel = (e: WheelEvent) => {
    if (isUI(e.target)) return;
    const factor = zoomSpeedFactor() * (e.ctrlKey ? 0.002 : 0.001);
    setDist(dist * (1 - e.deltaY * factor));
    lastInput = performance.now(); 
    lastEvent = 'wheel';
    e.preventDefault();
  };
  
  const block = (e: TouchEvent) => { if (!isUI(e.target)) e.preventDefault(); };

  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('wheel', wheel, { passive: false, capture: true });
  document.addEventListener('touchmove', block, { passive: false });

  // iOS Safari gesture events
  const igstart = (e: Event) => { if (isUI(e.target)) return; e.preventDefault(); pinchPrev = 0; lastEvent = 'gesturestart'; };
  const igchange = (e: Event) => {
    if (isUI(e.target)) return;
    e.preventDefault();
    const ge = e as any;
    if (ge.scale !== 1) {
      setDist(dist / ge.scale);
      pinchPrev = 0;
    }
    lastEvent = 'gesturechange';
  };
  const igend = (e: Event) => { if (isUI(e.target)) return; e.preventDefault(); lastEvent = 'gestureend'; };
  window.addEventListener('gesturestart', igstart, { passive: false });
  window.addEventListener('gesturechange', igchange, { passive: false });
  window.addEventListener('gestureend', igend, { passive: false });

  return {
    update: () => {
      // Ignore gestures when the dev menu is open
      if (devMenuOpen()) return;
      frames++;
      dist += (targetDist - dist) * 0.2;
      const dAbove = distAboveSurface();
      o.camera.position.set(0, 0, dist);
      o.camera.lookAt(0, 0, 0);
      if (pointers.size === 0) {
        if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) { rotate(vx, vy); vx *= 0.95; vy *= 0.95; }
        else if (performance.now() - lastInput > 3000) rotate(0.4, 0);
      }
      o.debug?.(`frame ${frames} | ptrs ${pointers.size} | ev ${lastEvent} | dist ${dist.toFixed(2)} | above ${dAbove.toFixed(2)} | min ${getMinDist().toFixed(2)} | max ${getMaxDist().toFixed(2)}`);
    },
    dispose: () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('wheel', wheel, true);
      document.removeEventListener('touchmove', block);
      window.removeEventListener('gesturestart', igstart);
      window.removeEventListener('gesturechange', igchange);
      window.removeEventListener('gestureend', igend);
      pointers.clear();
    },
    setDist,
    getDist: () => dist,
    getDistAboveSurface: () => distAboveSurface(),
  };
}