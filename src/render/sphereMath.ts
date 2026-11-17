export type Vec3 = { x: number; y: number; z: number };

export function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function worldPosition(v: Vec3, radius: number): Vec3 {
  const n = normalize(v);
  return { x: n.x * radius, y: n.y * radius, z: n.z * radius };
}

export function fibonacciSphere(count: number, radius: number): Vec3[] {
  const points: Vec3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push({ x: Math.cos(theta) * r * radius, y: y * radius, z: Math.sin(theta) * r * radius });
  }
  return points;
}

export function angularDist(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

export function slerp(cur: Vec3, target: Vec3, t: number): Vec3 {
  const lerped = {
    x: cur.x + (target.x - cur.x) * t,
    y: cur.y + (target.y - cur.y) * t,
    z: cur.z + (target.z - cur.z) * t,
  };
  const len = Math.sqrt(lerped.x * lerped.x + lerped.y * lerped.y + lerped.z * lerped.z) || 1;
  return { x: lerped.x / len, y: lerped.y / len, z: lerped.z / len };
}

export function tangentOf(cur: Vec3, target: Vec3): Vec3 {
  const cross = {
    x: cur.y * target.z - cur.z * target.y,
    y: cur.z * target.x - cur.x * target.z,
    z: cur.x * target.y - cur.y * target.x,
  };
  const len = Math.sqrt(cross.x * cross.x + cross.y * cross.y + cross.z * cross.z) || 1;
  return { x: cross.x / len, y: cross.y / len, z: cross.z / len };
}

export function upRotation(v: Vec3, roll: number): { x: number; y: number; z: number; w: number } {
  const y = { x: 0, y: 1, z: 0 };
  const axis = { x: v.y * y.z - v.z * y.y, y: v.z * y.x - v.x * y.z, z: v.x * y.y - v.y * y.x };
  const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z) || 1;
  const a = axis.x / len;
  const b = axis.y / len;
  const c = axis.z / len;
  const angle = Math.acos(Math.max(-1, Math.min(1, v.y)));
  const h = Math.sin(angle / 2);
  const qx = a * h, qy = b * h, qz = c * h, qw = Math.cos(angle / 2);
  if (roll !== 0) {
    const rw = Math.cos(roll / 2);
    return {
      x: qx * rw + qw * 0 + qz * 0 - qy * 0,
      y: qy * rw + qw * 0 + qx * 0 - qz * 0,
      z: qz * rw + qw * 0 + qy * 0 - qx * 0,
      w: qw * rw - qx * 0 - qy * 0 - qz * 0,
    };
  }
  return { x: qx, y: qy, z: qz, w: qw };
}
