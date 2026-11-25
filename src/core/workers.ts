import { costOf } from './config/workers';
import { WORKER_IDLE_SECONDS, WORKER_APPEAR_SECONDS, shirtColorFor } from './config/worker';
import { PLANET_RADIUS } from './config/world';
import { gte, sub } from './money';
import type { GameState, Role, Vec3, Worker, UpgradeId } from './state';
import type { IdGenerator } from './ports';

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

const HAT_BY_ROLE: Record<string, string> = {
  planter: 'cap',
  lumberjack: 'cowboy',
  carrier: 'cap',
};

/**
 * Add exactly one worker to the verdant planet, charging its cost unless `free`.
 * Pure core helper: the render layer turns the returned worker into a model.
 */
export function hireWorker(
  state: GameState,
  role: Role,
  opts: { free?: boolean; spawnDir?: Vec3; ids?: IdGenerator } = {},
): Worker | undefined {
  const planet = state.planets.verdant;

  if (!opts.free) {
    const hireableRoles: Role[] = ['planter', 'lumberjack', 'carrier'];
    if (hireableRoles.includes(role)) {
      const purchased = state.upgrades[role as UpgradeId] ?? 0;
      const cost = costOf(role, purchased);
      if (!gte(state.currencies.credits, cost)) return undefined;
      state.currencies.credits = sub(state.currencies.credits, cost);
      (state.upgrades as Record<Role, number>)[role] = purchased + 1;
    } else {
      // For roles without upgrade tracking (miner, prospector, engineer), use worker count
      const existing = planet.workers.filter((w) => w.role === role).length;
      const cost = costOf(role, existing);
      if (!gte(state.currencies.credits, cost)) return undefined;
      state.currencies.credits = sub(state.currencies.credits, cost);
    }
  }

  const dir = normalize(opts.spawnDir ?? { x: 0, y: 0, z: 1 });
  const color = `#${shirtColorFor(role).toString(16).padStart(6, '0')}`;
  const highestId = Object.values(state.planets).reduce((highest, p) =>
    p.workers.reduce((n, worker) => Math.max(n, worker.id), highest), 0);
  const worker: Worker = {
    id: Math.max(opts.ids?.next() ?? 0, highestId + 1),
    role,
    pos: { x: dir.x * PLANET_RADIUS, y: dir.y * PLANET_RADIUS, z: dir.z * PLANET_RADIUS },
    state: 'idle',
    target: undefined,
    carrying: undefined,
    level: 0,
    cosmetic: { hat: HAT_BY_ROLE[role] ?? 'cap', color },
    name: role,
    stuckTimer: 0,
    appearTimer: WORKER_APPEAR_SECONDS,
    stateTimer: WORKER_IDLE_SECONDS,
  };
  planet.workers.push(worker);
  return worker;
}
