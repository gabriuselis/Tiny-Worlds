import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ControlAPI {
  controls: OrbitControls;
  update: () => void;
  startAutoRotate: () => void;
  stopAutoRotate: () => void;
}

let idleTimer: number | null = null;
const IDLE_MS = 3000;

export function createControls(camera: THREE.PerspectiveCamera, canvas: HTMLElement): ControlAPI {
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.8;
  controls.maxDistance = 6;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
  controls.enableRotate = true;
  controls.enableZoom = true;

  let lastZoom = camera.position.length();

  function update() {
    // Scale auto-rotate speed with zoom level: slower when zoomed in.
    const zoom = camera.position.length();
    const zoomFactor = Math.max(0.3, Math.min(1.5, lastZoom / zoom));
    lastZoom = zoom;
    controls.autoRotateSpeed = 0.5 * zoomFactor;
    controls.update();
  }

  function startAutoRotate() {
    controls.autoRotate = true;
  }

  function stopAutoRotate() {
    controls.autoRotate = false;
  }

  // Auto-rotate after 3s of no interaction; stop immediately on interaction.
  const canvasEl = canvas as HTMLCanvasElement;
  const resetIdle = () => {
    stopAutoRotate();
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(startAutoRotate, IDLE_MS);
  };

  canvasEl.addEventListener('pointerdown', resetIdle, { passive: true });
  canvasEl.addEventListener('pointermove', resetIdle, { passive: true });
  canvasEl.addEventListener('wheel', resetIdle, { passive: true });
  canvasEl.addEventListener('touchstart', resetIdle, { passive: true });
  canvasEl.addEventListener('touchmove', resetIdle, { passive: true });

  resetIdle();

  return { controls, update, startAutoRotate, stopAutoRotate };
}
