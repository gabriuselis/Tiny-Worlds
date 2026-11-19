import { Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { WORLD_CONFIG } from '../core/config/world';

interface Opts {
  planet: Object3D;
  camera: PerspectiveCamera;
  planetRadius: number;
  defaultDist: number;
  startDist: number;
  minDist: number;
  maxDist: number;
  debug?: (text: string) => void;
}

export function setupGestures(o: Opts) {
  let dist = o.startDist;
  let targetDist = o.startDist;
  let vx = 0, vy = 0;
  let lastInput = performance.now();
  let pinchPrev = 0;
  let frames = 0;
  let lastEvent = 'none';
  let lastTapTime = 0;
  const pointers = new Map<number, { x: number; y: number }>();
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

  const down = (e: PointerEvent) => {
    lastEvent = 'down';
    if (isUI(e.target)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInput = performance.now(); vx = vy = 0;
    if (pointers.size === 2) {
      pinchPrev = pinchDistance();
    }
    // double tap reset
    const now = performance.now();
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
    if (pointers.size === 1) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      rotate(dx, dy); vx = dx; vy = dy;
    } else if (pointers.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const d = pinchDistance();
      if (pinchPrev > 0) {
        const scale = pinchPrev / d; // spread apart -> dist decreases -> zoom in
        setDist(dist * scale);
      }
      pinchPrev = d; vx = vy = 0;
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
  };
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); pinchPrev = 0; lastEvent = 'up'; };
  const wheel = (e: WheelEvent) => {
    if (isUI(e.target)) return;
    const factor = zoomSpeedFactor() * (e.ctrlKey ? 0.002 : 0.001);
    setDist(dist * (1 - e.deltaY * factor));
    lastInput = performance.now(); lastEvent = 'wheel';
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
      setDist(dist / ge.scale); // ge.scale > 1 = spread apart = zoom in = dist decreases
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
