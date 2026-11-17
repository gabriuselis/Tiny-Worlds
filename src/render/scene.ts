import * as THREE from 'three';

export interface SceneAPI {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  resize: () => void;
  render: () => void;
  add: (obj: THREE.Object3D) => void;
}

const STAR_COUNT = 1200;

export function createScene(canvas: HTMLCanvasElement): SceneAPI {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);

  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.05, 2000);
  camera.position.set(0, 0, 10);

  // Hemisphere light: sky white / ground green
  const hemi = new THREE.HemisphereLight(0xffffff, 0x7fbf78, 0.6);
  scene.add(hemi);

  // Directional light from upper left
  const dir = new THREE.DirectionalLight(0xfff6e6, 1.2);
  dir.position.set(-3, 3, 4);
  dir.castShadow = false;
  scene.add(dir);

  // Ambient fill
  const ambient = new THREE.AmbientLight(0xffffff, 0.30);
  scene.add(ambient);

  scene.environment = null;
  scene.fog = null;

  // Star background
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT * 3; i += 3) {
    starPos[i] = (Math.random() - 0.5) * 140;
    starPos[i + 1] = (Math.random() - 0.5) * 140;
    starPos[i + 2] = (Math.random() - 0.5) * 140 - 40;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, transparent: true, opacity: 0.9 });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  function render() {
    renderer.render(scene, camera);
  }

  function add(obj: THREE.Object3D) {
    scene.add(obj);
  }

  return { renderer, camera, scene, resize, render, add };
}
