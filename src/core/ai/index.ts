import type { Worker, Role, Vec3 } from '../state';
import { WORKERS } from '../config/workers';

export function workerSpeed(role: Role, level: number): number {
  return WORKERS[role].speed * (1 + Math.floor(level / 25) * 0.5);
}

export function faceToward(pos: Vec3, target: Vec3): Vec3 {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

export function isStuck(w: Worker, maxSeconds = 15): boolean {
  return w.stuckTimer > maxSeconds;
}
