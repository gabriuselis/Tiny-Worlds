import { WORLD_CONFIG } from './config/world';
import type { Vec3 } from './state';

const planetRadius = WORLD_CONFIG.planetRadius;
const treeSpacing = WORLD_CONFIG.treeSpacing;

const BUCKETS_LAT = 15;
const BUCKETS_LON = 20;
const BUCKET_COUNT = BUCKETS_LAT * BUCKETS_LON;

export interface Plot {
  id: number;
  row: number;
  col: number;
  dir: Vec3; // unit vector from planet center
  state: 'empty' | 'sapling' | 'medium' | 'grown' | 'stump';
  timer: number;
  reservedBy?: number; // worker id
  woodLeft: number; // logs remaining on stump
}

export interface Grid {
  rows: number;
  colsPerRow: number[];
  plots: Plot[];
  plotById: Map<number, Plot>;
  rowIdRange: [number, number][];
  buckets: number[][];
  bucketCount: number;
  plotBucket: number[];
  tradePostPlotId: number;
  blockedPlotIds: Set<number>;
  unlockedOrder: number[];
}

function latDir(latDeg: number): { y: number; r: number } {
  const lat = (latDeg * Math.PI) / 180;
  return { y: Math.sin(lat), r: Math.cos(lat) };
}

function bucketIndexOf(dir: Vec3): number {
  const lat = Math.floor(((Math.asin(Math.max(-1, Math.min(1, dir.y))) + Math.PI / 2) / Math.PI) * BUCKETS_LAT);
  const lon = Math.floor(((Math.atan2(dir.z, dir.x) + Math.PI) / (2 * Math.PI)) * BUCKETS_LON);
  const la = Math.max(0, Math.min(BUCKETS_LAT - 1, lat));
  const lo = Math.max(0, Math.min(BUCKETS_LON - 1, lon));
  return la * BUCKETS_LON + lo;
}

export function buildGrid(): Grid {
  const R = planetRadius;
  const spacing = treeSpacing;

  const rows = Math.max(2, Math.round((Math.PI * R) / spacing));
  const colsPerRow: number[] = [];

  const plots: Plot[] = [];
  let id = 0;

  for (let i = 0; i < rows; i++) {
    const latDeg = -90 + (i + 0.5) * (180 / rows);
    const { y, r } = latDir(latDeg);
    const cols = Math.max(1, Math.round((2 * Math.PI * R * r) / spacing));
    colsPerRow.push(cols);

    for (let j = 0; j < cols; j++) {
      const lon = (j / cols) * Math.PI * 2;
      const dir: Vec3 = {
        x: Math.cos(lon) * r,
        y,
        z: Math.sin(lon) * r,
      };
      const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
      plots.push({
        id: id++,
        row: i,
        col: j,
        dir: { x: dir.x / len, y: dir.y / len, z: dir.z / len },
        state: 'empty',
        timer: 0,
        reservedBy: undefined,
        woodLeft: 0,
      });
    }
  }

  // Trade post at north pole. Reserve trade post plot + neighbors within 0.35 world units.
  const tradePostDir: Vec3 = { x: 0, y: 1, z: 0 };

  let tradePostPlotId = -1;
  let bestDist = Infinity;
  for (const p of plots) {
    const d = p.dir.x * tradePostDir.x + p.dir.y * tradePostDir.y + p.dir.z * tradePostDir.z;
    const ang = Math.acos(Math.max(-1, Math.min(1, d)));
    const worldDist = R * ang;
    if (worldDist < bestDist) {
      bestDist = worldDist;
      tradePostPlotId = p.id;
    }
  }

  const blockedPlotIds = new Set<number>();
  blockedPlotIds.add(tradePostPlotId);
  const blockAng = 0.35 / R;
  for (const p of plots) {
    const d = p.dir.x * tradePostDir.x + p.dir.y * tradePostDir.y + p.dir.z * tradePostDir.z;
    const ang = Math.acos(Math.max(-1, Math.min(1, d)));
    if (ang < blockAng) blockedPlotIds.add(p.id);
  }

  // Sort unlocked order by distance from trade post (nearest first)
  const byDist = [...plots]
    .filter((p) => !blockedPlotIds.has(p.id))
    .sort((a, b) => {
      const da = a.dir.x * tradePostDir.x + a.dir.y * tradePostDir.y + a.dir.z * tradePostDir.z;
      const db = b.dir.x * tradePostDir.x + b.dir.y * tradePostDir.y + b.dir.z * tradePostDir.z;
      return Math.acos(Math.max(-1, Math.min(1, db))) - Math.acos(Math.max(-1, Math.min(1, da)));
    });
  const unlockedOrder = byDist.map((p) => p.id);

  // Row id range for neighbor lookup
  const rowIdRange: [number, number][] = [];
  let cursor = 0;
  for (let i = 0; i < rows; i++) {
    const n = colsPerRow[i];
    rowIdRange.push([cursor, cursor + n]);
    cursor += n;
  }

  // Coarse bucket index
  const buckets: number[][] = Array.from({ length: BUCKET_COUNT }, () => []);
  const plotBucket = new Array(plots.length).fill(0);

  for (const p of plots) {
    const bi = bucketIndexOf(p.dir);
    buckets[bi].push(p.id);
    plotBucket[p.id] = bi;
  }

  const plotById = new Map<number, Plot>();
  for (const p of plots) plotById.set(p.id, p);

  return {
    rows,
    colsPerRow,
    plots,
    plotById,
    rowIdRange,
    buckets,
    bucketCount: BUCKET_COUNT,
    plotBucket,
    tradePostPlotId,
    blockedPlotIds,
    unlockedOrder,
  };
}

export function getNeighborIds(grid: Grid, plotId: number): number[] {
  const plot = grid.plotById.get(plotId);
  if (!plot) return [];
  const { row, col } = plot;
  const rows = grid.rows;
  const result: number[] = [];

  const [rStart, rEnd] = grid.rowIdRange[row];
  const nCols = rEnd - rStart;
  const leftCol = (col - 1 + nCols) % nCols;
  const rightCol = (col + 1) % nCols;
  result.push(rStart + leftCol);
  result.push(rStart + rightCol);

  if (row > 0) {
    const [aStart, aEnd] = grid.rowIdRange[row - 1];
    const aCols = aEnd - aStart;
    const aCol = Math.floor((col / nCols) * aCols);
    result.push(aStart + aCol);
    if (aCols > 1) result.push(aStart + ((aCol + 1) % aCols));
  }
  if (row < rows - 1) {
    const [bStart, bEnd] = grid.rowIdRange[row + 1];
    const bCols = bEnd - bStart;
    const bCol = Math.floor((col / nCols) * bCols);
    result.push(bStart + bCol);
    if (bCols > 1) result.push(bStart + ((bCol + 1) % bCols));
  }

  return result;
}

export function findNearestPlot(
  grid: Grid,
  workerDir: Vec3,
  predicate: (p: Plot) => boolean,
  maxLevels: number = 3,
): Plot | undefined {
  const centerBi = bucketIndexOf(workerDir);
  const checked = new Set<number>();
  const candidateIds: number[] = [];

  for (let level = 0; level <= maxLevels; level++) {
    const biLa = Math.floor(centerBi / BUCKETS_LON);
    const biLo = centerBi % BUCKETS_LON;
    for (let dLa = -level; dLa <= level; dLa++) {
      for (let dLo = -level; dLo <= level; dLo++) {
        if (Math.abs(dLa) < level && Math.abs(dLo) < level) continue;
        const nLa = biLa + dLa;
        const nLo = biLo + dLo;
        if (nLa >= 0 && nLa < BUCKETS_LAT && nLo >= 0 && nLo < BUCKETS_LON) {
          const nbi = nLa * BUCKETS_LON + nLo;
          for (const pid of grid.buckets[nbi]) {
            if (!checked.has(pid)) {
              checked.add(pid);
              candidateIds.push(pid);
            }
          }
        }
      }
    }
    for (const pid of candidateIds) {
      const p = grid.plotById.get(pid);
      if (p && predicate(p)) return p;
    }
  }

  // fallback: full scan
  for (const p of grid.plots) {
    if (predicate(p)) return p;
  }
  return undefined;
}

export function plotWorldPos(plot: Plot, R: number = planetRadius): Vec3 {
  return { x: plot.dir.x * R, y: plot.dir.y * R, z: plot.dir.z * R };
}

export function angularDist(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
