const hash = (n: number): number => {
  n = (n << 13) ^ n;
  return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

const grad = (h: number, x: number, y: number, z: number): number => {
  const v = h & 15;
  const u = v < 8 ? x : y;
  const w = v < 4 ? y : v === 12 || v === 14 ? x : z;
  return ((v & 1) === 0 ? u : -u) + ((v & 2) === 0 ? w : -w);
};

export class Noise3D {
  private perm: Int32Array;

  constructor(seed: number) {
    const p = new Int32Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const r = Math.floor(hash(seed * 100000 + i) * (i + 1));
      const j = Math.max(0, Math.min(i, r));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Int32Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = fade(x);
    const v = fade(y);
    const w = fade(z);

    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;

    const g1 = grad(this.perm[AA], x, y, z);
    const g2 = grad(this.perm[BA], x - 1, y, z);
    const g3 = grad(this.perm[AB], x, y - 1, z);
    const g4 = grad(this.perm[BB], x - 1, y - 1, z);
    const g5 = grad(this.perm[AA + 1], x, y, z - 1);
    const g6 = grad(this.perm[BA + 1], x - 1, y, z - 1);
    const g7 = grad(this.perm[AB + 1], x, y - 1, z - 1);
    const g8 = grad(this.perm[BB + 1], x - 1, y - 1, z - 1);

    return lerp(
      lerp(lerp(g1, g2, u), lerp(g3, g4, u), v),
      lerp(lerp(g5, g6, u), lerp(g7, g8, u), v),
      w,
    );
  }

  fractal(x: number, y: number, z: number, octaves: number, lacunarity: number, gain: number): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency, z * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return total / maxValue;
  }
}
