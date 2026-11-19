import * as THREE from 'three';
import { WORKER_COLORS } from '../core/config/worker';

export function makeBubbleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#2b3a55';
  ctx.stroke();
  ctx.fillStyle = '#1d4ed8';
  ctx.font = 'bold 82px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dirt puff material: opacity comes from the per-instance `instanceAlpha` attribute instead of per-worker materials. */
export function makeDirtMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: WORKER_COLORS.dirt,
    roughness: 0.9,
    transparent: true,
    depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;');
  };
  mat.customProgramCacheKey = () => 'worker-dirt-instance-alpha';
  return mat;
}

/** Camera-facing quad per instance: the instance matrix supplies the centre and size, the quad is expanded in view space. */
export function makeBubbleMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float billboardSize = length(instanceMatrix[0].xyz) * length(modelMatrix[0].xyz);
      mvPosition.xy += position.xy * billboardSize;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  mat.customProgramCacheKey = () => 'worker-bubble-billboard';
  return mat;
}
