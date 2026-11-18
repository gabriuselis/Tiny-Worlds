// Spherical motion helpers shared by the worker AIs (pure, no three.js).

import { PLANET_RADIUS } from '../config/world';
import type { Vec3 } from '../state';

export function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function dirFromPos(pos: Vec3): Vec3 {
  return normalize(pos);
}

export function angularDist(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  if (dot > 0.9999) return { x: a.x, y: a.y, z: a.z };
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  if (s < 1e-6) return { x: a.x, y: a.y, z: a.z };
  const t1 = Math.sin((1 - t) * theta) / s;
  const t2 = Math.sin(t * theta) / s;
  return {
    x: a.x * t1 + b.x * t2,
    y: a.y * t1 + b.y * t2,
    z: a.z * t1 + b.z * t2,
  };
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Tangent direction at `fromDir` pointing along the great circle toward `toDir`. */
export function tangentTowards(fromDir: Vec3, toDir: Vec3): Vec3 {
  const t = { x: toDir.x - fromDir.x, y: toDir.y - fromDir.y, z: toDir.z - fromDir.z };
  const d = t.x * fromDir.x + t.y * fromDir.y + t.z * fromDir.z;
  const projected = { x: t.x - fromDir.x * d, y: t.y - fromDir.y * d, z: t.z - fromDir.z * d };
  const len = Math.sqrt(projected.x ** 2 + projected.y ** 2 + projected.z ** 2);
  if (len < 1e-8) return { x: 0, y: 0, z: 1 };
  return { x: projected.x / len, y: projected.y / len, z: projected.z / len };
}

/** Rotate a unit direction around an axis (Rodrigues), returns a unit vector. */
export function rotateAround(dir: Vec3, axis: Vec3, angle: number): Vec3 {
  const k = normalize(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = k.x * dir.x + k.y * dir.y + k.z * dir.z;
  const cr = cross(k, dir);
  return normalize({
    x: dir.x * cos + cr.x * sin + k.x * dot * (1 - cos),
    y: dir.y * cos + cr.y * sin + k.y * dot * (1 - cos),
    z: dir.z * cos + cr.z * sin + k.z * dot * (1 - cos),
  });
}

/** A spot `offsetWorld` units beside the tree, on the side the worker comes from. */
export function standSpotDir(plotDir: Vec3, workerDir: Vec3, offsetWorld: number): Vec3 {
  const towardWorker = tangentTowards(plotDir, workerDir);
  const angle = offsetWorld / PLANET_RADIUS;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return normalize({
    x: plotDir.x * c + towardWorker.x * s,
    y: plotDir.y * c + towardWorker.y * s,
    z: plotDir.z * c + towardWorker.z * s,
  });
}

/** Move toward `targetDir` along the surface; returns the new dir and remaining angle. */
export function advance(
  pos: Vec3,
  targetDir: Vec3,
  speed: number,
  dt: number,
): { dir: Vec3; remaining: number; arrived: boolean } {
  const cur = dirFromPos(pos);
  const remaining = angularDist(cur, targetDir);
  const step = (speed / PLANET_RADIUS) * dt;
  if (remaining <= step + 1e-4) {
    return { dir: targetDir, remaining: 0, arrived: true };
  }
  return { dir: slerp(cur, targetDir, step / remaining), remaining, arrived: false };
}

export function dirToPos(dir: Vec3): Vec3 {
  return { x: dir.x * PLANET_RADIUS, y: dir.y * PLANET_RADIUS, z: dir.z * PLANET_RADIUS };
}
